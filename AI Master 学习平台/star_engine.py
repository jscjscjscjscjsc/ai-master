"""星空修为系统：星空漫步者的成长引擎。

这是一个**纯推导**模块 —— 除了境界突破奖励，它不持有任何新的可写状态：

    已有的修为点 + 作答档案（starlab_engine 的 state）
        ↓ 统计口径（derive_stats）
    境界 / 星轨法相 / 星器 / 星辰试炼 / 探索战力 / 航线指引
        ↓ 唯一一次写回
    境界试炼的突破奖励（走 award 的防重复账本）

这么切分的好处：装备与试炼的达成条件全是**累计统计**，口径不变则同一份作答
数据在世界任何地方都推出同一个结果，不需要额外存一张「已解锁」表，
也就不会出现存档与事实不一致的脏数据。

命名体系（前端与文案统一按这套讲）：
  境界  —— 星空漫步者的十一阶，从「观星者」到「星系织者」，取自天文学真实概念
  法相  —— 每个大境界一类观测者的剪影（观星者 / 领航员 / 织星者 …）
  星仪  —— 每级一件观星仪器，名字用真实天文器材（六分仪 / 象限仪 / 星图 / 干涉仪 …）
  星器  —— 按统计达标解锁的勋章式物件
  试炼  —— 每个大境界三条目标，全达成触发一次突破奖励

境界线的命名不是随意的：十一阶正好对应「一个人从抬头看到星空，到能织出星系」
的认知升级路径 —— 学大模型这条路本身也是从「看别人演示」到「自己编排系统」。
"""

from datetime import datetime

import starlab_engine as lab

# ── 探索战力公式 ────────────────────────────────────────
# 战力必须「可解释」：每一项都能在下钻面板里对上真实数据。
# 权重刻意让「境界」占比最高——它是唯一的长期目标；
# 满分作答比通关值钱（质量导向），星器是里程碑的奖励而不是主要来源。
POWER_WEIGHT = {
    'per_point': 1,      # 修为点
    'per_level': 80,     # 境界等级
    'per_star': 25,      # 星辉（章节题目的最好成绩）
    'per_solve': 10,     # 通关题数
    'per_equip': 60,     # 星器
    'per_trial': 40,     # 已通过的星辰试炼
}


# ── 十一阶境界 ──────────────────────────────────────────
REALMS = [
    ('观星者', ['初识', '凝望', '立誓']),
    ('拾光者', ['初拾', '渐明', '汇流']),
    ('航星者', ['定向', '破雾', '远航']),
    ('绘轨者', ['描线', '成图', '预演']),
    ('折光者', ['聚光', '分光', '成像']),
    ('构星者', ['取材', '立骨', '成型']),
    ('织星者', ['引线', '结网', '成章']),
    ('驭星者', ['调频', '校准', '控速']),
    ('摘星者', ['触手', '擒获', '归舱']),
    ('燃星者', ['点火', '恒燃', '照耀']),
    ('星系织者', ['成团', '布阵', '开银河']),
]
MAX_LEVEL = len(REALMS) * 3  # 33

# 阈值曲线：T(n) = 34 + 26 * n^1.84，取 5 的整数倍。
# 校验：全站内容约 1.6 万分，满级门槛约 1.2 万 —— 认真做完能封顶，
# 只做一半（约 8000 分）落在「织星者」附近，既不速通也看不到头。
LEVEL_THRESHOLDS = [
    30, 80, 155, 260, 400, 585, 815, 1095, 1435, 1835,
    2300, 2840, 3460, 4160, 4960, 5850, 6850, 7950, 9180, 10520,
    11990, 13590, 15330, 17220, 19270, 21490, 23890, 26480, 29270, 32280,
    35520, 39010, 42760,
]


def _build_levels():
    """把 REALMS × 3 展开成 33 级表：等级 0 是「尚未启程」。"""
    levels = [{'level': 0, 'name': '未启程', 'realm': '尘世', 'stage': '', 'need': 0}]
    number = 0
    for realm, stages in REALMS:
        for stage in stages:
            number += 1
            levels.append({
                'level': number,
                'name': '%s·%s' % (realm, stage),
                'realm': realm,
                'stage': stage,
                'need': LEVEL_THRESHOLDS[number - 1] if number - 1 < len(LEVEL_THRESHOLDS) else 0,
            })
    return levels


LEVELS = _build_levels()


def level_from_points(points):
    """把修为点换算成当前境界。返回值直接给前端画等级条用。"""
    points = int(points or 0)
    level = 0
    for row in LEVELS:
        if points >= row['need']:
            level = row['level']
        else:
            break
    current = LEVELS[level]
    is_max = level >= MAX_LEVEL
    next_need = None if is_max else LEVELS[level + 1]['need']
    floor = current['need']
    to_next = 0 if is_max else max(0, next_need - points)
    span = 1 if is_max else max(1, next_need - floor)
    progress = 100 if is_max else int(round((points - floor) / span * 100))
    return {
        'points': points,
        'level': level,
        'name': current['name'],
        'realm': current['realm'],
        'stage': current['stage'],
        'max_level': MAX_LEVEL,
        'is_max': is_max,
        'floor': floor,
        'next_need': next_need,
        'next_name': '' if is_max else LEVELS[level + 1]['name'],
        'to_next': to_next,
        'progress': max(0, min(100, progress)),
    }


