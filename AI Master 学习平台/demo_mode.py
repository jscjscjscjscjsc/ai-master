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
        ('q04-04-02', 4, 2, 2, 1, 2), ('q04-05-01', 4, 3, 0, 0, 2),
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

    # 修为点给一个「认真学了十来天」的量级 —— 刚好越过观星者、进入拾光者。
    # 太低像坏掉，太高不像人。
    return {
        'points': 820,
        'rewards': rewards,
        'log': log[-60:],
        'attempts': attempts,
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
