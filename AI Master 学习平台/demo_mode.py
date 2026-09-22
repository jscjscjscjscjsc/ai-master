"""评审演示账号：能真操作，但改动不落盘。

与 PyMaster 的 demo_mode.py 是同一套思路（两个平台一起上线，行为要一致）：
演示账号有一个预置好的、有学习痕迹的档案，评审看到的不是空壳；
但他的一切改动**只存在内存里，不写任何文件**，重启即还原。

启用方式
--------
    STARLAB_DEMO_USER=reviewer
    STARLAB_DEMO_PASSWORD=<随机口令>

不设 STARLAB_DEMO_USER 时本模块完全不生效。
"""
import copy
import os
import threading

_LOCK = threading.Lock()
_memo = {}

# 演示账号的默认画像：一个学了一阵子的学生。
# 数值刻意不夸张，评审看到的是可信的学习轨迹。
_SEED = {
    'nickname': '评审演示',
    'created_at': '2026-09-01 09:00:00',
    'last_login': '',
    'daily_minutes': 90,
    'note': '评审演示账号：可以任意操作，所有改动都不会保存',
    # 学习路线与进度由 roadmap / star_engine 推导，这里给一点起点
    'completed_kps': ['1_0', '1_1', '2_0', '2_1', '3_0'],
    'stars': {'1_0': 3, '1_1': 2, '2_0': 3},
    'minutes': 186,
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
            _memo['profile'] = copy.deepcopy(_SEED)
        return copy.deepcopy(_memo['profile'])


def set_profile(data):
    with _LOCK:
        _memo['profile'] = copy.deepcopy(data)


def reset():
    with _LOCK:
        _memo.clear()


def banner():
    if not is_enabled():
        return ''
    return (f'[demo] 评审演示账号已启用：{demo_user()} / {demo_password()}'
            '（所有改动只在内存里，不写入磁盘）')
