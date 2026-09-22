"""自检：课程数据里引用的每个静态资源是否真的存在。

为什么要单独一个脚本：课程正文是从教材自动转换来的，图片路径由正则改写。
改写规则一旦和实际目录结构不一致，页面就会显示一堆碎图 —— 而碎图在
整页截图里不容易发现（尤其是教材截图，它们本来就像"内容"）。
这个脚本把「引用 → 实际文件」逐条对上，缺一个就报错退出。

用法：python tools/verify_assets.py
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(ROOT, 'static')

# 检查三类引用：课程数据里的图片、章节页引用的 CG/实验室、CG 注册表
ASSET_RE = re.compile(r'/static/([A-Za-z0-9_\-./]+\.(?:png|jpg|jpeg|svg|gif|webp|mp3|mp4|js|css))')


def check_courses():
    path = os.path.join(ROOT, 'data', 'courses.json')
    with open(path, encoding='utf-8') as handle:
        courses = json.load(handle)
    refs = set()
    for chapter in courses:
        blob = json.dumps(chapter, ensure_ascii=False)
        for match in ASSET_RE.finditer(blob):
            refs.add(match.group(1))
    return refs


def check_templates():
    refs = set()
    folder = os.path.join(ROOT, 'templates')
    for name in os.listdir(folder):
        if not name.endswith('.html'):
            continue
        with open(os.path.join(folder, name), encoding='utf-8') as handle:
            text = handle.read()
        # 模板里是 url_for 生成的，只抓写死的 /static/ 路径
        for match in ASSET_RE.finditer(text):
            refs.add(match.group(1))
    return refs


def check_registry():
    path = os.path.join(ROOT, 'data', 'cg_registry.json')
    if not os.path.isfile(path):
        return set()
    with open(path, encoding='utf-8') as handle:
        registry = json.load(handle)
    refs = set()
    for items in registry.values():
        for item in items:
            refs.add(item['url'].replace('/static/', '', 1))
    return refs


def main():
    groups = {
        '课程正文图片': check_courses(),
        'CG / 实验室入口': check_registry(),
        '模板写死的资源': check_templates(),
    }
    total = missing_total = 0
    for label, refs in groups.items():
        missing = []
        for ref in sorted(refs):
            total += 1
            if not os.path.exists(os.path.join(STATIC, ref.replace('/', os.sep))):
                missing.append(ref)
        missing_total += len(missing)
        print('%-16s %3d 个引用，缺失 %d 个' % (label, len(refs), len(missing)))
        for ref in missing[:12]:
            print('    ✗ /static/%s' % ref)
        if len(missing) > 12:
            print('    … 另有 %d 个' % (len(missing) - 12))

    # CG 目录里的 SPA 是打包产物，内部资源自洽，只确认入口文件在
    print()
    if missing_total:
        print('共 %d 个引用，%d 个缺失 —— 需要修 build_course_from_textbook.py 的路径映射'
              % (total, missing_total))
        return 1
    print('共 %d 个引用，全部就位' % total)
    return 0


if __name__ == '__main__':
    sys.exit(main())
