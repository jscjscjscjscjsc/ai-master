"""智能体工具集 —— 把平台已有能力包装成模型可以直接调用的工具。

设计参考（开源项目的取舍）
------------------------
- **Qwen-Agent** 的 `BaseTool` + 注册表：工具自带 JSON Schema，注册后由框架
  统一导出成模型能看懂的说明书，模型选工具、给参数，框架执行并把结果回喂。
- **DeepTutor** 的两条原则照抄过来：
  1. 「扩展而非分叉」：工具只增加能力，不改变原有问答链路的行为；
  2. 「失败要能退回朴素方案」：任何工具执行失败都不中断对话，把错误当成
     工具结果返回给模型，让模型用文字兜底。
- 权限边界比通用 Agent 小得多：所有工具只能操作本平台自己的数据，
  最坏情况是跳错页面或画错图，不会碰到系统层。

和已有的 `agent_payload`（单轮 JSON + action 白名单）的关系
--------------------------------------------------------
那套是「模型输出一段 JSON，我们解析出 reply 和 action」。它的天花板是
**一次只能做一个动作**。工具调用是它的超集：模型可以连续调多个工具
（先查进度 → 再画导图 → 最后跳页），每一步的结果都能进入下一步的推理。
两者共用同一套白名单校验思想，`normalize_action` 继续复用。
"""

from __future__ import annotations

import json

# ── 工具协议 ────────────────────────────────────────────


class Tool:
    """一个可被模型调用的工具。

    子类要实现 `spec()`（给模型看的说明书）和 `run(args, ctx)`（真正干活）。
    """

    name = ''
    description = ''

    def spec(self):
        raise NotImplementedError

    def run(self, args, ctx):
        raise NotImplementedError

    # 参数清洗的公共小工具
    @staticmethod
    def text(value, limit=40, default=''):
        value = str(value or '').strip().replace('\n', ' ')
        value = ' '.join(value.split())
        return value[:limit] or default

    @staticmethod
    def clamp_int(value, low, high, default):
        try:
            number = int(value)
        except (TypeError, ValueError):
            return default
        return max(low, min(high, number))


class ToolRegistry:
    """工具注册表。和 DeepTutor 的 registry 一样，注册与执行分离。"""

    def __init__(self):
        self._tools = {}

    def register(self, tool):
        self._tools[tool.name] = tool
        return tool

    def get(self, name):
        return self._tools.get(name)

    def names(self):
        return list(self._tools)

    def specs(self):
        """导出成 OpenAI 兼容的函数调用格式，直接塞进请求的 tools 参数。"""
        return [{'type': 'function',
                 'function': {'name': t.name,
                              'description': t.description,
                              'parameters': t.spec()}}
                for t in self._tools.values()]

    def run(self, name, args, ctx):
        """执行工具。**永不抛异常** —— 错误变成工具结果回给模型。"""
        tool = self._tools.get(name)
        if tool is None:
            return {'ok': False, 'error': '没有名为 %s 的工具' % name}
        try:
            if isinstance(args, str):
                args = json.loads(args or '{}')
            if not isinstance(args, dict):
                args = {}
        except (ValueError, TypeError):
            return {'ok': False, 'error': '参数不是合法 JSON，请重新给出参数'}
        try:
            result = tool.run(args, ctx) or {}
        except Exception as exc:                      # noqa: BLE001 - 兜底是设计
            return {'ok': False, 'error': '工具执行出错：%s' % exc}
        if 'ok' not in result:
            result['ok'] = True
        return result


# ── 画图类工具（本次的重点）──────────────────────────────

# 分支配色，按顺序循环使用。深空主题下都够亮。
BRANCH_COLORS = ['#72f6e4', '#a99bff', '#f0cc74', '#7de8a8', '#ff9db3', '#7fb4ff']


