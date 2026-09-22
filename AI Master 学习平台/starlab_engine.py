"""星辰学习系统的引擎：题库、作答判分、修为积分、逐用户存储。

这个模块负责四件事，彼此之间只通过纯数据交换：

1. **题库**：加载 data/question_bank.json，按章节 / 类型 / 难度索引，
   在下发给前端时按模式裁剪（练习模式下不能带答案）。
2. **判分**：选择题本地比对；简答与代码题交给 AI 评分（app.py 调用后回填），
   本地只做结构与长度校验，保证 AI 不可用时也能给出可解释的占位结果。
3. **积分与修为**：所有加分都走 award()，带防重复账本与重复练习衰减，
   等级曲线集中在 star_engine 里，改一处即可整体调平衡。
4. **存储**：每个用户一份 data/training/<user>.json，原子写入 + 进程内锁，
   避免边刷题边写坏文件。

为什么单独一个模块：app.py 要处理路由、鉴权、SSE 与 RAG，再把积分数学与
判分逻辑塞进去会彻底没法维护；而这两块恰好是最需要单独跑测试的部分。
"""

import json
import os
import re
import threading
from datetime import datetime

# ── 路径 ────────────────────────────────────────────────
# 由 app.py 在启动时写成实际可写目录，默认值用于独立跑测试。
ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, 'data')
BANK_FILE = os.path.join(DATA_DIR, 'question_bank.json')
COURSES_FILE = os.path.join(DATA_DIR, 'courses.json')
STATE_DIR = os.path.join(DATA_DIR, 'training')


def configure(root, data_dir=None):
    """app.py 启动时调用，把读写位置切到实际可写目录。"""
    global ROOT, DATA_DIR, BANK_FILE, COURSES_FILE, STATE_DIR
    ROOT = str(root)
    DATA_DIR = str(data_dir) if data_dir else os.path.join(ROOT, 'data')
    BANK_FILE = os.path.join(DATA_DIR, 'question_bank.json')
    COURSES_FILE = os.path.join(DATA_DIR, 'courses.json')
    STATE_DIR = os.path.join(DATA_DIR, 'training')
    os.makedirs(STATE_DIR, exist_ok=True)


# ── 积分规则 ────────────────────────────────────────────
# 设计取舍：一道题的价值要能和「看完一节图文讲解」「完成一个知识点」放在
# 同一把尺子上比较。做题最难、最花时间，所以单题分值最高，但只看讲解也有分，
# 保证刚入门的人不至于卡在最低境界动不了。
#
# 难度基础分：三档刻意拉开差距（简单→进阶 7 倍），啃难题才有明显回报。
QUESTION_BASE = {1: 10, 2: 28, 3: 70}
STAR_MULT = {0: 0.0, 1: 1.0, 2: 1.4, 3: 1.8}  # 星级越高，掌握度评分越高
FIRST_CLEAR_BONUS = 1.5                      # 首次通关额外奖励
REPEAT_DECAY = [1.0, 0.3, 0.12, 0.05]        # 第 1/2/3/4+ 次通关的衰减
KP_POINTS = 12                               # 完成一个知识点
CHAPTER_POINTS = 60                          # 一章全部知识点完成
EXAM_FINISH_BASE = 20                        # 完成一次组卷
EXAM_FINISH_PER_Q = 5

# 一次加分不超过这个值，防止某处算错把曲线冲垮
MAX_AWARD = 200
LEVEL_TAIL_STEP = 3000

# 章节 → 赛道。星器与试炼的分档统计要用，
# 智能体是平台主线，所以它单独成一条赛道（agent），不混在通用章节里。
TRACK_BY_CHAPTER = {
    4: 'agent', 5: 'agent', 6: 'agent',
    7: 'rag', 8: 'finetune', 9: 'deploy',
    1: 'base', 2: 'base', 3: 'base',
    10: 'tooling', 11: 'engineering', 12: 'cert', 13: 'cert',
}


def track_of_chapter(chapter_id):
    try:
        chapter_id = int(chapter_id)
    except (TypeError, ValueError):
        return 'other'
    if chapter_id >= 100:
        return 'agent' if 100 <= chapter_id < 200 else 'other'
    return TRACK_BY_CHAPTER.get(chapter_id, 'other')


