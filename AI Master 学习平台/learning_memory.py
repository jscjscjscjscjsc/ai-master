"""个性化长记忆：只存"有用的学习特征"，不存流水账。

设计参照 HKUDS/DeepTutor 的记忆层，但按本项目的规模收敛过。它是
7 个 surface × 3 层记忆 + 11 个 markdown 文档，那是为七个产品面服务的；
这里只需要回答三件事：**这个人是谁、卡在哪、最近在干嘛**。所以砍掉层级，
保留它真正有价值的那几条机制：

1. **存提炼后的特征，不存原始对话**
   每条记录是"听了几次课 / 做了几题 / 求助几回 / 成绩的近期加权"，
   而不是"某年某月某日问了什么"。原文留在 question_bank 和答题记录里，
   需要追溯时靠 evidence 里的 ref 回查 —— 和 DeepTutor 的
   `Every fact must have ≥1 ref` 是同一个约束。

2. **证据不足就压低上限（置信度封顶）**
   这是整份设计里最便宜、最该抄的一条：只做过 1 次 → 掌握度封顶 0.5，
   2 次 → 0.8，3 次以上才允许到 1.0。三行代码就消灭了
   "蒙对一次 = 已掌握"的假阳性。原文见 DeepTutor `learning/mastery.py`：

       _CONFIDENCE_CAP = {1: 0.5, 2: 0.8}

3. **近期表现权重更高**
   早期错、后来对，应该被奖励（而不是被第一次错拖住）。
   取最近 5 次的加权，权重递增。

4. **求助次数是负信号，但只轻折**
   靠提示刷过去 ≠ 掌握。但它也是"在努力"的证据，所以只轻折、不判死，
   并且**只在有答题记录时才生效**（只看课件也会点"求助"，不该因此掉分）。

5. **禁止绝对化措辞**
   送给模型的自述里不能出现"完全掌握 / 总是错 / 精通"这类断言 ——
   教育产品里给学生贴这种标签是硬伤，而且它们本来就是模型过度推断的产物。
   对照 DeepTutor `consolidator/guards.py` 的 BANNED_PHRASES。

6. **系统判定与学习者自称分开记**
   允许学生自己说"这个我会了"，但那要标成 learner 来源，不能伪装成
   系统测出来的结论（`mastery_source`）。地图上两者颜色不同。
"""

from datetime import datetime

# 掌握度的三档阈值。绿 / 黄 / 红。
STRONG_AT = 75
DEVELOPING_AT = 40

# 证据不足时的分数上限：做过几次，就最多能拿多少分。
# 目的是不让"一次蒙对"直接变成"已掌握"。
#
# 这里的数字比 DeepTutor 的 {1: 0.5, 2: 0.8} 更严一档，因为：
#   · 他们的 gate 阈值是 0.9，而本项目的"绿"从 75 分就开始；
#   · 按 0.8 算，答对 2 次就是 82 分 → 直接进绿区"已会"，
#     等于把"两次都对"当成掌握，"半会"这一档几乎没位置。
# 收紧到 0.72 后，答对 2 次落在 72 分（黄，"半会"），
# 答对 3 次才可能进绿 —— 这样三档颜色才真的对应三种状态。
_CONFIDENCE_CAP = {0: 0.0, 1: 0.45, 2: 0.72}
# 最近几次答题的权重（越靠后越重要）。与 DeepTutor 的
# _RECENCY_WEIGHTS = (0.5, 0.7, 0.85, 0.95, 1.0) 同构。
_RECENCY_WEIGHTS = (0.5, 0.7, 0.85, 0.95, 1.0)

# 送给模型的自述里必须回避的绝对化措辞（中英各一批）。
# 命中就换成更保守的说法，而不是原样传给模型。
_ABSOLUTE_WORDS = (
    '完全掌握', '完全理解', '彻底掌握', '彻底理解', '精通', '专家',
    '完美掌握', '总能', '总是', '从来不', '从不出错', '毫无问题',
    'mastered', 'expert', 'always', 'never', 'fully understands',
)

KINDS = ('lesson', 'question', 'help')


def key(chapter_id, kp_index):
    return f'{int(chapter_id)}_{int(kp_index)}'


def _row(memory, ident):
    """取（必要时建）某个知识点的记忆行。字段一次性补齐，避免调用方 KeyError。"""
    return memory.setdefault(ident, {
        'lesson': 0,       # 听过几遍讲解
        'questions': 0,    # 做过几题
        'help': 0,         # 求助几次（含选段提问）
        'outcomes': [],    # 最近几次答题的对错，1/0，最多留 _RECENCY 长度
        'score_ema': None, # 题目给的分数（若有）的指数平均
        'evidence': [],    # 证据指针：每条能回查到"哪一次"
        'learner_claim': False,  # 学生自己说"我会了"
        'last_at': '',
        'first_at': '',
    })


