"""星辰教练的会话引擎与提示词库。

职责边界很清楚：**这个模块只存会话与拼提示词，不调用模型。**
模型调用留在 app.py，因为那里才有配额、SSE 与用户态；这样引擎本身可以
单独跑测试，也不会因为网络问题把存档写坏。

存储：每个用户一份 data/coach/<user>.json，结构是
    {"sessions": [{"id","title","source","chapter_id","created_at","updated_at","messages":[...]}]}

会话上限 10 个：超了以后**系统生成的会话**会被挤掉，用户自己开的不会被挤——
用户主动建的东西不该被系统悄悄删掉。
"""

import json
import os
import re
import threading
import uuid
from datetime import datetime

import starlab_engine as lab

MAX_SESSIONS = 10
MAX_MESSAGES = 400
TITLE_LIMIT = 24
SESSION_DIR = os.path.join(lab.DATA_DIR, 'coach')
_LOCK = threading.RLock()


def configure(root=None, data_dir=None):
    global SESSION_DIR
    if data_dir:
        SESSION_DIR = os.path.join(str(data_dir), 'coach')
    elif root:
        SESSION_DIR = os.path.join(str(root), 'data', 'coach')
    os.makedirs(SESSION_DIR, exist_ok=True)


# ── 提示词 ──────────────────────────────────────────────
# 教练的人格设定。写这么细是因为「讲得对不对」和「讲得像不像老师」是两件事：
# 前者靠检索到的讲义兜底，后者只能靠这段人设约束。
COACH_SYSTEM_PROMPT = """你是「星辰教练」，一位带过很多届学生的大模型与智能体方向讲师。
你的学生有 Python 基础，正在系统学习大模型应用开发，目标通常是做出自己的项目或通过面试。

你的讲解风格：
- 先给结论，再给理由。学生要的是能拿走的判断，不是铺垫。
- 用类比解释抽象概念，但类比之后必须补一句「类比的边界在哪」——防止学生记错。
- 涉及数字、参数、公式时给具体值，不说「比较大」「差不多」。
- 学生做错时，先指出他的思路里哪一步是对的，再指出分叉点在哪。
- 回答控制在 400 字以内，除非学生明确要详细展开。
- 代码用 Markdown 代码块，标注语言。中文正文，技术名词保留英文原词。

边界与准确性：
- 只回答与大模型、智能体、本课程知识点相关的问题；无关问题简短说明你的范围并引回学习内容。
- 讲义里有的内容优先按讲义讲；讲义里没有的，明确说「这部分课程里没细讲」，再给通用解释。
- 不确定的版本差异、具体产品的界面操作、实时价格，直接说不确定，不要编。
- 不泄露完整答案：学生问练习题时先给思路与关键步骤，除非他明确说「给我答案」。

每次回答的最后，用一行提出一个能推动他继续想的问题，格式固定为：
🤔 想一想：<你的问题>"""

# 模拟面试的面试官人格。刻意和教练分开：面试官不应该温柔，
# 也不应该主动给答案，否则练不出真实压力。
INTERVIEW_SYSTEM_PROMPT = """你是大模型应用开发岗位的技术面试官，正在面试一位候选人。
岗位方向：大模型应用 / 智能体工程（偏应用落地，不是算法研究岗）。

面试规则：
- 一次只问一个问题，不要连续抛多个问题。
- 问题必须具体、有区分度，覆盖：原理理解、工程取舍、失败排查、项目经历。
- 候选人答完后，先给一句简短的评估（哪里答对了、哪里含糊），再问下一个问题。
- 候选人答得含糊时追问细节，不要放过；答得好时加深难度。
- 全程不给标准答案，也不教学——这是面试，不是答疑。
- 保持专业、客观，不奉承也不刁难。

你必须只输出一个 JSON 对象，不要任何其他文字、不要代码围栏：
{"score": <对候选人本次回答的评分 0-100 整数>,
 "comment": "<对本次回答的点评，60-150 字，指出具体缺口>",
 "question": "<下一个问题；如果面试应该结束就填空字符串>",
 "done": <true 或 false>,
 "summary": "<仅当 done 为 true 时给出整场面试总结与提升建议，200-300 字；否则为空字符串>"}

评分标准：90+ 有深度且能举出真实例子；75-89 基本正确但缺细节；60-74 方向对但含糊；
60 以下明显理解错误或答非所问。"""