# ── 题库加载 ────────────────────────────────────────────
_BANK_CACHE = None
_BANK_MTIME = None
_BANK_LOCK = threading.Lock()
_INDEX_CACHE = None


def _safe_user(username):
    return re.sub(r'[^0-9A-Za-z_.@\-\u4e00-\u9fff]', '_', str(username or 'guest'))[:60] or 'guest'


def load_bank(force=False):
    """读题库。按 mtime 缓存 —— 改完题库不用重启服务。"""
    global _BANK_CACHE, _BANK_MTIME, _INDEX_CACHE
    with _BANK_LOCK:
        try:
            mtime = os.path.getmtime(BANK_FILE)
        except OSError:
            return []
        if not force and _BANK_CACHE is not None and _BANK_MTIME == mtime:
            return _BANK_CACHE
        try:
            with open(BANK_FILE, encoding='utf-8') as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            return _BANK_CACHE or []
        _BANK_CACHE = data if isinstance(data, list) else []
        _BANK_MTIME = mtime
        _INDEX_CACHE = None
        return _BANK_CACHE


def bank_index():
    global _INDEX_CACHE
    if _INDEX_CACHE is None:
        _INDEX_CACHE = {item.get('id'): item for item in load_bank() if item.get('id')}
    return _INDEX_CACHE


def courses():
    try:
        with open(COURSES_FILE, encoding='utf-8') as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return []


def chapter_of_question(question_id):
    item = bank_index().get(question_id)
    return item.get('chapter_id') if item else None


def difficulty_of_question(question_id):
    item = bank_index().get(question_id)
    try:
        return int(item.get('difficulty') or 1)
    except (TypeError, ValueError):
        return 1


# ── 逐用户状态 ──────────────────────────────────────────
_STATE_LOCK = threading.RLock()


def state_path(username):
    os.makedirs(STATE_DIR, exist_ok=True)
    return os.path.join(STATE_DIR, _safe_user(username) + '.json')


def _empty_state():
    return {'points': 0, 'rewards': {}, 'log': [], 'attempts': {}, 'exams': [],
            'active_exam': '', 'scores': {}}


def load_state(username):
    path = state_path(username)
    state = _empty_state()
    try:
        with open(path, encoding='utf-8') as fh:
            data = json.load(fh)
        if isinstance(data, dict):
            for key, value in data.items():
                state[key] = value
    except (OSError, ValueError):
        pass
    return state


def save_state(username, state):
    """原子写：先写临时文件再 replace，避免中途断电写坏存档。"""
    path = state_path(username)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(state, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, path)


def mutate_state(username, fn):
    """读—改—写的唯一入口，进程内加锁。fn 返回 False 表示这次不写盘。"""
    with _STATE_LOCK:
        state = load_state(username)
        if fn(state) is False:
            return state
        save_state(username, state)
        return state


def _now():
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')


# ── 积分账本 ────────────────────────────────────────────
def award(state, reason, ref, amount, note=''):
    """发一笔分。返回 (实发分数, 加分前等级, 加分后等级)。

    幂等靠 rewards 账本：同一个 reason:ref 只发一次。重复练习走调用方
    传入的序号（ref#2 / ref#3），所以重复也不会白刷。
    """
    import star_engine  # 延迟导入：star_engine 反过来依赖本模块的统计口径

    key = '%s:%s' % (reason, ref)
    if key in (state.get('rewards') or {}):
        return 0, None, None
    amount = max(0, min(int(amount or 0), MAX_AWARD))
    if not amount:
        return 0, None, None
    before = star_engine.level_from_points(state.get('points'))
    state.setdefault('rewards', {})[key] = amount
    state['points'] = int(state.get('points') or 0) + amount
    log = state.setdefault('log', [])
    log.append({'ts': _now(), 'reason': reason, 'ref': ref, 'delta': amount, 'note': note})
    del log[:-200]
    after = star_engine.level_from_points(state.get('points'))
    return amount, before, after