# ── 境界法相 ────────────────────────────────────────────
# 每个大境界一套视觉参数，前端 portrait.js 据此程序化生成星轨法相。
# tier 同时决定法相复杂度（星轨层数 / 星冠 / 甲片 / 光点），
# 所以「境界越高越壮观」不是美工画的，是参数推出来的。
#
# 配色说明：这条色带是**观测波长的顺序** —— 从肉眼可见的暖红（低能）走向
# 蓝紫（高能），再到行星与恒星的颜色，最后是多重星系的乳白。
# 换色时守两条：一是**明度随境界上升**；二是**相邻两境不落同一色相**。
REALM_ART = {
    '尘世': {
        'tier': 0, 'primary': '#9aa3ad', 'deep': '#262b33', 'aura': '#e2e6ea', 'accent': '#9aa3ad',
        'glyph': 'seed', 'rings': 0, 'crest': 0, 'plates': 0, 'particles': 6,
        'whisper': '尚未抬头，星空与你无关',
    },
    '观星者': {
        'tier': 1, 'primary': '#c98a5e', 'deep': '#3d2418', 'aura': '#f2d7c2', 'accent': '#e0a878',
        'glyph': 'spark', 'rings': 1, 'crest': 0, 'plates': 0, 'particles': 10,
        'whisper': '第一次抬头，看见了不属于自己的光',
    },
    '拾光者': {
        'tier': 2, 'primary': '#d9a83c', 'deep': '#5a3f10', 'aura': '#f0dc9f', 'accent': '#e8c25c',
        'glyph': 'spiral', 'rings': 1, 'crest': 0, 'plates': 1, 'particles': 12,
        'whisper': '开始收集散落的光点，把它们排成线',
    },
    '航星者': {
        'tier': 3, 'primary': '#4fa88a', 'deep': '#123a30', 'aura': '#b6e3d3', 'accent': '#7fd0b4',
        'glyph': 'frame', 'rings': 2, 'crest': 1, 'plates': 1, 'particles': 14,
        'whisper': '有了方向，敢在数据之间长途航行',
    },
    '绘轨者': {
        'tier': 4, 'primary': '#5b8fc4', 'deep': '#1c3550', 'aura': '#c2dcf0', 'accent': '#86b6e2',
        'glyph': 'orbit', 'rings': 2, 'crest': 1, 'plates': 2, 'particles': 16,
        'whisper': '能把一件事拆成可执行的轨道',
    },
    '折光者': {
        'tier': 5, 'primary': '#8574b0', 'deep': '#2a2347', 'aura': '#d3cbe6', 'accent': '#a696ce',
        'glyph': 'prism', 'rings': 3, 'crest': 2, 'plates': 2, 'particles': 18,
        'whisper': '让一束光穿过结构，看清它的成分',
    },
    '构星者': {
        'tier': 6, 'primary': '#c4527a', 'deep': '#4d1730', 'aura': '#f0c2d3', 'accent': '#d97a9c',
        'glyph': 'lattice', 'rings': 3, 'crest': 2, 'plates': 3, 'particles': 20,
        'whisper': '亲手搭出一颗能自己发光的东西',
    },
    '织星者': {
        'tier': 7, 'primary': '#b48cc0', 'deep': '#3f2450', 'aura': '#e2d0ea', 'accent': '#cfa8db',
        'glyph': 'weave', 'rings': 4, 'crest': 3, 'plates': 3, 'particles': 22,
        'whisper': '把工具、知识、记忆织成一张网',
    },
    '驭星者': {
        'tier': 8, 'primary': '#7aa0b8', 'deep': '#23394a', 'aura': '#d6e6ef', 'accent': '#a9c9dc',
        'glyph': 'twinring', 'rings': 4, 'crest': 3, 'plates': 4, 'particles': 24,
        'whisper': '快与省由你控制，而不是碰运气',
    },
    '摘星者': {
        'tier': 9, 'primary': '#c47a4a', 'deep': '#4a2612', 'aura': '#eccdae', 'accent': '#dc9c6c',
        'glyph': 'bolt', 'rings': 5, 'crest': 4, 'plates': 4, 'particles': 28,
        'whisper': '能把遥远的目标摘下来放进自己作品里',
    },
    '燃星者': {
        'tier': 10, 'primary': '#e0b84c', 'deep': '#5c4410', 'aura': '#fbf0cc', 'accent': '#f0cc74',
        'glyph': 'star', 'rings': 6, 'crest': 5, 'plates': 5, 'particles': 32,
        'whisper': '你自己成了别人的光源',
    },
    '星系织者': {
        'tier': 11, 'primary': '#d9c78a', 'deep': '#5c4a20', 'aura': '#fbf6e6', 'accent': '#e8d9a8',
        'glyph': 'galaxy', 'rings': 7, 'crest': 6, 'plates': 6, 'particles': 40,
        'whisper': '不止一颗星，你织出了一整片能自我运转的星系',
    },
}

