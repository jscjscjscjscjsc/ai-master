"""把《AI 全栈开发 40 天》教材正文转成平台的 courses.json。

为什么单独一个转换器而不是手抄
------------------------------
这门课的教材是**权威内容**：9 章 40 天，每天一个知识点，正文里带真实运行截图、
真实实验数据、真实报错与排查表。手抄会引入错误，也跟不上教材修订。
转换器把「教材结构」映射成「平台结构」，映射规则写在这里：

    ## Day NN｜标题        →  一个知识点（index 按出现顺序，course_day = NN）
    第一个 Day 之前的内容   →  chapter.overview（章节导论，渲染在章节页顶部）
    最后一个 Day 之后的内容 →  chapter.summary（常见错误 / 参考资料 / 下一章预告）

这样切的原因是：教材的一天 = 一次课 = 一个知识点，与平台的「逐日路线」天然对齐，
学生看到的「第 7 天」和教材写的「Day 07」是同一个东西。

图片路径：教材里写 `../assets/chNN/x.png` 与 `../figures/x.png`，
复制到 static/course-assets/ 之后统一改写成 `/static/course-assets/...`。

用法：
    python tools/build_course_from_textbook.py
"""

import json
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEXTBOOK = os.environ.get(
    'STARLAB_TEXTBOOK',
    r'C:\Users\Admin（无密码）\Desktop\数据文件\AI全栈开发40天课程体系')
OUT = os.path.join(ROOT, 'data', 'courses.json')
ASSET_OUT = os.path.join(ROOT, 'static', 'course-assets')

# 章节清单：(章节号, 教材文件名, 标题, 图标, 阶段, 阶段名, 是否主线, 难度, 标签)
CHAPTERS = [
    (1, '第01章_大模型认知与Prompt工程_Day01-05.md', '大模型认知与 Prompt 工程', '🧠', 1,
     '阶段一 · 认知与工程地基', False, '入门',
     ['LLM 认知', 'Token', 'Embedding', 'Prompt 工程', '评测']),
    (2, '第02章_LLM_API工程化与AI后端_Day06-10.md', 'LLM API 工程化与 AI 后端', '🔌', 1,
     '阶段一 · 认知与工程地基', False, '核心',
     ['异步', 'FastAPI', 'SSE 流式', '限流重试', '日志']),
    (3, '第03章_RAG检索增强生成_Day11-16.md', 'RAG 检索增强生成', '📚', 2,
     '阶段二 · 知识增强', False, '核心',
     ['文档加载', 'Chunking', '向量检索', 'BM25', 'RRF 重排', 'RAG 评测']),
    (4, '第04章_Agent核心机制_Day17-20.md', 'Agent 核心机制（从零自研）', '🛰️', 3,
     '阶段三 · 智能体内核（主线）', True, '核心',
     ['Function Calling', 'ReAct', '记忆系统', '安全护栏', 'MCP']),
    (5, '第05章_Agent框架实战_Day21-25.md', 'Agent 框架实战', '🔧', 3,
     '阶段三 · 智能体内核（主线）', True, '进阶',
     ['LangGraph', 'Checkpoint', '人工审批', 'CrewAI', '框架选型']),
    (6, '第06章_多智能体系统与MCP_Day26-30.md', '多智能体系统与 MCP', '🕸️', 3,
     '阶段三 · 智能体内核（主线）', True, '进阶',
     ['多智能体模式', 'MCP 协议', '可观测性', '成本护栏', '长任务']),
    (7, '第07章_开源Agent项目源码拆解_Day31-34.md', '开源 Agent 项目源码拆解', '🔍', 4,
     '阶段四 · 源码、调优与落地', False, '进阶',
     ['MetaGPT', 'Dify', 'OpenHands', '自研框架']),
    (8, '第08章_模型微调与上下文工程_Day35-37.md', '模型微调与上下文工程', '🎛️', 4,
     '阶段四 · 源码、调优与落地', False, '进阶',
     ['Transformer', 'LoRA', 'QLoRA', '上下文工程', '成本优化']),
    (9, '第09章_全栈落地与毕业项目_Day38-40.md', '全栈落地与毕业项目', '🏗️', 4,
     '阶段四 · 源码、调优与落地', False, '实战',
     ['Gradio', 'Streamlit', 'Docker', 'LLMOps', '答辩']),
]

STAGE_GOAL = {
    1: '看懂模型能做什么、不能做什么，并把它接进一个可用的后端服务',
    2: '给模型接上企业私有知识，并让答案可引用、可评测',
    3: '从手写智能体到生产级编排：工具、记忆、多智能体、MCP 协议',
    4: '读得懂别人的框架源码，调得动模型与成本，交得出能上线的产品',
}
STAGE_COLOR = {1: '#7ee1ff', 2: '#8ff0c8', 3: '#e2b4ff', 4: '#ffd28a'}