def question_points(difficulty, stars, clear_count):
    """单题得分 = 难度基础分 × 星级系数 × 首通奖励 × 重复衰减。"""
    base = QUESTION_BASE.get(int(difficulty or 1), QUESTION_BASE[1])
    mult = STAR_MULT.get(int(stars or 0), 0)
    bonus = FIRST_CLEAR_BONUS if not clear_count else 1.0
    decay = REPEAT_DECAY[min(int(clear_count or 0), len(REPEAT_DECAY) - 1)]
    return int(round(base * mult * bonus * decay))


# ── 题目下发 ────────────────────────────────────────────
def public_question(item, state=None, reveal=False):
    """裁剪成前端可用的题目。reveal=False 时绝不带答案与解析。"""
    record = ((state or {}).get('attempts') or {}).get(item.get('id'), {})
    payload = {
        'id': item.get('id'),
        'chapter_id': item.get('chapter_id'),
        'chapter_title': item.get('chapter_title', ''),
        'track': item.get('track', ''),
        'title': item.get('title', ''),
        'type': item.get('type', 'choice'),
        'difficulty': int(item.get('difficulty') or 1),
        'tags': item.get('tags') or [],
        'statement': item.get('statement', ''),
        'points': question_points(item.get('difficulty'), 3, 0),
        'attempts': int(record.get('attempts') or 0),
        'solved': bool(record.get('solved')),
        'best_stars': int(record.get('best_stars') or 0),
        'wrong': bool(record.get('wrong')),
        'last_answer': record.get('last_answer', ''),
        'last_feedback': record.get('last_feedback', ''),
        'last_score': record.get('last_score'),
    }
    if payload['type'] == 'choice':
        payload['options'] = item.get('options') or []
    else:
        payload['starter_code'] = item.get('starter_code', '')
        payload['reference'] = item.get('reference', '')
        payload['hints'] = item.get('hints') or []
    if reveal:
        payload['answer'] = item.get('answer')
        payload['explanation'] = item.get('explanation', '')
        payload['reference'] = item.get('reference', '')
        payload['solution'] = item.get('solution', '')
    return payload


def question_brief(item, state=None):
    """列表 / 章节页用的题目摘要。

    必须带上 statement 与 options：章节页的卡片是"就地可作答"的，
    只给标题的话渲染出来是一张空卡片 —— 学生看到的就是「这一节有 7 道题」
    但一道都读不了。不返回答案与解析（那是 reveal 才给的）。
    """
    record = ((state or {}).get('attempts') or {}).get(item.get('id'), {})
    brief = {
        'id': item.get('id'),
        'chapter_id': item.get('chapter_id'),
        'chapter_title': item.get('chapter_title', ''),
        'title': item.get('title', ''),
        'type': item.get('type', 'choice'),
        'difficulty': int(item.get('difficulty') or 1),
        'track': item.get('track', ''),
        'tags': item.get('tags') or [],
        'statement': item.get('statement', ''),
        'points': question_points(item.get('difficulty'), 3, 0),
        'solved': bool(record.get('solved')),
        'best_stars': int(record.get('best_stars') or 0),
        'wrong': bool(record.get('wrong')),
        'last_answer': record.get('last_answer', ''),
        'last_feedback': record.get('last_feedback', ''),
    }
    if brief['type'] == 'choice':
        brief['options'] = item.get('options') or []
    else:
        brief['hints'] = [str(h) for h in (item.get('hints') or [])][:3]
        brief['starter_code'] = item.get('starter_code', '')
    return brief


def filter_questions(chapters=None, track=None, difficulty=None, kind=None,
                     only=None, state=None, keyword=None, limit=None):
    """按章节 / 赛道 / 难度 / 类型 / 状态筛题。chapters 为空表示不限章节。"""
    chapter_set = set()
    for value in chapters or []:
        try:
            chapter_set.add(int(value))
        except (TypeError, ValueError):
            continue
    attempts = (state or {}).get('attempts') or {}
    rows = []
    for item in load_bank():
        if chapter_set and item.get('chapter_id') not in chapter_set:
            continue
        if track and item.get('track') != track:
            continue
        if difficulty and int(item.get('difficulty') or 1) != int(difficulty):
            continue
        if kind and item.get('type', 'choice') != kind:
            continue
        record = attempts.get(item.get('id'), {})
        if only == 'unsolved' and record.get('solved'):
            continue
        if only == 'solved' and not record.get('solved'):
            continue
        if only == 'wrong' and not record.get('wrong'):
            continue
        if keyword:
            haystack = (str(item.get('title', '')) + str(item.get('statement', ''))
                        + ' '.join(item.get('tags') or []) + str(item.get('chapter_title', '')))
            if keyword.lower() not in haystack.lower():
                continue
        rows.append(item)
    if limit:
        rows = rows[:int(limit)]
    return rows