# ── 星轨法相（星辰教练形象谱系）──────────────────────────
# 教练不是一个固定头像，而是**随你一起升境的存在**：你修行到哪一境，
# 它就显化什么身。观星者时是一团抱着小星的光点，星系织者时是悬于星海之上、
# 掌托星系的周天法阵。全部参数化，前端 star_coach.js 按参数程序化生成，
# 不需要任何美术素材。
COACH_FORMS = {
    '尘世': {
        'form': 'child', 'name': '星尘', 'title': '还没学会发光的尘埃',
        'primary': '#8fa3b8', 'deep': '#1d232c', 'aura': '#dce8f4', 'accent': '#7ee1ff',
        'eye': 'dot', 'halo': 0, 'rings': 0, 'crest': 0, 'cape': 0, 'ribbon': 0,
        'orbit': 0, 'shards': 0, 'particles': 8, 'star': 'orb', 'plates': 0,
        'whisper': '它和你一样，还在等你写下的第一行学习记录。',
        'note': '最初的形态，一团安静的星尘',
    },
    '观星者': {
        'form': 'child', 'name': '观星学徒', 'title': '抱着第一颗星的学徒',
        'primary': '#c98a5e', 'deep': '#3d2418', 'aura': '#f2d7c2', 'accent': '#e0a878',
        'eye': 'dot', 'halo': 0, 'rings': 1, 'crest': 0, 'cape': 0, 'ribbon': 0,
        'orbit': 0, 'shards': 0, 'particles': 10, 'star': 'orb', 'plates': 0,
        'whisper': '它抱着一颗很轻的星，等你告诉它该往哪看。',
        'note': '抬头看一眼，就是这个境界的全部任务',
    },
    '拾光者': {
        'form': 'child', 'name': '拾光少年', 'title': '口袋里装满了光',
        'primary': '#d9a83c', 'deep': '#5a3f10', 'aura': '#f0dc9f', 'accent': '#e8c25c',
        'eye': 'dot', 'halo': 1, 'rings': 1, 'crest': 1, 'cape': 0, 'ribbon': 0,
        'orbit': 1, 'shards': 3, 'particles': 14, 'star': 'orb', 'plates': 0,
        'whisper': '它开始替你收集那些零散的知识点。',
        'note': '光点是零散的，但已经会发光了',
    },
    '航星者': {
        'form': 'youth', 'name': '领航员', 'title': '手里有了一张会亮的海图',
        'primary': '#4fa88a', 'deep': '#123a30', 'aura': '#b6e3d3', 'accent': '#7fd0b4',
        'eye': 'ring', 'halo': 1, 'rings': 1, 'crest': 1, 'cape': 1, 'ribbon': 1,
        'orbit': 1, 'shards': 3, 'particles': 16, 'star': 'orb', 'plates': 1,
        'whisper': '它替你记下了走过的路，不用再凭感觉走。',
        'note': '第一次有了"路线"这个概念的形状',
    },
    '绘轨者': {
        'form': 'youth', 'name': '轨道绘图师', 'title': '把混沌画成几条线',
        'primary': '#5b8fc4', 'deep': '#1c3550', 'aura': '#c2dcf0', 'accent': '#86b6e2',
        'eye': 'ring', 'halo': 1, 'rings': 2, 'crest': 1, 'cape': 1, 'ribbon': 1,
        'orbit': 1, 'shards': 5, 'particles': 18, 'star': 'orb', 'plates': 1,
        'whisper': '它身侧的轨道是真的画出了一整圈。',
        'note': '从"知道"到"能画出来"，是这一境的分水岭',
    },
    '折光者': {
        'form': 'youth', 'name': '光谱解析师', 'title': '让光穿过结构显出成分',
        'primary': '#8574b0', 'deep': '#2a2347', 'aura': '#d3cbe6', 'accent': '#a696ce',
        'eye': 'star', 'halo': 2, 'rings': 2, 'crest': 2, 'cape': 1, 'ribbon': 1,
        'orbit': 1, 'shards': 5, 'particles': 20, 'star': 'shard', 'plates': 2,
        'whisper': '同一束问题进来，它能拆出三种不同的答案。',
        'note': '开始能解释"为什么"，而不只是"怎么做"',
    },
    '构星者': {
        'form': 'adept', 'name': '造星工匠', 'title': '手上有正在成形的星核',
        'primary': '#c4527a', 'deep': '#4d1730', 'aura': '#f0c2d3', 'accent': '#d97a9c',
        'eye': 'star', 'halo': 2, 'rings': 3, 'crest': 2, 'cape': 1, 'ribbon': 2,
        'orbit': 2, 'shards': 7, 'particles': 22, 'star': 'shard', 'plates': 2,
        'whisper': '它手里那颗星，是你第一个能跑起来的东西。',
        'note': '从看懂别人的代码，到自己造出能发光的东西',
    },
    '织星者': {
        'form': 'adept', 'name': '织网者', 'title': '把工具与知识织成一张网',
        'primary': '#b48cc0', 'deep': '#3f2450', 'aura': '#e2d0ea', 'accent': '#cfa8db',
        'eye': 'third', 'halo': 2, 'rings': 3, 'crest': 3, 'cape': 1, 'ribbon': 2,
        'orbit': 2, 'shards': 7, 'particles': 26, 'star': 'shard', 'plates': 3,
        'whisper': '它周身的线已经连成网，不再是孤立的点。',
        'note': '多工具、多知识源开始协同，而不是各自为政',
    },
    '驭星者': {
        'form': 'adept', 'name': '巡天者', 'title': '快慢由他调节',
        'primary': '#7aa0b8', 'deep': '#23394a', 'aura': '#d6e6ef', 'accent': '#a9c9dc',
        'eye': 'third', 'halo': 2, 'rings': 4, 'crest': 3, 'cape': 2, 'ribbon': 2,
        'orbit': 2, 'shards': 9, 'particles': 28, 'star': 'shard', 'plates': 3,
        'whisper': '它身侧的能量环开始反向旋转，一快一慢。',
        'note': '性能与成本在你手里成了可调的两个旋钮',
    },
    '摘星者': {
        'form': 'adept', 'name': '摘星使', 'title': '伸手就能取回远处的目标',
        'primary': '#c47a4a', 'deep': '#4a2612', 'aura': '#eccdae', 'accent': '#dc9c6c',
        'eye': 'visor', 'halo': 3, 'rings': 4, 'crest': 4, 'cape': 2, 'ribbon': 2,
        'orbit': 3, 'shards': 9, 'particles': 32, 'star': 'galaxy', 'plates': 4,
        'whisper': '它伸手的方向，永远对着一个还没做的目标。',
        'note': '能独立把一个想法做成可交付的东西',
    },
    '燃星者': {
        'form': 'immortal', 'name': '燃星法相', 'title': '自身成了光源',
        'primary': '#e0b84c', 'deep': '#5c4410', 'aura': '#fbf0cc', 'accent': '#f0cc74',
        'eye': 'visor', 'halo': 3, 'rings': 5, 'crest': 5, 'cape': 2, 'ribbon': 3,
        'orbit': 3, 'shards': 12, 'particles': 36, 'star': 'galaxy', 'plates': 4,
        'whisper': '它不再反射别人的光 —— 它自己在烧。',
        'note': '你的方案开始被别人抄，也开始被别人问',
    },
    '星系织者': {
        'form': 'immortal', 'name': '星系法相', 'title': '掌托一整个运转中的星系',
        'primary': '#d9c78a', 'deep': '#5c4a20', 'aura': '#fbf6e6', 'accent': '#e8d9a8',
        'eye': 'void', 'halo': 4, 'rings': 7, 'crest': 6, 'cape': 3, 'ribbon': 3,
        'orbit': 4, 'shards': 16, 'particles': 46, 'star': 'galaxy', 'plates': 6,
        'whisper': '它掌上的星系在自转，不需要谁去推动。',
        'note': '全站封顶。这时候你该去写点别人能用的东西了',
    },
}