# 出题人格：章节小测用，避免每次都问同样的东西。
QUIZ_SYSTEM_PROMPT = """你是出题人。针对给定知识点出一道口语化但严谨的面试式追问，
用于检验学生是否真的理解，而不是背下了定义。

只输出一个 JSON 对象，不要代码围栏：
{"question": "<一个问题，40-80 字>", "focus": "<这个问题在考什么，20 字以内>",
 "hint": "<如果学生卡住，给的一个方向性提示，30-60 字>"}"""


def _safe_user(username):
    return re.sub(r'[^0-9A-Za-z_.@\-\u4e00-\u9fff]', '_', str(username or 'guest'))[:60] or 'guest'


def _path(username):
    os.makedirs(SESSION_DIR, exist_ok=True)
    return os.path.join(SESSION_DIR, _safe_user(username) + '.json')


def _now():
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')


def _load(username):
    try:
        with open(_path(username), encoding='utf-8') as fh:
            data = json.load(fh)
        if isinstance(data, dict) and isinstance(data.get('sessions'), list):
            return data
    except (OSError, ValueError):
        pass
    return {'sessions': []}


def _save(username, data):
    path = _path(username)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def make_title(text, fallback='新的对话'):
    """把第一句话压成标题。压得太短会撞名，所以按 24 字裁并在末尾加省略号。"""
    clean = re.sub(r'\s+', ' ', str(text or '')).strip()
    clean = re.sub(r'^[#>*\-\s]+', '', clean)
    if not clean:
        return fallback
    return clean[:TITLE_LIMIT] + ('…' if len(clean) > TITLE_LIMIT else '')


def list_sessions(username):
    data = _load(username)
    rows = []
    for session in data['sessions']:
        messages = session.get('messages') or []
        preview = ''
        for message in reversed(messages):
            if message.get('role') == 'assistant' and message.get('content'):
                preview = re.sub(r'\s+', ' ', message['content'])[:80]
                break
        rows.append({
            'id': session.get('id'), 'title': session.get('title', ''),
            'source': session.get('source', 'manual'), 'chapter_id': session.get('chapter_id', ''),
            'created_at': session.get('created_at'), 'updated_at': session.get('updated_at'),
            'message_count': len([m for m in messages if m.get('role') != 'system']),
            'preview': preview,
        })
    rows.sort(key=lambda row: row.get('updated_at') or '', reverse=True)
    return rows


def count_sessions(username):
    return len(_load(username)['sessions'])


def get_session(username, session_id, full=True):
    for session in _load(username)['sessions']:
        if session.get('id') == session_id:
            if full:
                return session
            return {key: value for key, value in session.items() if key != 'messages'}
    return None


def create_session(username, title=None, source='manual', chapter_id='', first_message=''):
    """新建会话。到上限时只挤掉系统生成的旧会话，用户自己的会保留。"""
    with _LOCK:
        data = _load(username)
        sessions = data['sessions']
        if len(sessions) >= MAX_SESSIONS:
            candidates = [s for s in sessions if s.get('source') != 'manual']
            if not candidates:
                return {'error': 'cap',
                        'message': '星辰教练最多保存 %d 个对话，先删掉一个旧对话再新建。' % MAX_SESSIONS}
            candidates.sort(key=lambda s: s.get('updated_at') or '')
            sessions.remove(candidates[0])
        session = {
            'id': 'cs' + uuid.uuid4().hex[:12],
            'title': title or make_title(first_message),
            'source': source,
            'chapter_id': str(chapter_id or ''),
            'created_at': _now(),
            'updated_at': _now(),
            'messages': [],
        }
        sessions.append(session)
        _save(username, data)
        return session