def catalog(state=None):
    """按章节汇总题量/完成度，给刷题页左侧选题面板用。"""
    attempts = (state or {}).get('attempts') or {}
    buckets = {}
    for item in load_bank():
        chapter_id = item.get('chapter_id')
        bucket = buckets.setdefault(chapter_id, {
            'id': chapter_id, 'title': item.get('chapter_title', ''),
            'track': item.get('track', ''), 'count': 0, 'solved': 0, 'wrong': 0})
        bucket['count'] += 1
        record = attempts.get(item.get('id')) or {}
        if record.get('solved'):
            bucket['solved'] += 1
        if record.get('wrong'):
            bucket['wrong'] += 1
    rows = []
    for chapter in courses():
        bucket = buckets.pop(chapter['id'], None)
        if not bucket:
            continue
        bucket['icon'] = chapter.get('icon', '✦')
        bucket['highlight'] = bool(chapter.get('highlight'))
        bucket['stage'] = chapter.get('stage', '')
        bucket['progress'] = int(round(bucket['solved'] / bucket['count'] * 100)) if bucket['count'] else 0
        rows.append(bucket)
    for bucket in buckets.values():
        bucket['progress'] = int(round(bucket['solved'] / bucket['count'] * 100)) if bucket['count'] else 0
        rows.append(bucket)
    return rows


# ── 判分 ────────────────────────────────────────────────
def local_verdict(item, answer, score=None):
    """本地判分。选择题直接比对；主观题用 AI 给的 score 折算星辉。

    星辉规则（与 AI 是否可用无关，保证可解释）：
      3 星 —— 90 分以上，或选择题一次答对
      2 星 —— 70 分以上
      1 星 —— 60 分以上（及格线）
      0 星 —— 不及格
    """
    kind = item.get('type', 'choice')
    if kind == 'choice':
        try:
            picked = int(answer)
        except (TypeError, ValueError):
            picked = -1
        correct = picked == int(item.get('answer') or 0)
        return {
            'kind': 'choice',
            'passed': correct,
            'score': 100 if correct else 0,
            'stars': 3 if correct else 0,
            'correct': correct,
        }
    score = int(score) if score is not None else None
    if score is None:
        return {'kind': kind, 'passed': None, 'score': None, 'stars': 0, 'correct': None}
    if score >= 90:
        stars = 3
    elif score >= 70:
        stars = 2
    elif score >= 60:
        stars = 1
    else:
        stars = 0
    return {'kind': kind, 'passed': score >= 60, 'score': score, 'stars': stars,
            'correct': score >= 60}


def record_attempt(state, item, verdict, answer='', feedback='', used_ai=False):
    """把一次作答写进档案并结算积分。返回结算回执。"""
    import star_engine

    qid = item.get('id')
    record = state.setdefault('attempts', {}).setdefault(qid, {})
    record['attempts'] = int(record.get('attempts') or 0) + 1
    record['last_at'] = _now()
    record['last_answer'] = (answer or '')[:4000]
    if feedback:
        record['last_feedback'] = feedback[:4000]
    if verdict.get('score') is not None:
        record['last_score'] = verdict['score']
    if used_ai:
        record['ai_help'] = int(record.get('ai_help') or 0) + 1

    stars = int(verdict.get('stars') or 0)
    passed = bool(verdict.get('passed'))
    best = int(record.get('best_stars') or 0)
    if passed:
        record['solved'] = True
        if stars > best:
            record['best_stars'] = stars
        record.setdefault('first_solved_at', _now())
    else:
        record['wrong'] = int(record.get('wrong') or 0) + 1

    points = 0
    if passed:
        clears = int(record.get('clears') or 0)
        points = question_points(item.get('difficulty'), stars, clears)
        ref = qid if not clears else '%s#%d' % (qid, clears + 1)
        awarded, before, after = award(
            state, 'question', ref, points,
            note='%s（%d 星）' % (item.get('title') or qid, stars))
        if awarded:
            record['clears'] = clears + 1
            record.setdefault('history', []).append(
                {'ts': _now(), 'stars': stars, 'points': awarded, 'mode': 'practice'})
            del record['history'][:-30]
            points = awarded
        else:
            points = 0
        chapter_complete_bonus(state, item.get('chapter_id'))
    else:
        points = 0
    state.setdefault('scores', {})[qid] = verdict.get('score')
    profile = star_engine.level_from_points(state.get('points'))
    just_unlocked = _just_unlocked(state, profile)
    return {
        'passed': passed or None,
        'stars': stars,
        'best_stars': int(record.get('best_stars') or 0),
        'points': points,
        'clears': int(record.get('clears') or 0),
        'profile': profile,
        'just_unlocked': just_unlocked,
    }