# 星系织者的三个小境界是叠加式差异，不是全新法相
COACH_FINAL_STAGES = {
    '成团': {'name': '星系法相 · 成团', 'particles': -8, 'shards': -6, 'orbit': 0},
    '布阵': {'name': '星系法相 · 布阵', 'particles': -4, 'shards': -3, 'orbit': 1},
    '开银河': {'name': '星系法相 · 开银河', 'halo': 1, 'orbit': 1, 'shards': 4, 'particles': 8},
}

REALM_ORDER = [realm for realm, _ in REALMS]
REALM_RANGE = {}
_cursor = 1
for _realm, _stages in REALMS:
    REALM_RANGE[_realm] = {'start': _cursor, 'end': _cursor + len(_stages) - 1}
    _cursor += len(_stages)


def realm_of_level(level):
    try:
        level = int(level or 0)
    except (TypeError, ValueError):
        return '尘世'
    if level <= 0:
        return '尘世'
    return LEVELS[min(level, MAX_LEVEL)]['realm']


def stage_of_level(level):
    try:
        level = int(level or 0)
    except (TypeError, ValueError):
        return ''
    if level <= 0:
        return ''
    return LEVELS[min(level, MAX_LEVEL)]['stage']


def art_for(level_or_realm):
    """拿境界法相参数。传等级或境界名都行。"""
    if isinstance(level_or_realm, str):
        realm = level_or_realm
    else:
        realm = realm_of_level(level_or_realm)
    art = dict(REALM_ART.get(realm) or REALM_ART['尘世'])
    art['realm'] = realm if realm in REALM_ART else '尘世'
    art['range'] = REALM_RANGE.get(art['realm'], {'start': 0, 'end': 0})
    return art


def coach_form_for(level_or_realm):
    """星辰教练在这一境显化的法相。永不抛错，兜底为尘世。"""
    if isinstance(level_or_realm, str):
        realm = level_or_realm if level_or_realm in COACH_FORMS else realm_of_level(0)
        level = next((row['level'] for row in LEVELS if row['realm'] == realm), 0) or 0
    else:
        level = int(level_or_realm or 0)
        realm = realm_of_level(level)
    form = dict(COACH_FORMS.get(realm) or COACH_FORMS['尘世'])
    stage = stage_of_level(level)
    if realm == '星系织者' and stage in COACH_FINAL_STAGES:
        delta = COACH_FINAL_STAGES[stage]
        for key, value in delta.items():
            if key == 'name':
                form['name'] = value
            elif isinstance(value, int):
                form[key] = max(0, int(form.get(key, 0)) + value)
            else:
                form[key] = value
    form['realm'] = realm
    form['level'] = level
    form['stage'] = stage
    form['range'] = REALM_RANGE.get(realm, {'start': 0, 'end': 0})
    return form