def _clean_tree(branches, depth=0, budget=None):
    """把模型给的树清洗成渲染器能安全吃下的结构。

    budget 是**全局**节点预算：树再深也不能把前端画爆。超出的直接丢弃，
    并在结果里告诉模型「已经截断」，让它自己决定要不要精简后重画。
    """
    if budget is None:
        budget = [60]
    out = []
    if not isinstance(branches, list):
        return out
    for item in branches:
        if budget[0] <= 0 or depth > 3:
            break
        if isinstance(item, str):
            node = {'text': item}
        elif isinstance(item, dict):
            node = {'text': item.get('text') or item.get('title') or item.get('name') or ''}
        else:
            continue
        text = Tool.text(node['text'], 26)
        if not text:
            continue
        budget[0] -= 1
        node['text'] = text
        kids = item.get('children') if isinstance(item, dict) else None
        if kids:
            node['children'] = _clean_tree(kids, depth + 1, budget)
        out.append(node)
    return out


def _parse_outline(text, max_items=40):
    """把缩进大纲解析成树。模型偶尔用不好嵌套 JSON，给它留的后路。

    支持 `- 一级` / `  - 二级` 的缩进，也支持 `1.` 之类的编号。
    """
    rows = []
    for raw in str(text or '').split('\n'):
        if not raw.strip():
            continue
        indent = len(raw) - len(raw.lstrip(' \t'))
        body = raw.strip().lstrip('-*+•').strip()
        body = body.lstrip('0123456789.、) ').strip()
        if body:
            rows.append((indent, body[:26]))
        if len(rows) >= max_items:
            break
    if not rows:
        return []
    base = min(indent for indent, _ in rows)
    steps = sorted({indent for indent, _ in rows if indent > base})[:3]
    roots, stack = [], []
    for indent, body in rows:
        node = {'text': body}
        if indent <= base or not steps:
            roots.append(node)
            stack = [node]
            continue
        level = 1 + sum(1 for s in steps if s < indent)
        stack = stack[:level]
        if not stack:
            roots.append(node)
            stack = [node]
            continue
        stack[-1].setdefault('children', []).append(node)
        stack.append(node)
    return roots