# 每个知识点自带的上机时间（教材原文：每天 6 学时 = 讲授 2h + 上机 4h）。
# 这里只把「讲授 2 小时」算进逐日路线的阅读时长，上机时间在正文里说明 ——
# 路线是给人排「今天看什么」的，不是排一整天。
READ_MINUTES = 120

# 教材有两种 Day 标题格式，必须都吃下：
#   ch1/6/7/8/9:  ## Day 01｜走进大模型：首次 API 调用
#   ch2/3/4/5:    ## 2.1 Day 06｜异步编程与多供应商协议
DAY_RE = re.compile(r'^##\s*(?:\d+\.\d+\s+)?Day\s*(\d+)\s*[｜|]\s*(.+?)\s*$', re.M)
H2_RE = re.compile(r'^##\s+(.*)$', re.M)
IMG_RE = re.compile(r'!\[([^\]]*)\]\((\.\./[^)]+)\)')


# ── Markdown → HTML ─────────────────────────────────────
# 教材用的语法很窄（标题 / 段落 / 列表 / 代码块 / 表格 / 图片 / 行内强调），
# 所以手写一个够用的转换器，比引一个第三方库更可控：输出结构由我们决定，
# 平台的 CSS 才能稳定吃到它。

def esc(text):
    return (text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))


def inline(text):
    """行内标记：图片 → 代码 → 粗体 → 斜体 → 链接。顺序不能换。"""
    # 图片（先处理，避免 alt 里的字符被后续规则吃掉）
    def image(match):
        alt, src = match.group(1), match.group(2)
        # 教材写的是 ../assets/ch01/x.png 或 ../figures/x.png。
        # 统一映射成 /static/course-assets/ch01/x.png（去掉多余的一层 assets/），
        # URL 短一截，也方便按章管理资源。
        src = re.sub(r'^\.\./assets/', '/static/course-assets/', src)
        src = re.sub(r'^\.\./figures/', '/static/course-assets/figures/', src)
        return '<img src="%s" alt="%s" loading="lazy">' % (esc(src), esc(alt))
    text = IMG_RE.sub(image, text)
    text = re.sub(r'`([^`]+)`', lambda m: '<code>%s</code>' % esc(m.group(1)), text)
    text = re.sub(r'\*\*([^*]+)\*\*', lambda m: '<strong>%s</strong>' % esc(m.group(1)), text)
    text = re.sub(r'(?<!\*)\*([^*\n]+)\*(?!\*)', lambda m: '<em>%s</em>' % esc(m.group(1)), text)
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)',
                  lambda m: '<a href="%s" target="_blank" rel="noreferrer">%s</a>'
                            % (esc(m.group(2)), esc(m.group(1))), text)
    return text


def convert_table(lines):
    """表格：第一行表头，第二行是 |---:| 对齐行，其余是数据。"""
    def cells(row):
        row = row.strip()
        if row.startswith('|'):
            row = row[1:]
        if row.endswith('|'):
            row = row[:-1]
        return [c.strip() for c in row.split('|')]

    def align_of(spec):
        spec = spec.strip()
        left, right = spec.startswith(':'), spec.endswith(':')
        if left and right:
            return 'center'
        if right:
            return 'right'
        return 'left'

    header = cells(lines[0])
    aligns = [align_of(c) for c in cells(lines[1])]
    body = [cells(row) for row in lines[2:]]
    out = ['<table><thead><tr>']
    for index, cell in enumerate(header):
        align = aligns[index] if index < len(aligns) else 'left'
        out.append('<th style="text-align:%s">%s</th>' % (align, inline(cell)))
    out.append('</tr></thead><tbody>')
    for row in body:
        out.append('<tr>')
        for index, cell in enumerate(row):
            align = aligns[index] if index < len(aligns) else 'left'
            out.append('<td style="text-align:%s">%s</td>' % (align, inline(cell)))
        out.append('</tr>')
    out.append('</tbody></table>')
    return ''.join(out)