# ── 星仪（每级一件，名字用真实观测器材）──────────────────
STAR_INSTRUMENTS = {
    0: ('肉眼', '—', '还没有工具。先用眼睛把问题看清楚。'),
    1: ('星图笔记', '记录 · 观察', '把看到的现象写下来，是全部方法论的起点。'),
    2: ('方位罗盘', '方向 · 取舍', '知道自己在第几章、下一步去哪一章。'),
    3: ('量角器', '度量 · 估算', '开始用数字说话：参数量、token 数、延迟。'),
    4: ('六分仪', '测量 · 定位', '能用一组指标定位系统到底卡在哪。'),
    5: ('光谱仪', '拆解 · 归因', '把一个问题拆成能分别验证的几块。'),
    6: ('象限仪', '精度 · 校准', '知道误差从哪来，也知道怎么把它压下去。'),
    7: ('轨道计算尺', '推演 · 预测', '能在动手前估出结果大概是多少。'),
    8: ('干涉仪', '组合 · 叠加', '多个信号一起看，才能看出单个看不到的东西。'),
    9: ('深空探测器', '探索 · 边界', '主动去够那些没有现成答案的问题。'),
    10: ('自适应光学', '纠偏 · 实时', '系统跑起来之后还能自己修正。'),
    11: ('射电阵列', '协同 · 分布式', '单台不够，就让一整排一起工作。'),
    12: ('空间望远镜', '洞察 · 全局', '跳出实现细节，看清整个系统的形状。'),
    13: ('数据中继网', '连接 · 流转', '让信息在模块之间稳定地流动。'),
    14: ('恒星模型', '建模 · 抽象', '把复杂现象压成一个能演算的模型。'),
    15: ('引力弹弓', '借力 · 加速', '懂得用现成的轮子换自己的速度。'),
    16: ('星尘采样器', '采样 · 验证', '用最小的代价验证最大的假设。'),
    17: ('轨道同步器', '协调 · 一致', '让多个部分按同一节奏走。'),
    18: ('行星雷达', '扫描 · 覆盖', '系统地找漏，而不是等人来报错。'),
    19: ('戴森环设计图', '规模 · 工程', '开始考虑数量级，而不是单个样本。'),
    20: ('虫洞理论机', '跃迁 · 跨界', '能把别的领域的解法搬过来用。'),
    21: ('时空曲率仪', '权衡 · 代价', '清楚每一个选择都要付什么代价。'),
    22: ('奇点观测台', '本质 · 第一性', '直接问"这件事的物理下限是什么"。'),
    23: ('宇宙微波背景图', '溯源 · 演algor', '从最古老的痕迹推出系统是怎么长成今天这样的。'),
    24: ('多重宇宙推演器', '分支 · 决策', '同时推演几条路线再决定走哪条。'),
    25: ('星系动力学模型', '系统 · 自洽', '让系统的各部分互相支撑而不是互相拖累。'),
    26: ('暗物质探针', '隐性 · 盲区', '能注意到那些"看不见但决定结果"的东西。'),
    27: ('暗能量调谐器', '驱动 · 势能', '知道什么在推动系统持续变好。'),
    28: ('宇宙学常数校准仪', '不变 · 守恒', '分清哪些是不变量，哪些只是当下的巧合。'),
    29: ('初始条件模拟器', '起点 · 路径', '明白早期的一个选择会怎么放大成后来的分叉。'),
    30: ('时间箭头仪', '方向 · 不可逆', '接受有些决定不可回退，并为此设计。'),
    31: ('全息宇宙投影仪', '整体 · 局部', '从一个局部就能推出整体的结构。'),
    32: ('银河系设计台', '创造 · 秩序', '你不再解释星系，你开始设计星系。'),
    33: ('无尽星海图', '未知 · 边界', '最后一张图上，边界之外仍是空白——这才是重点。'),
}


def instrument_for(level):
    try:
        level = int(level or 0)
    except (TypeError, ValueError):
        level = 0
    level = max(0, min(MAX_LEVEL, level))
    name, term, desc = STAR_INSTRUMENTS.get(level, STAR_INSTRUMENTS[0])
    return {'name': name, 'term': term, 'desc': desc}


# ── 星器（靠统计达标解锁）────────────────────────────────
# metric 的取值来自 derive_stats()；只有 have >= target 才算解锁。
EQUIPMENT = [
    {'id': 'sigil_first', 'name': '初光印记', 'slot': '印记', 'icon': 'spark',
     'metric': 'total_solved', 'target': 1, 'hint': '首次通关任意一道题',
     'why': '一切从这里开始。'},
    {'id': 'chart_route', 'name': '首航星图', 'slot': '星图', 'icon': 'map',
     'metric': 'kp_done', 'target': 6, 'hint': '完成 6 个知识点',
     'why': '先把一条航线走完，再谈星际穿越。'},
    {'id': 'lens_agent', 'name': '智能体之瞳', 'slot': '法瞳', 'icon': 'lens',
     'metric': 'agent_solved', 'target': 8, 'hint': '通关 8 道智能体章节的题目',
     'why': '智能体是这个平台的主线，这只眼睛是你真正看懂循环结构的证明。'},
    {'id': 'crown_agent', 'name': '编排者星冠', 'slot': '星冠', 'icon': 'crown',
     'metric': 'agent_perfect', 'target': 6, 'hint': '智能体章节拿到 6 次满分作答',
     'why': '能写出满分答案，说明你已经能讲清 tool call 与 memory 的边界。'},
    {'id': 'prism_rag', 'name': '检索棱镜', 'slot': '棱镜', 'icon': 'prism',
     'metric': 'rag_solved', 'target': 6, 'hint': '通关 6 道 RAG 章节的题目',
     'why': '给模型接上知识的人，都会先摸到这块棱镜。'},
    {'id': 'spark_first', 'name': '第一簇星火', 'slot': '火种', 'icon': 'flame',
     'metric': 'stars3', 'target': 1, 'hint': '任意一道题拿到满分',
     'why': '满分和及格之间，差的是"讲得清"。'},
    {'id': 'ring_deep', 'name': '深空环', 'slot': '星环', 'icon': 'ring',
     'metric': 'streak_best', 'target': 7, 'hint': '连续 7 天有学习记录',
     'why': '连续不是自律的表演，是让遗忘曲线站在你这边。'},
    {'id': 'board_hard', 'name': '难题黑板', 'slot': '黑板', 'icon': 'board',
     'metric': 'stars3_hard', 'target': 5, 'hint': '满分通关 5 道进阶题',
     'why': '进阶题一道抵三道简单题，这是你第一次尝到复利。'},
    {'id': 'shield_guard', 'name': '护栏之盾', 'slot': '护盾', 'icon': 'shield',
     'metric': 'wrong_fixed', 'target': 5, 'hint': '把 5 道错题重做并通关',
     'why': '错题本比新题集值钱，这是把漏洞变成护甲。'},
    {'id': 'net_master', 'name': '编织者之网', 'slot': '星网', 'icon': 'net',
     'metric': 'chapters_full', 'target': 4, 'hint': '4 个章节全部知识点完成',
     'why': '零散的知识点连成网，才叫体系。'},
    {'id': 'clock_night', 'name': '长夜观测钟', 'slot': '时计', 'icon': 'clock',
     'metric': 'night_solves', 'target': 3, 'hint': '3 次在深夜（23 点后）完成学习',
     'why': '深夜还在写题的人，最后都会有点东西。'},
    {'id': 'seal_60', 'name': '六十星印', 'slot': '星印', 'icon': 'seal',
     'metric': 'total_solved', 'target': 60, 'hint': '累计通关 60 道题',
     'why': '到这里，你已经有资格说"我系统地学过"。'},
]

