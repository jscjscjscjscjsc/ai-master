"""为每个知识点生成练习题，写出 data/question_bank.json。

题型分三类，比例刻意做成 4:3:3：
  choice  —— 概念辨析选择题（本地判分，秒出结果）
  short   —— 简答 / 对比 / 场景题（AI 评分，考「能不能讲清楚」）
  code    —— 写代码 / 读代码题（AI 评分，考「能不能落下来」）

为什么要生成而不是手写：13 章 78 个知识点，手写要几百道题且极易与正文脱节。
生成时把**正文原文**喂给模型，题目就必然贴着讲过的内容；同时要求它给出
「标准答案要点」，AI 评分时用这份要点做参照，评分的依据也就固定下来了。

可中断续跑：每题生成后立刻落盘，重跑只补缺失的知识点。
用法：
    python tools/build_question_bank.py               # 补齐所有缺口
    python tools/build_question_bank.py --only 4 5 6  # 只做这几章
    python tools/build_question_bank.py --rebuild     # 全部重做（先备份）
"""

import argparse
import json
import os
import re
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from ark_client import ArkClient, ArkError  # noqa: E402

COURSES = os.path.join(ROOT, 'data', 'courses.json')
BANK = os.path.join(ROOT, 'data', 'question_bank.json')

SYSTEM = """你是「AI 全栈开发」课程的出题人。教材按天编排，每一天包含
讲授内容、可运行的代码、真实运行截图、当日验收清单、常见错误与排查表。

出题时优先考这几类，因为它们才是这门课真正的要求：
1. **当日验收点** —— 教材写了「验收：进程重启后仍记得历史」，就考它为什么重要、怎么验。
2. **常见错误** —— 教材列出的错误与排查顺序，直接做成判断题或排序题。
3. **必须能说清楚的事实** —— 数字、参数、公式、协议字段、错误码。
4. **工程判断** —— 什么时候不该这么做、代价是什么、有几种方案怎么选。
不要考背诵教材目录或章节编号。不要考正文里没依据的东西。

输出**严格的 JSON 数组**，不要 Markdown 代码围栏，不要任何解释文字。数组每一项形如：

选择题：
{"type":"choice","title":"简短题目标题(不超过 22 字)","difficulty":1,
 "statement":"题干。可以有 2-4 行，用 \\n 分段。",
 "options":["选项一","选项二","选项三","选项四"],"answer":0,
 "explanation":"为什么这个答案对，其他为什么错。100-200 字。",
 "reference":"标准答案要点，3-5 条，用 1. 2. 3. 编号",
 "tags":["标签1","标签2"]}

简答题：
{"type":"short","title":"...","difficulty":2,
 "statement":"题干。要求考生做对比、讲原理或分析场景，不能一句话答完。",
 "reference":"标准答案要点，4-6 条，用 1. 2. 3. 编号。这是 AI 评分的参照，要具体。",
 "hints":["提示一","提示二"],
 "explanation":"答题思路与常见失分点。100-200 字。",
 "tags":["..."]}

代码题：
{"type":"code","title":"...","difficulty":2,
 "statement":"题干 + 明确要求。若需要写代码，说清输入输出。",
 "starter_code":"# 给出起步代码或骨架\\n",
 "solution":"参考实现，可运行。",
 "reference":"标准答案要点，4-6 条，说明关键步骤与易错点。",
 "hints":["提示一","提示二"],
 "explanation":"思路讲解与常见错误。100-200 字。",
 "tags":["..."]}

出题硬要求：
1. difficulty 只能取 1（基础）/2（进阶）/3（挑战）之一。难度要真的分层：
   1 = 概念辨认与应用，2 = 需要推理或对比，3 = 综合设计或易错陷阱。
2. 选择题必须有 4 个选项、且 answer 是 0-3 的整数下标；干扰项要像真的、错得有道理，
   禁止「以上都对」「以上都不对」这类凑数选项。
3. 题目必须能从给定正文中找到依据，禁止问正文里没讲的东西。
4. 禁止出现「根据材料」「本文提到」这类元话语，直接问题目本身。
5. code 题的 solution 必须是能跑通的完整代码；starter_code 不要泄露答案。
6. 全中文（技术名词保留英文原词）。选项与题干里不要出现 A. B. C. 前缀。
7. **简洁优先**：explanation 控制在 80-120 字，reference 每条不超过 25 字。
   解析越长越容易被截断，而截断的批次要重跑，得不偿失。"""

