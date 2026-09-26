"""智能体工具调用循环。

职责很单一：把「模型 → 工具 → 模型」这个循环跑起来，并把中间过程
以事件流的形式吐给前端。它不碰业务、不碰网络细节，工具和模型都是注入的。

循环长这样（参考 DeepTutor 的 chat loop 与 Qwen-Agent 的 agent loop）：

    学生说话
      ↓
    模型判断：要不要用工具？
      ├─ 不用 → 直接回答，结束
      └─ 用  → 执行工具（画图/跳页/查进度）
                ↓
              把工具结果塞回上下文
                ↓
              模型基于结果继续回答（可以再调工具，最多 max_rounds 轮）

为什么要限制轮数：模型偶尔会陷入「反复调同一个工具」。给个上限，
到顶就用已有信息收尾，绝不让学生的对话卡死。
"""

from __future__ import annotations

import json

# 系统提示词。把「有哪些工具」和「平台里有什么」讲清楚，模型才知道怎么选。
AGENT_SYSTEM_PROMPT = """你是 AI Master 学习平台里的学习助手，可以直接操作这个平台。

你的能力分两类：
1. **画图**：draw_mindmap（思维导图）、draw_flowchart（流程图）、draw_array（数组示意图）。
   学生只要提到「画」「梳理」「看看结构」「怎么走的」，就调用工具，不要用文字描述。
2. **操控平台**：goto_chapter（跳章节）、open_page（打开页面）、check_progress（查进度）、
   create_roadmap（生成学习路线）。

几条硬规矩：
- **全程用中文回答**，不要出现英文句子（技术名词如 Transformer、RAG 保留原文即可）。
- **绝对不要用文字画图**。不许用 ``` 代码块、不许用 ├─ │ └─ 这类树形字符、不许用箭头串
  拼出结构图。学生要图，你就调用画图工具；系统会把图画成真正的图形卡片给他看。
  用字符画图是本平台明确禁止的行为。
- **不要预告你要做什么**。不要说「好的，我来画一个…」这句话，系统已经显示了
  「正在画思维导图」的进度提示。直接调用工具，画完再解释。
- 学生问「我该学什么」「我哪里不行」「我的进度」之前，**必须先调 check_progress**，
  不要凭空猜他的水平。
- 学生说「跳到」「打开」「我想看」时，用 goto_chapter 或 open_page，别只回复一个链接。
- 一次回答不要调超过 3 个工具。画图工具一次调用就够了，画完用一两句话点出重点。
- 图的内容必须来自本平台课程讲过的知识，不要编造课程里没有的概念。节点文字要短
  （一级分支 8 字以内，二级节点 14 字以内），这样画出来才好看。
- 如果学生只是闲聊或问概念，不用调工具，正常回答即可。

【平台课程目录】
%s
"""


class AgentTurn:
    """一次完整的智能体回合，记录它做了什么，便于前端展示与后端留痕。"""

    def __init__(self):
        self.text = ''
        self.renders = []          # 要画给学生看的图
        self.action = None         # 导航动作（最后一个生效）
        self.action_url = ''
        self.tools_used = []
        self.rounds = 0
        self.error = ''
        self.roadmap = None


def build_catalog(courses):
    """把课程目录压成一小段文本给模型看，它才知道章节编号怎么对应。"""
    rows = []
    for chapter in courses or []:
        kps = chapter.get('knowledge_points') or []
        titles = '、'.join('%d.%s' % (kp['index'], str(kp['title'])[:14]) for kp in kps[:4])
        rows.append('第%s章《%s》：%s%s'
                    % (chapter.get('id'), str(chapter.get('title'))[:16],
                       titles, ' 等' if len(kps) > 4 else ''))
    return '\n'.join(rows) if rows else '（课程目录为空）'


def _tool_message(call, result):
    """工具执行结果回喂给模型的标准格式。

    只把模型**需要知道**的部分放进去：成功与否、说了什么、拿到什么数据。
    render（画图数据）不回喂 —— 那是给前端渲染用的，几 KB 的 JSON 塞回上下文
    既浪费 token 又会干扰模型，只留一句 summary 足够它接着说话。
    """
    payload = {'ok': result.get('ok', True)}
    if result.get('summary'):
        payload['summary'] = result['summary']
    if result.get('error'):
        payload['error'] = result['error']
    if result.get('progress'):
        payload['progress'] = result['progress']
    return {'role': 'tool', 'tool_call_id': call.get('id') or 'call_0',
            'content': json.dumps(payload, ensure_ascii=False)}


# 学生明确想要一张图时出现的词。用来做兜底重试的判断，不做意图理解。
_DRAW_HINTS = ('画', '导图', '思维导图', '结构图', '流程图', '示意图', '梳理', '脉络', '树状')
# 字符画特征：模型偷懒用文字画图时会出现的痕迹
_ASCII_ART = ('├', '└', '│', '┌', '┐', '└─', '```')


def _wants_drawing(question):
    return any(hint in str(question or '') for hint in _DRAW_HINTS)


def _looks_like_ascii_art(text):
    return any(mark in str(text or '') for mark in _ASCII_ART)