def observe(state, chapter_id, kp_index, kind, score=None, ref=''):
    """记一条学习证据。

    kind: lesson（听过讲解）/ question（做了题）/ help（求助或选段提问）
    score: 答题得分 0-100（仅 question 有意义）
    ref:   证据指针，例如 'qbank:ch01-01' 或 'quiz:12'。**每条都该带**，
           这样"系统为什么说这个学生这块弱"永远能点回原始记录。
    """
    try:
        ident = key(chapter_id, kp_index)
    except (TypeError, ValueError):
        return
    if kind not in KINDS:
        return
    memory = state.setdefault('learning_memory', {})
    row = _row(memory, ident)
    today = datetime.now().strftime('%Y-%m-%d')

    field = {'lesson': 'lesson', 'question': 'questions', 'help': 'help'}[kind]
    row[field] = min(999, int(row.get(field) or 0) + 1)

    if kind == 'question':
        ok = 1 if (score is None or float(score) >= 60) else 0
        outcomes = row.setdefault('outcomes', [])
        outcomes.append(ok)
        # 只留最近 5 次：更早的表现已经被后面的覆盖，留着只增加 token
        if len(outcomes) > len(_RECENCY_WEIGHTS):
            del outcomes[:-len(_RECENCY_WEIGHTS)]
        if score is not None:
            value = max(0, min(100, float(score)))
            old = row.get('score_ema')
            row['score_ema'] = round(value if old is None else old * .65 + value * .35, 1)

    if ref:
        ev = row.setdefault('evidence', [])
        ev.append({'kind': kind, 'ref': str(ref)[:120], 'at': today})
        # 证据指针同样只留最近若干条，只用于追溯不用于计算
        if len(ev) > 12:
            del ev[:-12]

    row['last_at'] = today
    if not row.get('first_at'):
        row['first_at'] = today


def claim_mastery(state, chapter_id, kp_index, claimed=True):
    """学生自己声称"这块我会了"。

    允许，但**必须和系统测出来的结论分开记**：报告里会标成 learner 来源，
    地图上用不同状态显示。教育产品的信任底线是"不把自称伪装成实测"。
    """
    try:
        ident = key(chapter_id, kp_index)
    except (TypeError, ValueError):
        return
    memory = state.setdefault('learning_memory', {})
    _row(memory, ident)['learner_claim'] = bool(claimed)


def _weighted_recent(outcomes):
    """最近几次答题的加权正确率（0..1）。越近的权重越高。"""
    if not outcomes:
        return None
    recent = outcomes[-len(_RECENCY_WEIGHTS):]
    weights = _RECENCY_WEIGHTS[-len(recent):]
    total = sum(weights)
    return sum(w * o for w, o in zip(recent, weights)) / total if total else None


def mastery(row):
    """把一条记忆折算成掌握度。返回 score(0-100) / status / evidence / source。

    status 三档直接给前端上色：
      strong      绿 —— 会
      developing  黄 —— 半会
      weak        红 —— 没吃透
      unknown     灰 —— 还没碰过
    """
    if not row:
        return {'score': 0, 'status': 'unknown', 'evidence': 0, 'source': ''}

    questions = int(row.get('questions') or 0)
    lessons = int(row.get('lesson') or 0)
    helps = int(row.get('help') or 0)
    outcomes = row.get('outcomes') or []
    evidence = questions + lessons + helps

    if row.get('learner_claim') and not questions:
        # 只凭自称：给"半会"而不是"会"。他说自己会了，但系统没有任何实测，
        # 如实标成黄色比直接给他绿色更诚实，也避免了"自称刷满进度"。
        return {'score': 45, 'status': 'developing', 'evidence': evidence,
                'source': 'learner', 'confidence': 'claim'}

    recency = _weighted_recent(outcomes)
    if recency is None:
        # 还没做过题：只上过课/求过助。听课本身不能证明掌握，
        # 所以上限压得很低，标成黄色而不是绿色。
        base = min(lessons, 1) * 16
        score = max(0, base - min(helps, 4) * 3)
        return {'score': round(min(score, 42)), 'status': 'weak' if lessons else 'unknown',
                'evidence': evidence, 'source': 'system', 'confidence': 'thin'}

    # 主项：近期加权正确率（占大头）
    score = recency * 100 * .78
    # 听课与做题量给少量加成（有练习才算练过）
    score += min(lessons, 1) * 8 + min(questions, 3) * 4
    # 求助折减：靠提示刷过不算掌握。但有答题记录时最多折 18 分，
    # 不至于把"认真在学但常问"的学生判成没掌握。
    score -= min(helps, 3) * 6
    # 置信度封顶：做过几次就最多能拿多少（最关键的一条）
    cap = _CONFIDENCE_CAP.get(questions, 1.0) * 100
    score = max(0, min(score, cap))

    status = ('strong' if score >= STRONG_AT
              else 'developing' if score >= DEVELOPING_AT else 'weak')
    return {'score': round(score), 'status': status, 'evidence': evidence,
            'source': 'system',
            'confidence': 'ok' if questions >= 3 else 'thin'}