def markdown_to_html(md):
    """把一段 markdown 转成 HTML 片段。"""
    lines = md.replace('\r\n', '\n').split('\n')
    out = []
    index = 0
    total = len(lines)
    while index < total:
        # 统一用去掉前导空白的行做块级判定与取内容。
        # 教材里存在「 ### 2.2.1」这种带前导空格的标题；若只看 strip 后的结果判定、
        # 却用原始行取内容，标题会被段落分支吃掉（正文看起来没有小节）。
        line = lines[index].lstrip()
        stripped = line.strip()

        # 代码块
        if stripped.startswith('```'):
            lang = stripped[3:].strip() or 'text'
            index += 1
            block = []
            while index < total and not lines[index].strip().startswith('```'):
                block.append(lines[index])
                index += 1
            index += 1
            out.append('<pre class="code lang-%s"><code>%s</code></pre>'
                       % (esc(lang), esc('\n'.join(block))))
            continue

        # 表格：本行以 | 开头且下一行是同形的分隔行
        if stripped.startswith('|') and index + 1 < total:
            nxt = lines[index + 1].strip()
            if nxt.startswith('|') and re.match(r'^\|[\s:|-]+\|?$', nxt):
                block = []
                while index < total and lines[index].strip().startswith('|'):
                    block.append(lines[index].lstrip())
                    index += 1
                out.append(convert_table(block))
                continue

        # 标题
        if stripped.startswith('#### '):
            out.append('<h5>%s</h5>' % inline(stripped[5:]))
            index += 1
            continue
        if stripped.startswith('### '):
            out.append('<h4>%s</h4>' % inline(stripped[4:]))
            index += 1
            continue
        if stripped.startswith('## '):
            out.append('<h3>%s</h3>' % inline(stripped[3:]))
            index += 1
            continue
        if stripped.startswith('# '):
            out.append('<h3>%s</h3>' % inline(stripped[2:]))
            index += 1
            continue

        # 分隔线
        if re.match(r'^-{3,}$', stripped) or re.match(r'^\*{3,}$', stripped):
            out.append('<hr>')
            index += 1
            continue

        # 引用
        if stripped.startswith('>'):
            block = []
            while index < total and lines[index].strip().startswith('>'):
                block.append(lines[index].strip().lstrip('>').strip())
                index += 1
            out.append('<blockquote>%s</blockquote>' % inline(' '.join(block)))
            continue

        # 无序列表
        if re.match(r'^[-*+]\s+', stripped):
            block = []
            while index < total and re.match(r'^[-*+]\s+', lines[index].strip()):
                block.append(re.sub(r'^[-*+]\s+', '', lines[index].strip()))
                index += 1
            items = ''.join('<li>%s</li>' % inline(item) for item in block)
            out.append('<ul>%s</ul>' % items)
            continue

        # 有序列表
        if re.match(r'^\d+[.)]\s+', stripped):
            block = []
            while index < total and re.match(r'^\d+[.)]\s+', lines[index].strip()):
                block.append(re.sub(r'^\d+[.)]\s+', '', lines[index].strip()))
                index += 1
            items = ''.join('<li>%s</li>' % inline(item) for item in block)
            out.append('<ol>%s</ol>' % items)
            continue

        # 空行
        if not stripped:
            index += 1
            continue

        # 段落：吃到空行或下一个块级开头为止
        block = []
        while index < total:
            current = lines[index].lstrip()
            probe = current.strip()
            if (not probe or probe.startswith(('#', '```', '>'))
                    or re.match(r'^[-*+]\s+', probe) or re.match(r'^\d+[.)]\s+', probe)
                    or re.match(r'^-{3,}$', probe)):
                break
            # 以 | 开头但上面没被当成表格（缺分隔行）—— 当普通文本吃掉，
            # 否则这里会原地打转：既不入 block 也不推进 index。
            block.append(probe)
            index += 1
        if block:
            out.append('<p>%s</p>' % inline(' '.join(block)))
        else:
            # 兜底：任何未被上面分支接住的行，也必须让 index 前进。
            out.append('<p>%s</p>' % inline(stripped))
            index += 1
    return '\n'.join(out)


def plain_length(html):
    return len(re.sub('<[^>]+>', '', html))


TRAILING_RE = re.compile(
    r'^##\s+(?:(\d+)\.)?(\d+)?\s*(本章常见错误速查|常见错误与排查顺序|常见错误与排查|'
    r'过程性作业与答辩题|过程性作业|本章小结与.*衔接|本章小结|教师参考资料|参考资料|'
    r'全课程回顾|结课寄语|毕业自检)\s*$', re.M)


