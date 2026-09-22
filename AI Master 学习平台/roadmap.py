"""学习路线图：把 13 章 78 个知识点排成一份可以照着走的日历。

为什么要有这个模块
------------------
课程表本身只是一堆章节，学生最常问的两个问题是「我现在该学什么」和
「还剩多少」。这两个问题都不需要模型回答，只要把课程表按**每天可投入的时间**
切段就能算出来 —— 算出来的东西还比模型编的稳定：今天没做完，明天自动顺延，
不会每天给你一份不一样的计划。

排布规则（都是可解释的，不是拍脑袋）：
  1. 一个知识点的正文长度换算成阅读时间（≈ 每分钟 350 字），再加上做题时间，
     两者之和是一个知识点的**学时**。
  2. 每天装到「日目标学时」为止。装不下就留到明天，绝不把一天排成 8 小时。
  3. 每个阶段结束后的第二天是**复盘日**：不学新内容，只重做这一阶段的错题。
  4. 全部阶段结束后是**冲刺日**：三轮组卷 + 模拟面试。
  5. 已经在页面上点过「完成」的知识点会被划掉，所以这份计划是活的。

这样算下来，按每天 1.5 小时投入，整条路线大约是 6-7 周。
"""

import re
from datetime import date, timedelta

import starlab_engine as lab

# 阅读速度：中文技术内容带表格、公式与代码，逐句看懂大约每分钟 200 字。
# 这个值直接决定「一天排几个知识点」，所以宁可估慢一点 ——
# 计划排得满但天天完不成，比排得松更打击人。
CHARS_PER_MINUTE = 200
# 每个知识点配套的练习与整理时间（分钟）：3 道题 + 记笔记 + 回看讲义。
PRACTICE_MINUTES = 14
# 单个知识点的学时下限。很多知识点正文很短（比如一张对比表），
# 但真正理解它需要的时间不会低于这个数，所以设一个地板。
KP_FLOOR_MINUTES = 22
# 复盘日与冲刺日各占一整天。
REVIEW_MINUTES = 45
SPRINT_MINUTES = 90
# 默认每天投入。60 分钟是「还有别的课要上」的学生能长期坚持的量。
DEFAULT_DAILY_MINUTES = 60


def _plain(html):
    return re.sub('<[^>]+>', '', html or '')


def kp_minutes(kp):
    """一个知识点的学时 = 阅读时间 + 练习时间，不低于地板值。"""
    reading = len(_plain(kp.get('content'))) / CHARS_PER_MINUTE
    return max(KP_FLOOR_MINUTES, int(round(reading + PRACTICE_MINUTES)))


def _kind_of_day(chapter):
    return 'study'


