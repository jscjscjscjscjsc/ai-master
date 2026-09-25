# -*- coding: utf-8 -*-
"""把教材正文里的练习题反解析回 data/question_bank.json。

为什么需要它
------------
教材正文（教材正文/第NN章_*.md）是**唯一真源**：每节的练习题直接写在
    #### `qXX-YY-ZZ`（题型 · 难度）标题
小节里，含题干、选项、答案、判分要点、解析、起始代码与参考解。
题库以前是**一次性生成**的产物，教材改了之后两边就会漂移；更糟的是
build_static_site.py 每次导出还会用旧数据覆盖前端题库。

本脚本把映射规则固定下来，让教材成为唯一入口：

    #### `q01-02-03`（单选 · ★★）标题
      -> id / type / difficulty(1-3) / title / statement
    - **A**. ...                -> options + answer
    **答案**：B                  -> answer（0-3 下标）
    **提示**：a；b               -> hints
    **判分要点**                 -> reference（逐条编号）
    **解析与常见错误**：...       -> explanation
    **起始代码** / 参考解         -> starter_code / solution

教材里没有的字段（tags / source / expected_output）保留题库原值，
所以本脚本是「以教材为准的合并」，不会误删人工补充的信息。

用法：
    python tools/sync_question_bank.py --check    # 只报告差异，不写盘
    python tools/sync_question_bank.py            # 写回 data/question_bank.json
"""

import argparse
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEXTBOOK = os.environ.get(
    'STARLAB_TEXTBOOK',
    'C:\\Users\\Admin\uff08\u65e0\u5bc6\u7801\uff09\\Desktop\\\u6570\u636e\u6587\u4ef6\\'
    'AI\u5168\u6808\u5f00\u53d140\u5929\u8bfe\u7a0b\u4f53\u7cfb')
SRC = os.path.join(TEXTBOOK, '\u6559\u6750\u6b63\u6587')
OUT = os.path.join(ROOT, 'data', 'question_bank.json')

CHAPTERS = [
    (1, '\u7b2c01\u7ae0_\u5927\u6a21\u578b\u8ba4\u77e5\u4e0ePrompt\u5de5\u7a0b_Day01-05.md',
     '\u5927\u6a21\u578b\u8ba4\u77e5\u4e0e Prompt \u5de5\u7a0b', 'course'),
    (2, '\u7b2c02\u7ae0_LLM_API\u5de5\u7a0b\u5316\u4e0eAI\u540e\u7aef_Day06-10.md',
     'LLM API \u5de5\u7a0b\u5316\u4e0e AI \u540e\u7aef', 'course'),
    (3, '\u7b2c03\u7ae0_RAG\u68c0\u7d22\u589e\u5f3a\u751f\u6210_Day11-16.md',
     'RAG \u68c0\u7d22\u589e\u5f3a\u751f\u6210', 'course'),
    (4, '\u7b2c04\u7ae0_Agent\u6838\u5fc3\u673a\u5236_Day17-20.md',
     'Agent \u6838\u5fc3\u673a\u5236\uff08\u4ece\u96f6\u81ea\u7814\uff09', 'agent'),
    (5, '\u7b2c05\u7ae0_Agent\u6846\u67b6\u5b9e\u6218_Day21-25.md',
     'Agent \u6846\u67b6\u5b9e\u6218', 'agent'),
    (6, '\u7b2c06\u7ae0_\u591a\u667a\u80fd\u4f53\u7cfb\u7edf\u4e0eMCP_Day26-30.md',
     '\u591a\u667a\u80fd\u4f53\u7cfb\u7edf\u4e0e MCP', 'agent'),
    (7, '\u7b2c07\u7ae0_\u5f00\u6e90Agent\u9879\u76ee\u6e90\u7801\u62c6\u89e3_Day31-34.md',
     '\u5f00\u6e90 Agent \u9879\u76ee\u6e90\u7801\u62c6\u89e3', 'course'),
    (8, '\u7b2c08\u7ae0_\u6a21\u578b\u5fae\u8c03\u4e0e\u4e0a\u4e0b\u6587\u5de5\u7a0b_Day35-37.md',
     '\u6a21\u578b\u5fae\u8c03\u4e0e\u4e0a\u4e0b\u6587\u5de5\u7a0b', 'course'),
    (9, '\u7b2c09\u7ae0_\u5168\u6808\u843d\u5730\u4e0e\u6bd5\u4e1a\u9879\u76ee_Day38-40.md',
     '\u5168\u6808\u843d\u5730\u4e0e\u6bd5\u4e1a\u9879\u76ee', 'course'),
]