def delete_session(username, session_id):
    with _LOCK:
        data = _load(username)
        before = len(data['sessions'])
        data['sessions'] = [s for s in data['sessions'] if s.get('id') != session_id]
        if len(data['sessions']) == before:
            return False
        _save(username, data)
        return True


def rename_session(username, session_id, title):
    with _LOCK:
        data = _load(username)
        for session in data['sessions']:
            if session.get('id') == session_id:
                session['title'] = make_title(title, fallback=session.get('title') or '新的对话')
                session['updated_at'] = _now()
                _save(username, data)
                return True
    return False


def clear_messages(username, session_id):
    with _LOCK:
        data = _load(username)
        for session in data['sessions']:
            if session.get('id') == session_id:
                session['messages'] = []
                session['updated_at'] = _now()
                _save(username, data)
                return True
    return False


def append_message(username, session_id, role, content, meta=None, auto_title=True):
    with _LOCK:
        data = _load(username)
        for session in data['sessions']:
            if session.get('id') != session_id:
                continue
            messages = session.setdefault('messages', [])
            messages.append({'role': role, 'content': content, 'ts': _now(), 'meta': meta or {}})
            if len(messages) > MAX_MESSAGES:
                del messages[:-MAX_MESSAGES]
            session['updated_at'] = _now()
            if auto_title and role == 'user' and session.get('title') in ('', '新的对话'):
                session['title'] = make_title(content)
            _save(username, data)
            return True
    return False


def history_for_prompt(username, session_id, limit=10):
    """取最近几轮对话给模型。条数太少会丢上下文，太多会烧 token 且冲淡指令。"""
    session = get_session(username, session_id, full=True)
    if not session:
        return []
    rows = []
    for message in (session.get('messages') or [])[-limit:]:
        if message.get('role') in ('user', 'assistant') and message.get('content'):
            rows.append({'role': message['role'], 'content': message['content'][:2000]})
    return rows


def find_session_by(username, source, chapter_id=''):
    for session in _load(username)['sessions']:
        if session.get('source') == source and str(session.get('chapter_id', '')) == str(chapter_id):
            return session
    return None


def record_exchange(username, question, answer, chapter_id='', source='exercise',
                    meta=None, title_hint=''):
    """把一次问答落进会话。找不到会话就建一个；建不上就并进最近一个会话。

    为什么最后要「并进最近会话」：会话满了不该让一次正常的答疑失败。
    宁可把两条消息塞进旧会话，也不能让学生看到「保存失败」。
    """
    if not question or not answer:
        return {'saved': False, 'reason': 'empty'}
    session = find_session_by(username, source, chapter_id)
    if not session:
        created = create_session(username, title=title_hint or make_title(question),
                                 source=source, chapter_id=chapter_id, first_message=question)
        if created.get('error'):
            sessions = list_sessions(username)
            if not sessions:
                return {'saved': False, 'reason': 'cap'}
            session = get_session(username, sessions[0]['id'], full=False)
            meta = dict(meta or {})
            meta['unsorted'] = True
        else:
            session = created
    append_message(username, session['id'], 'user', question, meta, auto_title=False)
    append_message(username, session['id'], 'assistant', answer, meta, auto_title=False)
    return {'saved': True, 'session_id': session['id']}


def transcript(session):
    """导出成 Markdown。学生要把答疑记录带走时用。"""
    lines = ['# %s' % (session.get('title') or '对话记录'), '',
             '创建于 %s · 共 %d 条消息' % (session.get('created_at', ''),
                                          len(session.get('messages') or [])), '']
    for message in session.get('messages') or []:
        speaker = '我' if message.get('role') == 'user' else '星辰教练'
        source = (message.get('meta') or {}).get('source')
        tag = '（来自%s）' % {'exercise': '章节练习', 'training': '做题', 'exam': '组卷',
                             'interview': '模拟面试'}.get(source, source) if source else ''
        lines.append('## %s%s' % (speaker, tag))
        lines.append('')
        lines.append(message.get('content') or '')
        lines.append('')
    return '\n'.join(lines)