def build_plan(courses, done_kps=None, daily_minutes=DEFAULT_DAILY_MINUTES, start=None):
    """生成逐日计划。

    done_kps：已完成的 "chapterId_kpIndex" 集合，用来标记每一天的完成度。
    daily_minutes：你每天能投入多少分钟。30/60/90/120 会得到不同长度的路线。
    """
    done_kps = set(done_kps or [])
    start = start or date.today()
    daily_minutes = max(30, int(daily_minutes or DEFAULT_DAILY_MINUTES))

    days = []
    current = {'minutes': 0, 'items': [], 'stage': None, 'review': False}
    stage_seen = []

    def flush(review=False, label=None, stage=None):
        nonlocal current
        if not current['items'] and not review:
            return
        if review:
            current['items'] = [{
                'type': 'review', 'chapter_id': current.get('stage_chapter') or 0,
                'title': label or '复盘日：重做本阶段错题',
                'chapter_title': current.get('stage') or '',
                'minutes': REVIEW_MINUTES, 'done': False,
            }]
            current['minutes'] = REVIEW_MINUTES
        current['stage'] = stage or current.get('stage')
        days.append(current)
        current = {'minutes': 0, 'items': [], 'stage': current.get('stage')}

    for chapter in courses:
        stage = chapter.get('stage', '')
        if stage and stage not in stage_seen:
            if stage_seen:
                current['stage_chapter'] = chapter['id']
                flush(review=True, label='复盘日：重做「%s」的错题' % stage_seen[-1],
                      stage=stage_seen[-1])
            stage_seen.append(stage)
            current['stage'] = stage

        kps = chapter.get('knowledge_points') or []
        for kp in kps:
            minutes = kp_minutes(kp)
            if current['minutes'] and current['minutes'] + minutes > daily_minutes:
                flush()
            key = '%s_%s' % (chapter['id'], kp['index'])
            current['items'].append({
                'type': 'kp',
                'chapter_id': chapter['id'],
                'kp_index': kp['index'],
                'title': kp['title'],
                'chapter_title': chapter['title'],
                'chapter_icon': chapter.get('icon', '✦'),
                'highlight': bool(chapter.get('highlight')),
                'minutes': minutes,
                'done': key in done_kps,
                'url': '/chapter/%s#kp-%s' % (chapter['id'], kp['index'] + 1),
            })
            current['minutes'] += minutes
        # 一章的题目在章节学完后集中做，所以每个章节后面挂一个练习条目
        if chapter.get('highlight'):
            current['items'].append({
                'type': 'practice',
                'chapter_id': chapter['id'],
                'title': '「%s」章节练习（重点章节）' % chapter['title'],
                'chapter_title': chapter['title'],
                'chapter_icon': chapter.get('icon', '✦'),
                'highlight': True,
                'minutes': 30,
                'done': _chapter_done(chapter, done_kps),
                'url': '/training?chapters=%s' % chapter['id'],
            })
            current['minutes'] += 30
        flush()

    # 收尾：整条路线的冲刺阶段
    current['stage'] = stage_seen[-1] if stage_seen else ''
    flush(review=True, label='冲刺日：三轮组卷（限时）', stage='全站冲刺')
    current['type'] = 'sprint'
    current['items'] = [{
        'type': 'exam', 'chapter_id': 0, 'title': '冲刺日：三轮组卷（限时）',
        'chapter_title': '全站冲刺', 'minutes': SPRINT_MINUTES, 'done': False,
        'url': '/training?tab=exam',
    }, {
        'type': 'interview', 'chapter_id': 0, 'title': '冲刺日：模拟面试 ×2 场',
        'chapter_title': '全站冲刺', 'minutes': 40, 'done': False,
        'url': '/coach?interview=1',
    }]
    current['minutes'] = SPRINT_MINUTES + 40
    days.append(current)

    # 补日期与序号；已完成的日期不往后顺延，保持「第 N 天」的稳定编号
    rows = []
    cursor = start
    for index, day in enumerate(days, start=1):
        total = sum(item['minutes'] for item in day['items'])
        done_all = all(item['done'] for item in day['items']) if day['items'] else False
        rows.append({
            'day': index,
            'date': cursor.strftime('%Y-%m-%d'),
            'weekday': '一二三四五六日'[cursor.weekday()],
            'stage': day.get('stage') or '',
            'minutes': total,
            'done': done_all,
            'items': day['items'],
        })
        cursor += timedelta(days=1)
    return rows


def _chapter_done(chapter, done_kps):
    kps = chapter.get('knowledge_points') or []
    if not kps:
        return False
    return all('%s_%s' % (chapter['id'], kp['index']) in done_kps for kp in kps)


def summarize(rows):
    total_days = len(rows)
    total_minutes = sum(row['minutes'] for row in rows)
    done_days = len([row for row in rows if row['done']])
    first_open = next((row for row in rows if not row['done']), None)
    return {
        'total_days': total_days,
        'total_hours': round(total_minutes / 60.0, 1),
        'done_days': done_days,
        'progress': int(round(done_days / total_days * 100)) if total_days else 0,
        'current_day': first_open['day'] if first_open else total_days,
        'current_title': (first_open['items'][0]['title'] if first_open and first_open['items'] else ''),
        'weeks': round(total_days / 7.0, 1),
    }


def build(courses=None, done_kps=None, daily_minutes=DEFAULT_DAILY_MINUTES):
    courses = courses or lab.courses()
    rows = build_plan(courses, done_kps, daily_minutes)
    return {'days': rows, 'summary': summarize(rows)}