class DrawMindmapTool(Tool):
    name = 'draw_mindmap'
    description = ('为学生生成一张思维导图（类似 XMind 的结构图），直接在对话里画出来。'
                   '当学生说「画个…导图」「梳理一下…的知识结构」「帮我整理…的脉络」时用它。'
                   '内容要来自本课程讲过的知识，一层层拆开，每个节点控制在 12 个字以内。')

    def spec(self):
        return {
            'type': 'object',
            'properties': {
                'title': {'type': 'string', 'description': '导图中心主题，例如「二分查找」'},
                'branches': {
                    'type': 'array',
                    'description': '一级分支，建议 3-6 个，每个可再带 children',
                    'items': {
                        'type': 'object',
                        'properties': {
                            'text': {'type': 'string', 'description': '分支名，12 字以内'},
                            'children': {
                                'type': 'array',
                                'description': '二级节点',
                                'items': {
                                    'type': 'object',
                                    'properties': {
                                        'text': {'type': 'string'},
                                        'children': {
                                            'type': 'array',
                                            'description': '三级节点',
                                            'items': {'type': 'object',
                                                      'properties': {'text': {'type': 'string'}}},
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
                'outline': {'type': 'string',
                            'description': '备选：用缩进文本给结构（每行一个节点，子级缩进两格）。'
                                           'branches 用不好时可以只给这个。'},
            },
            'required': ['title'],
        }

    def run(self, args, ctx):
        title = self.text(args.get('title'), 24, '知识梳理')
        branches = _clean_tree(args.get('branches'))
        if not branches:
            branches = _clean_tree(_parse_outline(args.get('outline')))
        if not branches:
            return {'ok': False, 'error': '没有拿到有效的分支内容，请重新给出 branches 或 outline'}
        truncated = False
        if len(branches) > 7:
            branches, truncated = branches[:7], True
        data = {'kind': 'mindmap', 'title': title, 'branches': branches,
                'colors': BRANCH_COLORS}
        return {'ok': True, 'render': data,
                'summary': '已画出《%s》的思维导图，%d 个一级分支%s'
                           % (title, len(branches), '（内容较多已截断）' if truncated else '')}


class DrawFlowTool(Tool):
    name = 'draw_flowchart'
    description = ('画出算法或流程的步骤图（从上到下，带判断分支）。'
                   '当学生说「画一下…的流程」「这个算法怎么走」「画出…的步骤」时用它。'
                   '步骤要具体到能照着做，每步 14 字以内。')

    def spec(self):
        return {
            'type': 'object',
            'properties': {
                'title': {'type': 'string', 'description': '流程标题，例如「二分查找执行流程」'},
                'steps': {
                    'type': 'array',
                    'description': '按顺序排列的步骤，4-8 个',
                    'items': {
                        'type': 'object',
                        'properties': {
                            'text': {'type': 'string', 'description': '这一步做什么，14 字以内'},
                            'kind': {'type': 'string', 'enum': ['start', 'step', 'decide', 'end'],
                                     'description': '节点形状：开始/普通步骤/判断/结束'},
                            'yes': {'type': 'string', 'description': '判断节点「是」的分支去向（下一步的序号，从 1 开始）'},
                            'no': {'type': 'string', 'description': '判断节点「否」的分支去向'},
                        },
                        'required': ['text'],
                    },
                },
            },
            'required': ['title', 'steps'],
        }

    def run(self, args, ctx):
        title = self.text(args.get('title'), 24, '流程')
        raw = args.get('steps') if isinstance(args.get('steps'), list) else []
        steps = []
        for item in raw[:9]:
            if isinstance(item, str):
                item = {'text': item}
            if not isinstance(item, dict):
                continue
            text = self.text(item.get('text'), 22)
            if not text:
                continue
            kind = item.get('kind') if item.get('kind') in ('start', 'step', 'decide', 'end') else 'step'
            node = {'text': text, 'kind': kind}
            if kind == 'decide':
                node['yes'] = self.text(item.get('yes'), 12)
                node['no'] = self.text(item.get('no'), 12)
            steps.append(node)
        if len(steps) < 2:
            return {'ok': False, 'error': '步骤太少，至少给 2 步'}
        if steps[0]['kind'] == 'step':
            steps[0]['kind'] = 'start'
        if steps[-1]['kind'] == 'step':
            steps[-1]['kind'] = 'end'
        return {'ok': True,
                'render': {'kind': 'flowchart', 'title': title, 'steps': steps,
                           'colors': BRANCH_COLORS},
                'summary': '已画出《%s》的流程图，共 %d 步' % (title, len(steps))}


class DrawArrayTool(Tool):
    name = 'draw_array'
    description = ('画出数组/查找过程示意图，用格子加指针标出当前状态。'
                   '当学生问「二分查找怎么找的」「这个排序每一轮什么样」这类'
                   '「需要看到数据怎么动」的问题时用它。')

    def spec(self):
        return {
            'type': 'object',
            'properties': {
                'title': {'type': 'string', 'description': '这张图在演示什么'},
                'values': {'type': 'array', 'description': '数组元素，最多 14 个',
                           'items': {'type': 'string'}},
                'highlight': {'type': 'array', 'description': '高亮的下标（从 0 开始）',
                              'items': {'type': 'integer'}},
                'pointers': {
                    'type': 'array',
                    'description': '指针标记，例如 low / mid / high 分别指向哪个下标',
                    'items': {
                        'type': 'object',
                        'properties': {
                            'label': {'type': 'string', 'description': '指针名，如 low'},
                            'index': {'type': 'integer', 'description': '指向的下标，从 0 开始'},
                        },
                    },
                },
                'note': {'type': 'string', 'description': '一句话说明这张图在讲什么'},
            },
            'required': ['title', 'values'],
        }

    def run(self, args, ctx):
        title = self.text(args.get('title'), 30, '数组示意')
        values = [self.text(v, 6) for v in (args.get('values') or [])][:14]
        if not values:
            return {'ok': False, 'error': 'values 不能为空'}
        total = len(values)
        highlight = sorted({self.clamp_int(i, 0, total - 1, -1)
                            for i in (args.get('highlight') or [])} - {-1})
        pointers = []
        for row in (args.get('pointers') or [])[:5]:
            if not isinstance(row, dict):
                continue
            label = self.text(row.get('label'), 8)
            index = self.clamp_int(row.get('index'), 0, total - 1, -1)
            if label and index >= 0:
                pointers.append({'label': label, 'index': index})
        return {'ok': True,
                'render': {'kind': 'array', 'title': title, 'values': values,
                           'highlight': highlight, 'pointers': pointers,
                           'note': self.text(args.get('note'), 60)},
                'summary': '已画出《%s》的数组示意图' % title}


# ── 操控类工具（「管家」的权限边界在这里定义）───────────────


class GotoChapterTool(Tool):
    name = 'goto_chapter'
    description = ('让学生端跳到指定章节，或直接跳到某一节知识点。'
                   '当学生说「跳到第 4 章」「打开注意力那一节」「我想看 RAG」时用它。'
                   '找不准章节时就先不要调用，用文字问清楚。')

    def spec(self):
        return {
            'type': 'object',
            'properties': {
                'chapter_id': {'type': 'integer', 'description': '章节编号（见系统提示里的课程目录）'},
                'kp_index': {'type': 'integer', 'description': '知识点序号（从 0 开始）；不指定就整章跳转'},
                'reason': {'type': 'string', 'description': '一句话告诉学生为什么带他去这里'},
            },
            'required': ['chapter_id'],
        }

    def run(self, args, ctx):
        courses = ctx.get('courses') or []
        by_id = {str(c['id']): c for c in courses}
        chapter_id = self.clamp_int(args.get('chapter_id'), 0, 999, -1)
        chapter = by_id.get(str(chapter_id))
        if chapter is None:
            return {'ok': False,
                    'error': '没有第 %s 章，可用章节：%s'
                             % (chapter_id, '、'.join('%s《%s》' % (c['id'], c['title'][:10]) for c in courses))}
        kps = chapter.get('knowledge_points') or []
        kp_index = self.clamp_int(args.get('kp_index'), -1, max(len(kps) - 1, 0), -1)
        if kp_index >= 0 and kp_index < len(kps):
            label = '去看「%s」' % Tool.text(kps[kp_index]['title'], 14)
            url = '/chapter-%d#kp-%d' % (chapter_id, kp_index + 1)
        else:
            kp_index = -1
            label = '去看《%s》' % Tool.text(chapter['title'], 10)
            url = '/chapter-%d' % chapter_id
        action = {'type': 'goto_kp' if kp_index >= 0 else 'goto_chapter',
                  'chapter_id': chapter_id, 'kp_index': kp_index, 'label': label}
        return {'ok': True, 'action': action, 'action_url': url,
                'summary': '已把学生带到 %s' % label}


class OpenPageTool(Tool):
    name = 'open_page'
    description = ('打开平台里的某个页面：学习路线、模拟面试、进度星图、练习。'
                   '当学生说「看看我的进度」「开始模拟面试」「给我排个学习计划」时用它。')

    PAGES = {
        'roadmap': ('/roadmap', '打开学习路线'),
        'interview': ('/coach?interview=1', '开始模拟面试'),
        'progress': ('/progress', '看我的进度'),
        'constellation': ('/constellation', '看我的星空进度'),
        'training': ('/training', '打开练习'),
        'stars': ('/stars', '看知识星海'),
    }

    def spec(self):
        return {
            'type': 'object',
            'properties': {
                'page': {'type': 'string', 'enum': list(self.PAGES),
                         'description': 'roadmap=学习路线 / interview=模拟面试 / '
                                        'progress=学习进度 / constellation=星空进度 / '
                                        'training=练习 / stars=知识星海'},
                'reason': {'type': 'string', 'description': '一句话说明为什么带学生去这里'},
            },
            'required': ['page'],
        }

    def run(self, args, ctx):
        page = str(args.get('page') or '')
        if page not in self.PAGES:
            return {'ok': False, 'error': '只能打开：%s' % '、'.join(self.PAGES)}
        url, label = self.PAGES[page]
        kind = {'roadmap': 'open_roadmap', 'interview': 'open_coach',
                'constellation': 'open_constellation', 'stars': 'open_constellation',
                'training': 'open_training', 'progress': 'open_roadmap'}[page]
        return {'ok': True, 'action_url': url,
                'action': {'type': kind, 'chapter_id': 0, 'kp_index': -1, 'label': label},
                'summary': '已%s' % label}


class CheckProgressTool(Tool):
    name = 'check_progress'
    description = ('读取这个学生的真实学习进度：完成了哪些知识点、哪几道题做错过、'
                   '薄弱章节是哪个。回答「我该学什么」「我哪里不行」这类问题前必须先调用它，'
                   '不要凭空猜测学生的水平。')

    def spec(self):
        return {'type': 'object',
                'properties': {'scope': {'type': 'string', 'enum': ['weak', 'all'],
                                         'description': 'weak=只看薄弱处（默认）/ all=全部章节'}},
                'required': []}

    def run(self, args, ctx):
        progress = ctx.get('progress') or {}
        weak = progress.get('weak') or []
        if not weak:
            return {'ok': True, 'summary': '这个学生所有章节的知识点都完成了，没有明显薄弱项。'
                                           '可以引导他做组卷或模拟面试。'}
        lines = []
        for row in weak[:5]:
            lines.append('《%s》：%s，涉及知识点 %d 个、错题 %d 道'
                         % (row.get('title', ''), row.get('reason', ''),
                            row.get('pending_count', 0), row.get('wrong_count', 0)))
        return {'ok': True, 'progress': weak[:5],
                'summary': '学生当前的薄弱章节：\n' + '\n'.join(lines)}


class CreateRoadmapTool(Tool):
    name = 'create_roadmap'
    description = ('按学生当前水平生成一份逐日学习路线并打开给他。'
                   '当学生说「我该怎么学」「给我排个计划」「接下来学什么」时用它。')

    def spec(self):
        return {'type': 'object',
                'properties': {
                    'days': {'type': 'integer', 'description': '计划天数，建议 7-21'},
                    'focus': {'type': 'string', 'description': '想把重心放在哪个方向，可留空'},
                },
                'required': []}

    def run(self, args, ctx):
        days = self.clamp_int(args.get('days'), 3, 30, 7)
        focus = self.text(args.get('focus'), 30)
        plan = ctx.get('build_roadmap')
        if not callable(plan):
            return {'ok': False, 'error': '学习路线生成器不可用'}
        try:
            result = plan(days, focus)
        except Exception as exc:                      # noqa: BLE001
            return {'ok': False, 'error': '生成路线失败：%s' % exc}
        return {'ok': True, 'action_url': '/roadmap',
                'action': {'type': 'open_roadmap', 'chapter_id': 0, 'kp_index': -1,
                           'label': '打开学习路线'},
                'roadmap': result,
                'summary': '已生成 %d 天学习路线并打开' % days}


# ── 装配 ────────────────────────────────────────────────


def build_registry():
    reg = ToolRegistry()
    reg.register(DrawMindmapTool())
    reg.register(DrawFlowTool())
    reg.register(DrawArrayTool())
    reg.register(GotoChapterTool())
    reg.register(OpenPageTool())
    reg.register(CheckProgressTool())
    reg.register(CreateRoadmapTool())
    return reg


REGISTRY = build_registry()