def run_agent(ark, registry, question, ctx, max_rounds=4):
    """跑一次智能体回合，产出事件流。

    事件类型：
      stage      —— 阶段提示，前端显示「正在画思维导图…」
      delta      —— 模型输出的文字增量
      render     —— 要渲染的图（mindmap / flowchart / array）
      navigate   —— 导航动作，前端据此跳页
      tool       —— 工具执行结果（供调试与展示）
      done       —— 收尾，带上整轮的汇总信息
    """
    turn = AgentTurn()
    catalog = build_catalog(ctx.get('courses'))
    user_content = ctx.get('user_content') or question
    messages = [
        {'role': 'system', 'content': AGENT_SYSTEM_PROMPT % catalog},
        {'role': 'user', 'content': user_content},
    ]
    specs = registry.specs()
    # 学生要图但模型没调工具时，最多补救一次。不靠模型自觉，靠机制兜底。
    retried_for_drawing = False

    for round_no in range(1, max_rounds + 1):
        turn.rounds = round_no
        pending = None
        text = ''
        for event in ark.events(messages, max_tokens=1400, temperature=0.3,
                                tools=specs if specs else None):
            kind = event.get('type')
            if kind == 'delta':
                text += event['text']
                turn.text += event['text']
                yield event
            elif kind == 'tool_calls':
                pending = event['calls']
            elif kind == 'switch':
                yield event
            elif kind == 'model' and round_no == 1:
                yield {'type': 'status', 'message': '正在想…'}

        if not pending:
            # 兜底：学生明确要图、模型却交了文字（尤其字符画），
            # 说明它没听话。作废这段输出，加一条强指令让它重来。
            if (not retried_for_drawing and not turn.tools_used
                    and _wants_drawing(question)
                    and (_looks_like_ascii_art(text) or len(text) > 240)):
                retried_for_drawing = True
                messages.append({'role': 'assistant', 'content': text or ''})
                messages.append({'role': 'user', 'content':
                    '停。我刚说的是要一张图，不是一段文字。请立刻调用 draw_mindmap 或 '
                    'draw_flowchart 把图画出来，不要用代码块或 ├─ │ 这类字符画图，'
                    '也不要用文字罗列结构。'})
                turn.text = turn.text[:-len(text)] if text and turn.text.endswith(text) else turn.text
                if text:
                    yield {'type': 'reset_text'}
                continue
            break                              # 正常没工具调用 → 回合结束

        # 模型经常在调工具前先说一句「好的，我来画一个…」（有时还是英文）。
        # 这句话是过程噪音，而且系统已经用 stage 事件显示了进度，
        # 所以带工具调用的那一轮文字直接丢掉，让前端清空气泡。
        if text:
            turn.text = turn.text[:-len(text)] if turn.text.endswith(text) else turn.text
            yield {'type': 'reset_text'}
            text = ''

        # 把这一轮的工具调用记进上下文，再逐个执行
        messages.append({
            'role': 'assistant',
            'content': text or '',
            'tool_calls': [{'id': c.get('id') or 'call_%d' % i,
                            'type': 'function',
                            'function': {'name': c.get('name') or '',
                                         'arguments': c.get('arguments') or '{}'}}
                           for i, c in enumerate(pending)],
        })

        for call in pending:
            name = call.get('name') or ''
            tool = registry.get(name)
            label = TOOL_LABELS.get(name, name)
            yield {'type': 'stage', 'tool': name, 'message': label[0]}
            result = registry.run(name, call.get('arguments') or '{}', ctx)
            turn.tools_used.append({'name': name, 'ok': bool(result.get('ok')),
                                    'args': call.get('arguments') or '{}'})
            if result.get('render'):
                turn.renders.append(result['render'])
                yield {'type': 'render', 'render': result['render']}
            if result.get('action'):
                turn.action = result['action']
                turn.action_url = result.get('action_url') or turn.action_url
                yield {'type': 'navigate', 'action': result['action'],
                       'action_url': turn.action_url}
            if result.get('roadmap'):
                turn.roadmap = result['roadmap']
            yield {'type': 'tool', 'tool': name, 'ok': bool(result.get('ok')),
                   'label': label[1] if result.get('ok') else '这一步没做成',
                   'message': result.get('summary') or result.get('error') or ''}
            messages.append(_tool_message(call, result))
    else:
        turn.error = '工具调用轮数达到上限'

    yield {'type': 'done', 'turn': {
        'text': turn.text,
        'tools_used': turn.tools_used,
        'rounds': turn.rounds,
        'action': turn.action,
        'action_url': turn.action_url,
        'renders': len(turn.renders),
        'roadmap': turn.roadmap,
        'error': turn.error,
    }}


# 工具的「正在做什么 / 做完了」两句话，给学生看的
TOOL_LABELS = {
    'draw_mindmap': ('正在梳理成思维导图…', '思维导图已画好'),
    'draw_flowchart': ('正在画流程图…', '流程图已画好'),
    'draw_array': ('正在画示意图…', '示意图已画好'),
    'goto_chapter': ('正在翻章节…', '已经带你去对应章节'),
    'open_page': ('正在打开页面…', '页面已打开'),
    'check_progress': ('正在看你的学习记录…', '已读到你的进度'),
    'create_roadmap': ('正在排学习路线…', '学习路线已生成'),
}