def parse_chapter(path, chapter_id, title):
    with open(path, encoding='utf-8') as handle:
        text = handle.read()

    # H1 标题先删掉（章节标题由课程表提供）。
    # 这一步必须在算 marks **之前**：删掉一行会改变字符串长度，
    # 若先算 marks 再删，后面所有 mark.start()/end() 的偏移就全错位了 ——
    # 表现是「前几天的正文正常，从某一天起小节全部丢失、代码块被压成段落」。
    text = re.sub(r'^#\s+.*$', '', text, count=1, flags=re.M)

    marks = list(DAY_RE.finditer(text))
    if not marks:
        return None, None, None

    overview_md = text[:marks[0].start()]
    day_blocks = []
    for order, mark in enumerate(marks):
        end = marks[order + 1].start() if order + 1 < len(marks) else len(text)
        day_blocks.append((int(mark.group(1)), mark.group(2).strip(), text[mark.end():end]))

    # 收尾块：从最后一个 Day 正文里，找到第一个匹配 TRAILING_RE 的 ## 小节，
    # 它及其之后的所有内容都归到章节总结。
    last_day, last_title, last_body = day_blocks[-1]
    summary_md = ''
    hits = [m for m in TRAILING_RE.finditer(last_body)]
    if hits:
        cut = hits[0].start()
        summary_md = last_body[cut:]
        last_body = last_body[:cut]
    day_blocks[-1] = (last_day, last_title, last_body)

    kps = []
    for order, (day, kp_title, body_md) in enumerate(day_blocks):
        kps.append({
            'index': order,
            'day': day,
            'title': 'Day %02d｜%s' % (day, kp_title),
            'content': markdown_to_html(body_md),
            'minutes': READ_MINUTES,
            'course_day': day,
        })
    return markdown_to_html(overview_md), kps, markdown_to_html(summary_md)


def copy_assets():
    """教材截图与图表复制进平台。它们是真实运行输出，是内容可信度的关键。"""
    if os.path.isdir(ASSET_OUT):
        shutil.rmtree(ASSET_OUT)
    os.makedirs(ASSET_OUT, exist_ok=True)
    copied = 0
    # assets/chNN/  →  course-assets/chNN/     （URL 里不再出现 assets）
    # figures/      →  course-assets/figures/
    source = os.path.join(TEXTBOOK, 'assets')
    if os.path.isdir(source):
        for name in os.listdir(source):
            child = os.path.join(source, name)
            if os.path.isdir(child):
                shutil.copytree(child, os.path.join(ASSET_OUT, name))
    source = os.path.join(TEXTBOOK, 'figures')
    if os.path.isdir(source):
        shutil.copytree(source, os.path.join(ASSET_OUT, 'figures'))
    copied = sum(len(files) for _, _, files in os.walk(ASSET_OUT))
    return copied


def main():
    if not os.path.isdir(TEXTBOOK):
        print('找不到教材目录：%s' % TEXTBOOK)
        print('可用环境变量 STARLAB_TEXTBOOK 指定路径。')
        return 1

    src = os.path.join(TEXTBOOK, '教材正文')
    courses = []
    for chapter_id, filename, title, icon, stage, stage_name, highlight, level, tags in CHAPTERS:
        path = os.path.join(src, filename)
        if not os.path.isfile(path):
            print('缺少教材：%s' % filename)
            return 1
        overview, kps, summary = parse_chapter(path, chapter_id, title)
        days = [kp['course_day'] for kp in kps]
        # 章节描述直接来自它的 Day 标题序列，保证与教材一致、不会写过时的话
        description = 'Day %d–%d：%s' % (min(days), max(days),
                                        '；'.join(kp['title'].split('｜', 1)[1] for kp in kps[:3]))
        if len(kps) > 3:
            description += ' 等 %d 天内容' % len(kps)
        courses.append({
            'id': chapter_id,
            'title': title,
            'icon': icon,
            'stage': stage_name,
            'stage_id': stage,
            'stage_goal': STAGE_GOAL[stage],
            'stage_color': STAGE_COLOR[stage],
            'highlight': highlight,
            'level': level,
            'hours': round(len(kps) * 6, 1),      # 教材口径：6 学时/天
            'description': description,
            'tags': tags,
            'day_start': min(days),
            'day_end': max(days),
            'overview': overview or '',
            'summary': summary or '',
            'knowledge_points': kps,
            'legacy_questions': [],
            'mindmap': '',
            'has_content': all(plain_length(kp['content']) > 400 for kp in kps),
        })
        print('ch%-2d %-26s %2d 天 (Day%02d-%02d)  导论 %d 字 / 收尾 %d 字'
              % (chapter_id, title, len(kps), min(days), max(days),
                 plain_length(overview or ''), plain_length(summary or '')))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as handle:
        json.dump(courses, handle, ensure_ascii=False, indent=1)

    total_kp = sum(len(c['knowledge_points']) for c in courses)
    total_chars = sum(plain_length(kp['content']) for c in courses for kp in c['knowledge_points'])
    images = copy_assets()
    print()
    print('课程表已写出：%s' % OUT)
    print('  %d 章 · %d 个知识点（Day %d-%d）· 正文 %.1f 万字'
          % (len(courses), total_kp, courses[0]['day_start'], courses[-1]['day_end'],
             total_chars / 10000))
    print('  教材截图与图表：%d 个文件 → %s' % (images, ASSET_OUT))
    incomplete = [c['title'] for c in courses if not c['has_content']]
    if incomplete:
        print('  内容偏薄：%s' % ' | '.join(incomplete))
    return 0


if __name__ == '__main__':
    sys.exit(main())