HDR = re.compile(
    r'^#### `(q\d{2}-\d{2}-\d{2})`\uff08(\u5355\u9009|\u7b80\u7b54|\u4ee3\u7801) '
    r'\u00b7 ([^\uff09]+)\uff09(.+?)\s*$')
DAY_RE = re.compile(r'^## (?:\d+\.\d+ )?Day (\d{2})\uff5c(.+?)\s*$')
OPT_RE = re.compile(r'^- \*\*([A-D])\*\*\.\s*(.+?)\s*$')
TYPE_MAP = {'\u5355\u9009': 'choice', '\u7b80\u7b54': 'short', '\u4ee3\u7801': 'code'}
M_ANSWER = '**\u7b54\u6848**\uff1a'
M_HINT = '**\u63d0\u793a**\uff1a'
M_JUDGE = '**\u5224\u5206\u8981\u70b9**'
M_EXPL = '**\u89e3\u6790\u4e0e\u5e38\u89c1\u9519\u8bef**\uff1a'
M_START = '**\u8d77\u59cb\u4ee3\u7801**'
M_REF = '\u53c2\u8003\u89e3'
FENCE = re.compile(r'^```')
TAGS = ['tags', 'source', 'expected_output']

# 教材里没有、必须从旧题库保留的字段（tags/source/expected_output）

def parse_day_index(lines):
    """返回 [(行号, 天号, 当天标题, 章内序号)]，章内序号从 0 开始。"""
    out = []
    for i, line in enumerate(lines):
        m = DAY_RE.match(line)
        if m:
            out.append((i, m.group(1), 'Day %s\uff5c%s' % (m.group(1), m.group(2)), len(out)))
    return out

def fence_blocks(block):
    """抽出 ``` 围栏内的代码块文本列表。"""
    blocks, cur, inside = [], [], False
    for line in block:
        if FENCE.match(line):
            if inside:
                blocks.append('\n'.join(cur)); cur = []; inside = False
            else:
                inside = True
            continue
        if inside:
            cur.append(line)
    if inside:
        blocks.append('\n'.join(cur))
    return blocks

def parse_block(qid, kind, stars, title, block):
    """把一个题目小节的正文解析成字段字典。"""
    marks = []
    for i, line in enumerate(block):
        if line.startswith(M_ANSWER) or line.startswith(M_HINT) or line.startswith(M_JUDGE) \
           or line.startswith(M_EXPL) or line.startswith(M_START) \
           or line.startswith('<details>') or OPT_RE.match(line):
            marks.append(i)
    first = marks[0] if marks else len(block)
    statement = '\n'.join(block[:first]).strip()

    record = {'type': TYPE_MAP[kind], 'title': title.strip(),
              'difficulty': stars.count('\u2605'), 'statement': statement}
    options, hints, reference, explanation = [], [], [], ''
    idx = 0
    while idx < len(block):
        line = block[idx]
        if OPT_RE.match(line):
            options.append(OPT_RE.match(line).group(2))
            idx += 1; continue
        if line.startswith(M_ANSWER) or line.startswith(M_HINT):
            text = line.split('\uff1a', 1)[1].strip() if '\uff1a' in line else ''
            if line.startswith(M_ANSWER):
                record['_answer_letter'] = text
            else:
                hints = [x.strip() for x in text.split('\uff1b') if x.strip()]
            idx += 1; continue
        if line.startswith(M_JUDGE) or line.startswith(M_EXPL):
            if line.startswith(M_EXPL):
                record['explanation'] = line.split('\uff1a', 1)[1].strip()
                idx += 1; continue
            idx += 1
            bullets = []
            while idx < len(block) and block[idx].startswith('- '):
                bullets.append(block[idx][2:].strip()); idx += 1
            reference = bullets
            continue
        if line.startswith(M_START):
            record['starter_code'] = (fence_blocks(block[idx:]) or [''])[0]
            idx += 1; continue
        if line.startswith('<details>'):
            record['solution'] = (fence_blocks(block[idx:]) or [''])[0]
            idx += 1; continue
        idx += 1

    if options:
        record['options'] = options
        letter = record.pop('_answer_letter', '')
        record['answer'] = 'ABCD'.index(letter) if letter in 'ABCD' else -1
    else:
        record.pop('_answer_letter', None)
        record['hints'] = hints
    if reference:
        record['reference'] = '\n'.join('%d. %s' % (i + 1, x) for i, x in enumerate(reference))
    return record

