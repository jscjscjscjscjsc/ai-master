"""评审演示账号：能真操作，但改动不落盘。

演示账号有一份预置好的、有学习痕迹的档案，评审看到的不是空壳；
但他的一切改动**只存在内存里，不写任何文件**，重启即还原。

启用方式
--------
    STARLAB_DEMO_USER=reviewer
    STARLAB_DEMO_PASSWORD=<随机口令>

不设 STARLAB_DEMO_USER 时本模块完全不启用。

实现要点：本平台的进度**不存在账号档案里**，而是从学习档案
（starlab_engine 的 state：修为点 + 作答记录 + 奖励账本）推导出来的。
所以种子数据必须写成一份真的 state，否则演示账号会是「未启程 · 0 战力」，
看起来像坏掉的空壳。这份 state 的形状与 record_attempt/award 写出来的完全一致，
所以战绩、星器、试炼、逐日路线进度都能正常推导。
"""
import copy
import os
import threading
from datetime import datetime, timedelta

_LOCK = threading.Lock()
_memo = {}


def _ago(days, hour=21, minute=30):
    stamp = datetime.now() - timedelta(days=days)
    return stamp.replace(hour=hour, minute=minute, second=0).strftime('%Y-%m-%d %H:%M:%S')


def _seed_state():
    """一份可信的学习轨迹：学了十来天，有错题、有满分、做过一次组卷。"""
    attempts = {}
    rewards = {}
    log = []

    # (题目 id, 章节, 星数, 错题数, 用 AI 次数, 几天前)
    # 题目 id 取自真实题库，所以点开题目能正常显示题干与批改记录。
    plan = [
        ('q01-01-01', 1, 3, 0, 0, 12), ('q01-01-02', 1, 3, 0, 0, 12),
        ('q01-02-01', 1, 3, 0, 0, 11), ('q01-02-03', 1, 2, 1, 1, 11),
        ('q01-03-01', 1, 3, 0, 0, 10), ('q01-04-02', 1, 2, 2, 1, 9),
        ('q02-01-01', 2, 3, 0, 0, 8), ('q02-02-02', 2, 3, 0, 1, 8),
        ('q02-03-01', 2, 2, 1, 1, 7), ('q02-04-02', 2, 3, 0, 0, 6),
        ('q03-01-01', 3, 3, 0, 0, 5), ('q03-02-02', 3, 3, 0, 0, 5),
        ('q04-01-01', 4, 3, 0, 0, 4), ('q04-02-01', 4, 3, 0, 0, 4),
        ('q04-02-03', 4, 2, 1, 1, 3), ('q04-03-01', 4, 3, 0, 0, 3),
        # 这里的 id 必须是题库里真实存在的：种子里曾引用一道不存在的题
        # （q04-05-01，第 4 章实际只到 q04-04-xx），导致按作答记录推导修为时
        # 拿到空题目对象、/api/cultivation/profile 直接 500 ——
        # 表现是"评委登录演示账号后档案页白屏"。改题库后要回头核对这一列表。
        ('q04-04-02', 4, 2, 2, 1, 2), ('q04-04-05', 4, 3, 0, 0, 2),
        ('q05-01-01', 5, 3, 0, 0, 1), ('q07-01-01', 7, 3, 0, 0, 1),
    ]
    for qid, chapter_id, stars, wrong, ai_help, day in plan:
        stamp = _ago(day)
        attempts[qid] = {
            'attempts': 1 + wrong, 'runs': 1 + wrong, 'errored_runs': wrong,
            'solved': True, 'best_stars': stars, 'clears': 1, 'wrong': wrong,
            'ai_help': ai_help, 'points': 0,
            'history': [{'ts': stamp, 'stars': stars, 'points': 0, 'mode': 'practice'}],
            'last_at': stamp, 'last_mode': 'practice', 'last_stars': stars,
            'last_answer': '', 'last_feedback': '', 'first_solved_at': stamp,
            'chapter_id': chapter_id,
        }
        rewards['question:%s' % qid] = 1
        log.append({'ts': stamp, 'reason': 'question', 'ref': qid, 'delta': 0,
                    'note': '（演示档案）'})

    kp_plan = [(1, 0, 12), (1, 1, 11), (1, 2, 10), (1, 3, 9), (2, 0, 8), (2, 1, 8),
               (2, 2, 7), (3, 0, 5), (3, 1, 5), (4, 0, 4), (4, 1, 3), (4, 2, 3)]
    for chapter_id, kp_index, day in kp_plan:
        rewards['kp:%d_%d' % (chapter_id, kp_index)] = 1
        log.append({'ts': _ago(day), 'reason': 'kp', 'ref': '%d_%d' % (chapter_id, kp_index),
                    'delta': 0, 'note': '（演示档案）'})
    rewards['chapter:1'] = 1
    log.append({'ts': _ago(9, 22, 0), 'reason': 'chapter', 'ref': '1', 'delta': 0,
                'note': '大模型基础原理 · 全部知识点完成（演示档案）'})
    # 战役记录：一次组卷，分不高也不低，像真实的一次尝试
    rewards['exam:exdemo0001'] = 1

    # 学习记忆：知识图谱与"该补哪里"读的是这份数据（learning_memory 模块）。
    # 不写它的表现是**图谱全灰**——评审点开学习档案只看到一张没有颜色的图，
    # 恰好看不出这个功能的价值。所以这里造一份**有层次**的痕迹：
    # 前面几个知识点学扎实（绿）、中间半会（黄）、后面没吃透（红），
    # 好让"哪里会 / 哪里半会 / 哪里没吃透"一眼就能分辨。
    # (章节, 知识点序号, 听课次数, 做题次数, [各次得分], 求助次数)
    memory_plan = [
        (1, 0, 1, 4, [100, 100, 100, 100], 0),   # 绿：多次满分
        (1, 1, 1, 3, [100, 90, 100], 0),          # 绿
        (1, 2, 1, 3, [80, 90, 85], 0),            # 绿
        (1, 3, 2, 2, [70, 80], 1),                # 黄：两次中等
        (2, 0, 1, 2, [60, 70], 1),                # 黄
        (2, 1, 1, 1, [50], 2),                    # 黄偏红：一次不及格还求助
        (2, 2, 1, 1, [30], 3),                    # 红：做过但没吃透
        (3, 0, 1, 2, [100, 100], 0),              # 绿
        (3, 1, 1, 1, [40], 2),                    # 红
        (4, 0, 1, 2, [100, 90], 0),               # 绿
        (4, 1, 1, 1, [60], 1),                    # 黄
        (4, 2, 1, 0, [], 1),                      # 只听过课、还没做题
    ]
    memory = {}
    for chapter_id, kp_index, lessons, questions, scores, helps in memory_plan:
        ident = '%d_%d' % (chapter_id, kp_index)
        row = {'lesson': lessons, 'questions': questions, 'help': helps,
               'outcomes': [1 if s >= 60 else 0 for s in scores],
               'score_ema': None, 'evidence': [], 'learner_claim': False,
               'last_at': _ago(max(1, 12 - kp_index)), 'first_at': _ago(12)}
        for s in scores:
            row['score_ema'] = (s if row['score_ema'] is None
                                else row['score_ema'] * .65 + s * .35)
        if row['score_ema'] is not None:
            row['score_ema'] = round(row['score_ema'], 1)
        row['evidence'].append({'kind': 'lesson', 'ref': 'demo:lesson', 'at': _ago(12)})
        memory[ident] = row

    # 修为点给一个「认真学了十来天」的量级 —— 刚好越过观星者、进入拾光者。
    # 太低像坏掉，太高不像人。
    return {
        'points': 820,
        'rewards': rewards,
        'log': log[-60:],
        'attempts': attempts,
        'learning_memory': memory,
        'drafts': {},
        'exams': [{
            'id': 'exdemo0001', 'created_at': _ago(3, 20, 10),
            'chapters': ['1', '2', '3'], 'track': '', 'difficulty': 2,
            'questions': ['q01-01-01', 'q01-02-01', 'q02-01-01', 'q02-02-02', 'q03-01-01'],
            'answers': {
                'q01-01-01': {'status': 'done', 'stars': 3, 'passed': True, 'error': ''},
                'q01-02-01': {'status': 'done', 'stars': 3, 'passed': True, 'error': ''},
                'q02-01-01': {'status': 'done', 'stars': 3, 'passed': True, 'error': ''},
                'q02-02-02': {'status': 'done', 'stars': 2, 'passed': True, 'error': ''},
                'q03-01-01': {'status': 'failed', 'stars': 0, 'passed': False,
                              'error': '概念混淆'},
            },
            'status': 'finished', 'score': 73, 'stars_total': 11,
            'review': '', 'finished_at': _ago(3, 21, 5),
        }],
        'active_exam': '',
        'scores': {},
    }