USER_TMPL = """课程：{chapter_title}（第 {chapter_id} 章）
知识点：{kp_title}

【知识点正文】
{content}

请出 {n_choice} 道选择题、{n_short} 道简答题、{n_code} 道代码题，共 {total} 道。
直接输出 JSON 数组，不要任何其他文字。"""

COUNT_WORDS = re.compile(r'[\u4e00-\u9fff]')
VALID_TYPES = {'choice', 'short', 'code'}


def clean_json(text):
    """模型常在外面包一层围栏或说一句话，这里取出第一个 JSON 数组。

    截断是常态而不是意外：一次要 6-8 道带解析的题，输出很容易顶到 token 上限。
    所以数组没闭合时**不整体丢弃，而是逐个抢救已经完整的那几项** ——
    丢掉 6 道里的最后 1 道，远好过丢掉整批。
    """
    text = (text or '').strip()
    text = re.sub(r'^```[a-zA-Z]*\s*', '', text)
    text = re.sub(r'```\s*$', '', text).strip()
    start = text.find('[')
    if start < 0:
        return None
    body = text[start:]
    try:
        data = json.loads(body)
        if isinstance(data, list):
            return data
    except ValueError:
        pass
    # 逐个对象扫描：用括号配平找出每个完整的 {...}
    items = []
    depth = 0
    in_string = False
    escaped = False
    obj_start = -1
    for index, char in enumerate(body):
        if in_string:
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == '{':
            if depth == 0:
                obj_start = index
            depth += 1
        elif char == '}':
            depth -= 1
            if depth == 0 and obj_start >= 0:
                chunk = body[obj_start:index + 1]
                try:
                    items.append(json.loads(chunk))
                except ValueError:
                    try:
                        items.append(json.loads(re.sub(r',(\s*[}\]])', r'\1', chunk)))
                    except ValueError:
                        pass
                obj_start = -1
    return items or None


def validate(raw, chapter, kp, index):
    """把模型输出过一遍校验，不合格的题直接丢掉而不是带着坏数据入库。"""
    records = []
    for offset, item in enumerate(raw or []):
        if not isinstance(item, dict):
            continue
        kind = item.get('type')
        if kind not in VALID_TYPES:
            continue
        statement = str(item.get('statement') or '').strip()
        title = str(item.get('title') or '').strip() or (kp['title'][:20])
        if len(statement) < 12:
            continue
        try:
            difficulty = int(item.get('difficulty') or 1)
        except (TypeError, ValueError):
            difficulty = 1
        difficulty = min(3, max(1, difficulty))
        record = {
            'id': 'q%02d-%02d-%02d' % (chapter['id'], kp['index'] + 1, offset + 1),
            'type': kind,
            'chapter_id': chapter['id'],
            'chapter_title': chapter['title'],
            'kp_index': kp['index'],
            'kp_title': kp['title'],
            'track': 'agent' if chapter.get('highlight') else 'course',
            'title': title,
            'difficulty': difficulty,
            'statement': statement,
            'reference': str(item.get('reference') or '').strip(),
            'explanation': str(item.get('explanation') or '').strip(),
            'hints': [str(h).strip() for h in (item.get('hints') or []) if str(h).strip()][:3],
            'tags': [str(t).strip() for t in (item.get('tags') or []) if str(t).strip()][:4],
            'source': 'generated',
        }
        if kind == 'choice':
            options = [str(o).strip() for o in (item.get('options') or [])]
            options = [re.sub(r'^[A-Da-d][.、)]\s*', '', o) for o in options if o.strip()]
            try:
                answer = int(item.get('answer'))
            except (TypeError, ValueError):
                continue
            if len(options) != 4 or not 0 <= answer < 4:
                continue
            if len(set(options)) != 4:
                continue
            record['options'] = options
            record['answer'] = answer
        else:
            record['starter_code'] = str(item.get('starter_code') or '').strip()
            record['solution'] = str(item.get('solution') or '').strip()
            if not record['reference']:
                continue
        if len(COUNT_WORDS.findall(record['reference'])) < 12:
            continue
        records.append(record)
    return records


def load_courses():
    with open(COURSES, encoding='utf-8') as fh:
        return json.load(fh)