# ── 星辰试炼（每个大境界三条目标）───────────────────────
TRIALS = [
    {'realm': '观星者', 'reward': 15, 'objectives': [
        ('clear_any', '通关任意 1 道题', 'total_solved', 1),
        ('learn_any', '完成 3 个知识点', 'kp_done', 3),
        ('star_any', '任意一道题拿到满分', 'stars3', 1)]},
    {'realm': '拾光者', 'reward': 20, 'objectives': [
        ('clear_five', '累计通关 5 道题', 'total_solved', 5),
        ('learn_ten', '完成 10 个知识点', 'kp_done', 10),
        ('chapter_one', '完整走完 1 个章节', 'chapters_full', 1)]},
    {'realm': '航星者', 'reward': 25, 'objectives': [
        ('agent_five', '通关 5 道智能体题', 'agent_solved', 5),
        ('star_five', '累计 5 道题满分', 'stars3', 5),
        ('streak_three', '连续 3 天学习', 'streak_best', 3)]},
    {'realm': '绘轨者', 'reward': 30, 'objectives': [
        ('clear_fifteen', '累计通关 15 道题', 'total_solved', 15),
        ('chapter_three', '完整走完 3 个章节', 'chapters_full', 3),
        ('rag_four', '通关 4 道 RAG 题', 'rag_solved', 4)]},
    {'realm': '折光者', 'reward': 40, 'objectives': [
        ('star_twelve', '累计 12 道题满分', 'stars3', 12),
        ('learn_thirty', '完成 30 个知识点', 'kp_done', 30),
        ('wrong_fix', '重做通关 3 道错题', 'wrong_fixed', 3)]},
    {'realm': '构星者', 'reward': 50, 'objectives': [
        ('agent_twelve', '通关 12 道智能体题', 'agent_solved', 12),
        ('hard_five', '满分通关 5 道进阶题', 'stars3_hard', 5),
        ('chapter_five', '完整走完 5 个章节', 'chapters_full', 5)]},
    {'realm': '织星者', 'reward': 60, 'objectives': [
        ('clear_thirty', '累计通关 30 道题', 'total_solved', 30),
        ('perfect_agent', '智能体章节 4 次满分', 'agent_perfect', 4),
        ('streak_week', '连续 7 天学习', 'streak_best', 7)]},
    {'realm': '驭星者', 'reward': 75, 'objectives': [
        ('rag_ten', '通关 10 道 RAG 题', 'rag_solved', 10),
        ('learn_fifty', '完成 50 个知识点', 'kp_done', 50),
        ('chapter_eight', '完整走完 8 个章节', 'chapters_full', 8)]},
    {'realm': '摘星者', 'reward': 90, 'objectives': [
        ('star_thirty', '累计 30 道题满分', 'stars3', 30),
        ('agent_twenty', '通关 20 道智能体题', 'agent_solved', 20),
        ('exam_eighty', '一次组卷拿到 80 分以上', 'exam_best', 80)]},
    {'realm': '燃星者', 'reward': 105, 'objectives': [
        ('clear_fifty', '累计通关 50 道题', 'total_solved', 50),
        ('hard_ten', '满分通关 10 道进阶题', 'stars3_hard', 10),
        ('streak_fourteen', '连续 14 天学习', 'streak_best', 14)]},
    {'realm': '星系织者', 'reward': 120, 'objectives': [
        ('clear_seventy', '累计通关 70 道题', 'total_solved', 70),
        ('chapter_all', '完整走完 10 个章节', 'chapters_full', 10),
        ('exam_sixty', '累计完成 60 道题并且满分 40 次', 'stars3', 40)]},
]