def collect():
    """扫全部章节文件，返回 {id: record} 与顺序列表。"""
    records, order = {}, []
    for cid, fname, ctitle, track in CHAPTERS:
        path = os.path.join(SRC, fname)
        lines = open(path, encoding='utf-8').read().split('\n')
        days = parse_day_index(lines)
        for qi, line in enumerate(lines):
            m = HDR.match(line)
            if not m:
                continue
            qid, kind, star_s, title = m.group(1), m.group(2), m.group(3), m.group(4)
            end = qi + 1
            while end < len(lines) and not lines[end].startswith(('#### ', '### ', '## ')):
                end += 1
            day = [d for d in days if d[0] < qi]
            day_no, kp_title, kp_index = (day[-1][1], day[-1][2], day[-1][3]) if day else ('00', '', 0)
            rec = parse_block(qid, kind, star_s, title, lines[qi + 1:end])
            rec.update({'id': qid, 'chapter_id': cid, 'chapter_title': ctitle,
                        'kp_index': kp_index, 'kp_title': kp_title, 'track': track,
                        'day': day_no})
            records[qid] = rec; order.append(qid)
    return records, order

def merge(records, order, old):
    """教材字段为准；tags/source/expected_output 等教材没有的字段沿用旧值。"""
    old_by_id = {q['id']: q for q in old}
    out, changes = [], []
    for qid in order:
        rec = dict(records[qid])
        prev = old_by_id.get(qid)
        rec.pop('day', None)
        if prev:
            for key in TAGS:
                if prev.get(key) not in (None, '', []):
                    rec[key] = prev[key]
            if 'reference' not in rec and prev.get('reference'):
                rec['reference'] = prev['reference']
            if not rec.get('explanation') and prev.get('explanation'):
                rec['explanation'] = prev['explanation']
            for key, val in prev.items():
                if key not in rec and key not in ('id', 'chapter_id', 'kp_index', 'type', 'day'):
                    rec[key] = val
            for key in ('title', 'difficulty', 'statement', 'reference', 'explanation',
                        'kp_title', 'kp_index', 'chapter_title', 'track',
                        'starter_code', 'solution'):
                if key in rec and prev.get(key) != rec[key]:
                    changes.append((qid, key, prev.get(key), rec[key]))
            if 'options' in rec and prev.get('options') != rec['options']:
                changes.append((qid, 'options', prev.get('options'), rec['options']))
            if 'answer' in rec and prev.get('answer') != rec['answer']:
                changes.append((qid, 'answer', prev.get('answer'), rec['answer']))
            if 'hints' in rec and prev.get('hints') != rec['hints']:
                changes.append((qid, 'hints', prev.get('hints'), rec['hints']))
        else:
            rec.setdefault('hints', [])
            rec.setdefault('tags', [])
            rec.setdefault('source', 'generated')
            changes.append((qid, 'NEW', None, 'added'))
        rec.setdefault('starter_code', '')
        rec.setdefault('solution', '')
        rec.setdefault('hints', [])
        out.append(rec)
    missing = [q['id'] for q in old if q['id'] not in records]
    return out, changes, missing

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='只报告差异，不写盘')
    args = ap.parse_args()

    records, order = collect()
    old = json.load(open(OUT, encoding='utf-8'))
    merged, changes, missing = merge(records, order, old)

    print('\u6559\u6750\u9898\u76ee\uff1a%d  \u65e7\u9898\u5e93\uff1a%d  \u5408\u5e76\u540e\uff1a%d'
          % (len(records), len(old), len(merged)))
    print('\u5dee\u5f02\u6761\u76ee\uff1a%d' % len(changes))
    for qid, key, before, after in changes:
        b = json.dumps(before, ensure_ascii=False)
        a = json.dumps(after, ensure_ascii=False)
        print('  %-12s %-12s %s  ->  %s' % (qid, key, b[:110], a[:110]))
    if missing:
        print('\u4ec5\u5728\u65e7\u9898\u5e93\u3001\u6559\u6750\u5df2\u79fb\u9664\uff1a%s' % ', '.join(missing))
    if args.check:
        print('\n(--check\uff0c\u672a\u5199\u76d8)')
        return 0
    with open(OUT, 'w', encoding='utf-8', newline='') as handle:
        json.dump(merged, handle, ensure_ascii=False, indent=1)
        handle.write('\n')
    print('\n\u5df2\u5199\u56de\uff1a%s' % OUT)
    return 0

if __name__ == '__main__':
    sys.exit(main())