def _safe(text):
    """把绝对化措辞换成保守说法。宁可说"多次答对"，不要说"完全掌握"。"""
    out = str(text)
    for word in _ABSOLUTE_WORDS:
        if word in out:
            out = out.replace(word, '多次答对' if word in ('完全掌握', '彻底掌握', 'mastered') else '稳定')
    return out


def context(state, courses, chapter_id=None, limit=5):
    """给模型看的"这个学生在这块学得怎么样"，取最需要关注的前几条。

    刻意优先给**弱的**而不是强的：模型该拿这些去调整讲解的深浅，
    而不是来夸学生。这也是 DeepTutor 把 `context` 按 score 升序的原因。
    """
    rows = []
    memory = state.get('learning_memory') or {}
    for chapter in courses:
        if chapter_id and str(chapter['id']) != str(chapter_id):
            continue
        for kp in chapter.get('knowledge_points') or []:
            item = memory.get(key(chapter['id'], kp['index']))
            if not item:
                continue
            value = mastery(item)
            if value['status'] == 'unknown':
                continue
            bits = [f"{kp['title']}：掌握度 {value['score']}/100"]
            if item.get('questions'):
                bits.append(f"做题 {item['questions']} 次")
            else:
                bits.append('还没做过题')
            if item.get('help'):
                bits.append(f"求助 {item['help']} 次")
            if value.get('source') == 'learner':
                bits.append('（学生自称已掌握，未经实测）')
            rows.append((value['score'], '，'.join(bits)))
    rows.sort(key=lambda item: item[0])
    return _safe('\n'.join(text for _, text in rows[:limit]))


def graph(state, courses):
    """个人知识点掌握图。

    节点带三档状态供前端上色；边是**真实的前后置关系**：
    同一章内按知识点顺序，章与章之间按课程"阶段"衔接。
    这样图上能看出"这一章没吃透会影响下一章哪一块"，
    而不只是一条把所有点串起来的链。
    """
    memory = state.get('learning_memory') or {}
    nodes, edges = [], []
    prev_in_chapter = {}
    chapter_tail = None

    for chapter in courses:
        cid = chapter['id']
        kps = chapter.get('knowledge_points') or []
        prev = None
        for kp in kps:
            ident = key(cid, kp['index'])
            value = mastery(memory.get(ident))
            nodes.append({
                'id': ident, 'chapter_id': cid, 'kp_index': kp['index'],
                'title': kp['title'], 'chapter': chapter['title'],
                'url': f"/chapter/{cid}#kp-{kp['index'] + 1}",
                'score': value['score'], 'status': value['status'],
                'evidence': value['evidence'], 'source': value.get('source', ''),
                **({k: value[k] for k in ('confidence',) if k in value}),
            })
            # 章内：前一知识点 → 这一个（学不下去通常就卡在这个接缝上）
            if prev:
                edges.append({'from': prev, 'to': ident, 'type': 'prerequisite'})
            prev = ident
        prev_in_chapter[cid] = (kps[0]['index'] if kps else None, prev)
        # 章间：上一章的最后一个 → 本章第一个，跨章的连贯性
        if chapter_tail and kps:
            edges.append({'from': chapter_tail, 'to': key(cid, kps[0]['index']),
                          'type': 'chapter'})
        if prev:
            chapter_tail = prev

    return {'nodes': nodes, 'edges': edges}


def weak_spots(state, courses, limit=6):
    """该重点回看的知识点：已经碰过、但没吃透的，按最弱排前。

    和"没学过的"分开——没碰过的不叫漏洞，叫待学。学生要看的漏洞是
    "我学过但没掌握"的那些。前后置关系也一并给出，方便他说清"从哪儿补起"。
    """
    g = graph(state, courses)
    by_id = {n['id']: n for n in g['nodes']}
    prereq = {}
    for e in g['edges']:
        if e['type'] == 'prerequisite':
            prereq.setdefault(e['to'], e['from'])

    out = []
    for node in g['nodes']:
        if node['status'] not in ('weak', 'developing'):
            continue
        if not node['evidence']:
            continue          # 没碰过的不算漏洞
        need = prereq.get(node['id'])
        need_node = by_id.get(need) if need else None
        out.append({
            'id': node['id'], 'title': node['title'], 'chapter': node['chapter'],
            'chapter_id': node['chapter_id'], 'url': node['url'],
            'score': node['score'], 'status': node['status'],
            'needs': ({'id': need_node['id'], 'title': need_node['title'],
                       'status': need_node['status'], 'url': need_node['url'],
                       'score': need_node['score']}
                      if need_node else None),
        })
    out.sort(key=lambda item: item['score'])
    return out[:limit]