# ── 统计口径 ────────────────────────────────────────────
def derive_stats(state):
    """把作答档案压成一组可解释的统计量。所有星器/试炼条件都从这里取数。"""
    attempts = state.get('attempts') or {}
    rewards = state.get('rewards') or {}
    log = state.get('log') or []

    total_solved = total_stars = stars3 = stars2 = 0
    stars3_hard = stars3_medium = stars3_easy = 0
    agent_solved = agent_perfect = rag_solved = 0
    hard_solved = hard_attempted = 0
    clean_solves = ai_assisted = wrong_fixed = wrong_open = 0
    night_solves = 0

    for qid, record in attempts.items():
        chapter_id = (record.get('chapter_id') if isinstance(record, dict) else None)
        if chapter_id is None:
            chapter_id = lab.chapter_of_question(qid)
        track = lab.track_of_chapter(chapter_id)
        if record.get('solved'):
            total_solved += 1
            if track == 'agent':
                agent_solved += 1
            if track == 'rag':
                rag_solved += 1
        best = int(record.get('best_stars') or 0)
        total_stars += best
        if best >= 3:
            stars3 += 1
            if track == 'agent':
                agent_perfect += 1
            difficulty = lab.difficulty_of_question(qid)
            if difficulty >= 3:
                stars3_hard += 1
            elif difficulty == 2:
                stars3_medium += 1
            else:
                stars3_easy += 1
        elif best == 2:
            stars2 += 1
        if lab.difficulty_of_question(qid) >= 3:
            hard_attempted += 1
            if record.get('solved'):
                hard_solved += 1
        if record.get('skipped'):
            pass
        if record.get('clears', 0) and not record.get('wrong'):
            clean_solves += 1
        ai_assisted += int(record.get('ai_help') or 0)
        if record.get('wrong') and record.get('solved'):
            wrong_fixed += 1
        elif record.get('wrong'):
            wrong_open += 1
        for stamp in [record.get('first_solved_at'), record.get('last_at')]:
            if _is_night(stamp):
                night_solves += 1
                break

    kp_done = sum(1 for key in rewards if key.startswith('kp:'))
    chapter_done = sum(1 for key in rewards if key.startswith('chapter:'))
    exam_count = len(state.get('exams') or [])
    exam_best = 0
    for exam in state.get('exams') or []:
        try:
            exam_best = max(exam_best, int(exam.get('score') or 0))
        except (TypeError, ValueError):
            continue
    days = sorted({str(item.get('ts', ''))[:10] for item in log if item.get('ts')})
    streak_days, streak_best = _streak(days)
    return {
        'points': int(state.get('points') or 0),
        'attempted': len(attempts),
        'total_solved': total_solved,
        'total_stars': total_stars,
        'stars3': stars3,
        'stars2': stars2,
        'stars3_hard': stars3_hard,
        'stars3_medium': stars3_medium,
        'stars3_easy': stars3_easy,
        'clean_solves': clean_solves,
        'ai_assisted': ai_assisted,
        'wrong_fixed': wrong_fixed,
        'wrong_open': wrong_open,
        'hard_solved': hard_solved,
        'hard_attempted': hard_attempted,
        'agent_solved': agent_solved,
        'agent_perfect': agent_perfect,
        'rag_solved': rag_solved,
        'kp_done': kp_done,
        'chapter_done': chapter_done,
        'chapters_full': chapter_done,
        'exam_count': exam_count,
        'exam_best': exam_best,
        'night_solves': night_solves,
        'active_days': len(days),
        'streak_days': streak_days,
        'streak_best': streak_best,
    }


def _is_night(stamp):
    text = str(stamp or '')
    if ' ' not in text:
        return False
    try:
        hour = int(text.split(' ')[1][:2])
    except (ValueError, IndexError):
        return False
    return hour >= 23 or hour < 5


def _streak(days):
    """从有学习记录的日期序列里推出「当前连续」和「历史最长连续」。"""
    if not days:
        return 0, 0
    parsed = []
    for day in days:
        try:
            parsed.append(datetime.strptime(day, '%Y-%m-%d').date())
        except ValueError:
            continue
    if not parsed:
        return 0, 0
    parsed = sorted(set(parsed))
    best = run = 1
    for prev, cur in zip(parsed, parsed[1:]):
        run = run + 1 if (cur - prev).days == 1 else 1
        best = max(best, run)
    today = datetime.now().date()
    current = 0
    if parsed[-1] == today or (today - parsed[-1]).days == 1:
        current = 1
        for prev, cur in zip(reversed(parsed[:-1]), reversed(parsed)):
            if (cur - prev).days == 1:
                current += 1
            else:
                break
    return current, best


def evaluate_equipment(stats):
    rows = []
    for item in EQUIPMENT:
        have = int(stats.get(item['metric']) or 0)
        target = int(item['target'])
        rows.append({
            'id': item['id'], 'name': item['name'], 'slot': item['slot'], 'icon': item['icon'],
            'hint': item['hint'], 'why': item['why'], 'metric': item['metric'],
            'have': min(have, target), 'raw_have': have, 'target': target,
            'ratio': min(1.0, round(have / target, 3)) if target else 1.0,
            'unlocked': have >= target,
        })
    return rows


def evaluate_trials(stats, claimed):
    rows = []
    for index, trial in enumerate(TRIALS):
        objectives = []
        done_count = 0
        for oid, text, metric, target in trial['objectives']:
            have = int(stats.get(metric) or 0)
            done = have >= target
            done_count += 1 if done else 0
            objectives.append({
                'id': oid, 'text': text, 'metric': metric,
                'have': min(have, target), 'raw_have': have, 'target': target,
                'ratio': min(1.0, round(have / target, 3)) if target else 1.0,
                'done': done,
            })
        total = len(objectives) or 1
        rows.append({
            'realm': trial['realm'], 'tier': index, 'reward': trial['reward'],
            'objectives': objectives, 'done': done_count == total and bool(objectives),
            'claimed': trial['realm'] in claimed,
            'progress': int(round(done_count / total * 100)),
        })
    return rows