def _just_unlocked(state, profile):
    """新解锁的星器名。前端用它播一次解锁提示，不需要服务端存已读状态。"""
    import star_engine
    stats = star_engine.derive_stats(state)
    unlocked = [row['name'] for row in star_engine.evaluate_equipment(stats) if row['unlocked']]
    seen = set(state.setdefault('seen_equipment', []))
    fresh = [name for name in unlocked if name not in seen]
    if fresh:
        state['seen_equipment'] = unlocked
    return fresh


def chapter_complete_bonus(state, chapter_id):
    """一章的题目全部通关时补一笔章节奖励。"""
    chapter_id = int(chapter_id or 0)
    chapter_questions = [item for item in load_bank() if item.get('chapter_id') == chapter_id]
    if not chapter_questions:
        return 0
    attempts = state.get('attempts') or {}
    if not all((attempts.get(item['id']) or {}).get('solved') for item in chapter_questions):
        return 0
    title = chapter_questions[0].get('chapter_title') or ('第 %d 章' % chapter_id)
    awarded, _, _ = award(state, 'chapter', str(chapter_id), CHAPTER_POINTS,
                          note='%s · 题目全部通关' % title)
    return awarded


# ── 组卷 ────────────────────────────────────────────────
def build_exam(state, chapters=None, count=5, difficulty=None, track=None, seed=None):
    """从题库里优先挑没做过的题组一份卷。返回题目 id 列表。"""
    import random
    rng = random.Random(seed)
    pool = filter_questions(chapters=chapters, track=track, difficulty=difficulty,
                            only='unsolved', state=state)
    if len(pool) < count:
        pool += [item for item in filter_questions(chapters=chapters, track=track,
                                                   difficulty=difficulty, state=state)
                 if item not in pool]
    if not pool:
        return None
    rng.shuffle(pool)
    return [item['id'] for item in pool[:int(count)]]


def new_exam_id():
    return 'ex' + datetime.now().strftime('%y%m%d%H%M%S') + ('%03d' % (datetime.now().microsecond // 1000))


def exam_summary(state, exam):
    index = bank_index()
    items = []
    for qid in exam.get('questions') or []:
        item = index.get(qid)
        if not item:
            continue
        answer = (exam.get('answers') or {}).get(qid) or {}
        items.append({
            'id': qid, 'title': item.get('title', ''), 'type': item.get('type', 'choice'),
            'chapter_id': item.get('chapter_id'), 'chapter_title': item.get('chapter_title', ''),
            'difficulty': int(item.get('difficulty') or 1),
            'status': answer.get('status', 'todo'), 'stars': answer.get('stars', 0),
        })
    done = len([row for row in items if row['status'] in ('done', 'failed', 'skipped')])
    stars_total = sum(int(row['stars']) for row in items)
    total = len(items) or 1
    return {
        'id': exam.get('id'), 'created_at': exam.get('created_at'), 'status': exam.get('status'),
        'chapters': exam.get('chapters') or [], 'track': exam.get('track', ''),
        'difficulty': exam.get('difficulty'), 'count': len(items), 'done': done,
        'items': items, 'review': exam.get('review', ''), 'score': exam.get('score'),
        'stars_total': stars_total,
        'finished_at': exam.get('finished_at', ''),
        'progress': int(round(done / total * 100)),
    }