def _seed_account():
    """账号档案。进度不在这里 —— 它在 state 里，由 app.py 分发。"""
    return {
        'password': '',
        'created_at': '2026-09-01 09:00:00',
        'last_login': '',
        'daily_minutes': 90,
        'note': '评审演示账号：可以任意操作，所有改动都不会保存',
    }


def demo_user():
    return (os.environ.get('STARLAB_DEMO_USER') or '').strip()


def demo_password():
    return (os.environ.get('STARLAB_DEMO_PASSWORD') or 'review2026').strip()


def is_enabled():
    return bool(demo_user())


def is_demo(username):
    return is_enabled() and (username or '').strip() == demo_user()


def get_profile():
    with _LOCK:
        if 'profile' not in _memo:
            _memo['profile'] = _seed_account()
        return copy.deepcopy(_memo['profile'])


def set_profile(data):
    with _LOCK:
        _memo['profile'] = copy.deepcopy(data)


def get_state():
    with _LOCK:
        if 'state' not in _memo:
            _memo['state'] = _seed_state()
        return copy.deepcopy(_memo['state'])


def mutate_state(fn):
    """在内存副本上执行一次读—改—写，接口与 starlab_engine.mutate_state 一致。"""
    with _LOCK:
        state = _memo.get('state') or _seed_state()
        if fn(state) is False:
            return copy.deepcopy(state)
        _memo['state'] = state
        return copy.deepcopy(state)


def reset():
    with _LOCK:
        _memo.clear()


def banner():
    if not is_enabled():
        return ''
    return ('[demo] 评审演示账号已启用：%s / %s（所有改动只在内存里，不写入磁盘）'
            % (demo_user(), demo_password()))