def power_breakdown(profile, stats, equipment, trials_done=0):
    parts = [
        {'label': '修为点', 'value': stats['points'] * POWER_WEIGHT['per_point'],
         'unit': '点', 'note': '每点修为 = 1 战力'},
        {'label': '境界', 'value': profile['level'] * POWER_WEIGHT['per_level'],
         'unit': '级', 'note': '每级境界 = 80 战力，长期目标'},
        {'label': '星辉', 'value': stats['total_stars'] * POWER_WEIGHT['per_star'],
         'unit': '星', 'note': '每颗星 = 25 战力'},
        {'label': '通关', 'value': stats['total_solved'] * POWER_WEIGHT['per_solve'],
         'unit': '题', 'note': '每题 = 10 战力'},
        {'label': '星器', 'value': len([e for e in equipment if e['unlocked']]) * POWER_WEIGHT['per_equip'],
         'unit': '件', 'note': '每件 = 60 战力'},
        {'label': '星辰试炼', 'value': trials_done * POWER_WEIGHT['per_trial'],
         'unit': '境', 'note': '每境 = 40 战力'},
    ]
    parts = [p for p in parts if p['value']]
    return {'total': sum(p['value'] for p in parts), 'parts': parts}


def light_profile(state):
    """给悬浮等级条用的精简档，避免每页都算全量统计。"""
    profile = level_from_points(state.get('points'))
    art = art_for(profile['level'])
    instrument = instrument_for(profile['level'])
    stats = derive_stats(state)
    unlocked = len([row for row in evaluate_equipment(stats) if row['unlocked']])
    return {
        'points': profile['points'], 'level': profile['level'], 'name': profile['name'],
        'realm': profile['realm'], 'progress': profile['progress'], 'to_next': profile['to_next'],
        'is_max': profile['is_max'],
        'art': {'realm': art['realm'], 'glyph': art['glyph'], 'primary': art['primary'], 'tier': art['tier']},
        'instrument': instrument,
        'equipment_unlocked': unlocked,
        'equipment_total': len(EQUIPMENT),
    }


def snapshot(username, state):
    """给修行页用的全量快照。这个函数是纯的：只读 state，不做任何写入。"""
    profile = level_from_points(state.get('points'))
    stats = derive_stats(state)
    equipment = evaluate_equipment(stats)
    claimed = {key.split(':', 1)[1] for key in (state.get('rewards') or {}) if key.startswith('trial:')}
    trials = evaluate_trials(stats, claimed)
    trials_done = len([t for t in trials if t['claimed']])
    power = power_breakdown(profile, stats, equipment, trials_done)
    art = art_for(profile['level'])

    realms = []
    for index, realm in enumerate(REALM_ORDER):
        span = REALM_RANGE[realm]
        trial = next((t for t in trials if t['realm'] == realm), None)
        realms.append({
            'realm': realm,
            'tier': index + 1,
            'art': art_for(realm),
            'range': span,
            'instrument_start': instrument_for(span['start']),
            'instrument_end': instrument_for(span['end']),
            'trial': trial,
            'reached': profile['level'] >= span['start'],
            'current': span['start'] <= profile['level'] <= span['end'],
            'equipment_done': 0,
        })

    levels = []
    for row in LEVELS[1:]:
        art_row = art_for(row['realm'])
        levels.append({
            'level': row['level'], 'name': row['name'], 'realm': row['realm'], 'stage': row['stage'],
            'need': row['need'], 'reached': profile['points'] >= row['need'],
            'current': row['level'] == profile['level'],
            'primary': art_row['primary'], 'instrument': instrument_for(row['level']),
        })

    return {
        'user': username,
        'profile': profile,
        'art': art,
        'stats': stats,
        'power': power,
        'equipment': equipment,
        'trials': trials,
        'realms': realms,
        'levels': levels,
        'rules': {
            'power_weight': POWER_WEIGHT,
            'kp_points': lab.KP_POINTS,
            'chapter_points': lab.CHAPTER_POINTS,
            'question_base': lab.QUESTION_BASE,
            'star_mult': lab.STAR_MULT,
        },
    }


def claim_trials(username, load=None, store=None):
    """唯一写回点：把已达成的试炼奖励发出去。靠 rewards 账本天然幂等。

    load / store 由调用方注入，默认走 lab 的磁盘实现。
    注入是必需的：演示账号的档案只在内存里，如果这里硬编码走磁盘，
    演示账号点一下修为页就会在 data/training/ 下生成一个空档。
    """
    if not username or username == 'guest':
        return [], None
    load = load or lab.load_state
    store = store or lab.mutate_state
    granted = []
    profile = None
    for _round in range(3):
        state = load(username)
        claimed = {key.split(':', 1)[1] for key in (state.get('rewards') or {}) if key.startswith('trial:')}
        pending = [t for t in evaluate_trials(derive_stats(state), claimed) if t['done'] and not t['claimed']]
        if not pending:
            profile = level_from_points(state.get('points'))
            break
        for trial in pending:
            def mutate(current, trial=trial):
                lab.award(current, 'trial', trial['realm'], trial['reward'],
                          note='%s · 星辰试炼全达成' % trial['realm'])
            state = store(username, mutate)
            granted.append({'realm': trial['realm'], 'reward': trial['reward']})
        profile = level_from_points(state.get('points'))
    return granted, profile


def coach_form_table(profile_level):
    """形象谱系表：十一阶法相全列出来，未到达的是灰的。看得见的目标才叫目标。"""
    table = []
    current_realm = realm_of_level(profile_level)
    for realm in ['尘世'] + REALM_ORDER:
        span = REALM_RANGE.get(realm, {'start': 0, 'end': 0})
        art = art_for(realm)
        table.append({
            'realm': realm,
            'art': art,
            'form': coach_form_for(profile_level if realm == current_realm else realm),
            'unlock_level': span['start'],
            'unlock_need': LEVELS[span['start']]['need'] if span['start'] else 0,
            'reached': profile_level >= span['start'] if span['start'] else True,
            'current': realm == current_realm,
        })
    return table
