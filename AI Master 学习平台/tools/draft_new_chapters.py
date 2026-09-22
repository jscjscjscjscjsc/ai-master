"""用大模型把课程大纲扩写成正文 HTML，写回 data/courses.json。

只处理两类知识点：
  1. 新增章节（build_courses.py 的 NEW_CHAPTERS）—— 有大纲规格，按规格写；
  2. 老章节里正文为空的知识点 —— 只有标题，按标题 + 章节上下文写。

为什么要单独一个脚本、而且是可中断续跑的：写一章正文要好几次模型调用，
中间遇到超时/限流很常见。每写完一个知识点就立刻落盘，重跑时只补没写完的，
所以打断多少次都不会白干。

用法：
    python tools/draft_new_chapters.py            # 补齐所有空缺
    python tools/draft_new_chapters.py --only 4   # 只写第 4 章
    python tools/draft_new_chapters.py --force    # 重写（覆盖已有正文）
"""

import argparse
import json
import os
import re
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, 'tools'))

import build_courses  # noqa: E402
from ark_client import ArkClient, ArkError  # noqa: E402

COURSES = os.path.join(ROOT, 'data', 'courses.json')

SYSTEM = """你是一位大模型与智能体方向的资深讲师，正在为中文在线学习平台写教材正文。
读者是有 Python 基础、想系统掌握大模型应用开发的大学生和转行者。

写作硬要求：
1. 只输出 HTML 片段，不要 <html>/<body>，不要 Markdown 代码围栏，不要任何解释性开场白。
2. 结构用：<h3>小节标题</h3>、<p>、<ul><li>、<ol><li>，比较性内容用 <table><tr><th>/<td>。
3. 代码或公式用 <pre><code> 包裹，代码里不要出现 HTML 转义错误。
4. 必须包含具体事实：真实的术语、公式、参数名、数字量级、论文或产品名。宁少勿虚，禁止「非常重要」「众所周知」这类空话。
5. 中文正文，技术名词保留英文原词（如 attention、LoRA、embedding）。
6. 篇幅 700-1200 个汉字，至少 3 个小节。
7. 结尾固定加一个小节：<h3>常见误区</h3>，写 2-3 条初学者最容易搞错的地方。
8. 不要出现「本章将」「本知识点」这类元话语，直接讲内容。"""

USER_TMPL = """课程：{chapter_title}
所属阶段：{stage}
知识点：{kp_title}
{spec}

请直接输出这个知识点的正文 HTML 片段。"""

COUNT_WORDS = re.compile(r'[\u4e00-\u9fff]')


def load_courses():
    with open(COURSES, encoding='utf-8') as fh:
        return json.load(fh)


def save_courses(courses):
    tmp = COURSES + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(courses, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, COURSES)


def spec_block(chapter, kp_index, kp_title):
    """新章节：把大纲规格翻译成给模型的提示段落。"""
    spec = build_courses.NEW_CHAPTERS.get(chapter['id'])
    if not spec:
        return ''
    item = None
    for candidate in spec['kps']:
        if candidate['title'] == kp_title:
            item = candidate
            break
    if not item:
        return ''
    lines = ['必须覆盖的要点：']
    lines += ['  - ' + p for p in item['points']]
    lines.append('要给出的例子：' + item['example'])
    lines.append('学完应该能做到：' + item['outcome'])
    return '\n'.join(lines)


def build_prompt(chapter, kp):
    return USER_TMPL.format(
        chapter_title=chapter['title'],
        stage=chapter.get('stage', ''),
        kp_title=kp['title'],
        spec=spec_block(chapter, kp['index'], kp['title']),
    )


def clean_output(text):
    text = (text or '').strip()
    text = re.sub(r'^```[a-zA-Z]*\s*', '', text)
    text = re.sub(r'```\s*$', '', text)
    start = text.find('<h3>')
    if start > 0:
        text = text[start:]
    # 只保留白名单标签，避免模型塞进来 script/style
    text = re.sub(r'<(script|style)[^>]*>.*?</\1>', '', text, flags=re.S | re.I)
    return text.strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--only', type=int, default=0)
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--min-chars', type=int, default=260)
    args = parser.parse_args()

    courses = load_courses()
    client = ArkClient()
    if not client.key:
        print('[draft] no API key, abort')
        return 1

    jobs = []
    for chapter in courses:
        if args.only and chapter['id'] != args.only:
            continue
        for kp in chapter['knowledge_points']:
            if args.force or len(kp.get('content') or '') < args.min_chars:
                jobs.append((chapter, kp))

    print('[draft] %d knowledge points to write' % len(jobs), flush=True)
    ok = fail = 0
    for chapter, kp in jobs:
        prompt = build_prompt(chapter, kp)
        t0 = time.time()
        try:
            raw = client.complete([
                {'role': 'system', 'content': SYSTEM},
                {'role': 'user', 'content': prompt},
            ], max_tokens=2600)
        except ArkError as exc:
            print('[draft] FAIL ch%s kp%s: %s' % (chapter['id'], kp['index'], exc), flush=True)
            fail += 1
            time.sleep(2)
            continue
        html = clean_output(raw)
        hanzi = len(COUNT_WORDS.findall(re.sub('<[^>]+>', '', html)))
        if hanzi < 200:
            print('[draft] TOO SHORT ch%s kp%s (%d chars)' % (chapter['id'], kp['index'], hanzi), flush=True)
            fail += 1
            continue
        kp['content'] = html
        chapter['has_content'] = all(len(item.get('content') or '') > 100
                                     for item in chapter['knowledge_points'])
        save_courses(courses)
        ok += 1
        print('[draft] OK ch%s kp%s "%s" %d chars %.1fs'
              % (chapter['id'], kp['index'], kp['title'], hanzi, time.time() - t0), flush=True)

    print('[draft] done ok=%d fail=%d' % (ok, fail), flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