def load_bank():
    try:
        with open(BANK, encoding='utf-8') as fh:
            data = json.load(fh)
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def save_bank(items):
    os.makedirs(os.path.dirname(BANK), exist_ok=True)
    tmp = BANK + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(items, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, BANK)


def legacy_questions(courses):
    """把课程表里带进来的旧选择题（AI Master 原有自测题）保留在题库前部。"""
    rows = []
    for chapter in courses:
        for item in chapter.get('legacy_questions') or []:
            rows.append(item)
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--only', type=int, nargs='*', default=[])
    parser.add_argument('--rebuild', action='store_true')
    parser.add_argument('--per-kp', default='3,2,2', help='每知识点 选择,简答,代码 数量')
    args = parser.parse_args()

    n_choice, n_short, n_code = (int(x) for x in args.per_kp.split(','))
    courses = load_courses()
    existing = [] if args.rebuild else load_bank()
    # 已有题库全部保留。这里曾经写成「只保留非 generated 的条目」，
    # 结果每次续跑都把上一轮生成好的题丢掉 —— 表现为某个知识点突然没有题。
    # kept 必须是全量，done_keys 才决定这一轮跳过哪些。
    done_keys = {(item.get('chapter_id'), item.get('kp_index')) for item in existing
                 if item.get('source') == 'generated'}
    kept = list(existing)
    legacy = legacy_questions(courses)
    for item in legacy:
        if item not in kept:
            kept.append(item)

    jobs = []
    for chapter in courses:
        if args.only and chapter['id'] not in args.only:
            continue
        for kp in chapter['knowledge_points']:
            if (chapter['id'], kp['index']) in done_keys:
                continue
            if len(kp.get('content') or '') < 200:
                print('[bank] skip ch%s kp%s (no content yet)' % (chapter['id'], kp['index']))
                continue
            jobs.append((chapter, kp))

    print('[bank] %d knowledge points to populate (%d legacy kept)'
          % (len(jobs), len(kept)), flush=True)
    client = ArkClient()
    if not client.key and jobs:
        print('[bank] no API key, abort')
        return 1

    generated = []
    total = 0
    for chapter, kp in jobs:
        body = re.sub('<[^>]+>', ' ', kp.get('content') or '')
        body = re.sub(r'\s+', ' ', body).strip()[:5000]
        prompt = USER_TMPL.format(
            chapter_title=chapter['title'], chapter_id=chapter['id'], kp_title=kp['title'],
            content=body, n_choice=n_choice, n_short=n_short, n_code=n_code,
            total=n_choice + n_short + n_code)
        t0 = time.time()
        try:
            raw = client.complete([
                {'role': 'system', 'content': SYSTEM},
                {'role': 'user', 'content': prompt},
            ], max_tokens=4200, temperature=0.5)
        except ArkError as exc:
            print('[bank] FAIL ch%s kp%s: %s' % (chapter['id'], kp['index'], exc), flush=True)
            time.sleep(2)
            continue
        parsed = clean_json(raw)
        records = validate(parsed, chapter, kp, kp['index'])
        if len(records) < n_choice + n_short:  # 代码题允许模型偶尔不出
            print('[bank] WEAK ch%s kp%s only %d valid, retry once'
                  % (chapter['id'], kp['index'], len(records)), flush=True)
            try:
                raw = client.complete([
                    {'role': 'system', 'content': SYSTEM},
                    {'role': 'user', 'content': prompt + '\n\n上次的输出格式不合要求，请只输出合法 JSON 数组。'},
                ], max_tokens=4200, temperature=0.35)
                more = validate(clean_json(raw), chapter, kp, kp['index'])
                if len(more) > len(records):
                    records = more
            except ArkError:
                pass
        if not records:
            print('[bank] EMPTY ch%s kp%s' % (chapter['id'], kp['index']), flush=True)
            continue
        generated.extend(records)
        total += len(records)
        save_bank(kept + generated)
        print('[bank] OK ch%s kp%s "%s" %d 题 %.1fs'
              % (chapter['id'], kp['index'], kp['title'], len(records), time.time() - t0), flush=True)

    final = kept + generated
    save_bank(final)
    by_type = {}
    for item in final:
        by_type[item.get('type', '?')] = by_type.get(item.get('type', '?'), 0) + 1
    print('[bank] done: %d questions (%s)' % (len(final), by_type), flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
