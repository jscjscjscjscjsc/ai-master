/* ===========================================================
   在线演示站（GitHub Pages）的引擎
   -----------------------------------------------------------
   Pages 上没有 Python、没有大模型，所以这里把服务端算的东西
   在浏览器里按**同一套规则**重算：

     修为      等级曲线、星器解锁、试炼达成 —— 直接从 data/star_engine.json
               读同一批表，用与 star_engine.py 相同的判据推导
     逐日路线  排布规则与 roadmap.py 一致（读 data/rules.json 的参数）
     题库      整包在 data/question_bank.json，前端筛选与本地判分
     学习进度  存 localStorage（在线站不设账号体系）

   与本地版的关系：数据与规则的**唯一定义仍在 Python 侧**，
   导出时序列化成 JSON。所以两边的平衡参数不会漂移 ——
   改一次 star_engine.py，重新导出即可。

   没有后端的部分（AI 答疑 / 评分 / 语音 / 智能体）不假装能用，
   而是给出明确提示：说清「这个功能要什么」比留一个转圈更有用。
   =========================================================== */

window.StarlabStatic = (function () {
  'use strict';

  const DATA_URL = 'data/';
  const STORE_KEY = 'starlab_static_v1';

  const state = {
    ready: false,
    courses: [],
    bank: [],
    registry: {},
    tables: {},
    rules: {},
    byId: new Map(),
    progress: null,
  };

  // ── 读取数据 ───────────────────────────────────────────
  async function loadJSON(name) {
    const response = await fetch(DATA_URL + name, { cache: 'force-cache' });
    if (!response.ok) throw new Error('缺少数据文件 ' + name);
    return response.json();
  }

  async function init() {
    if (state.ready) return state;
    const [courses, bank, tables, rules, registry] = await Promise.all([
      loadJSON('courses.json'),
      loadJSON('question_bank.json'),
      loadJSON('star_engine.json'),
      loadJSON('rules.json'),
      loadJSON('cg_registry.json').catch(() => ({})),
    ]);
    state.courses = courses;
    state.bank = bank;
    state.tables = tables;
    state.rules = rules;
    state.registry = registry;
    bank.forEach((q) => state.byId.set(q.id, q));
    state.progress = loadProgress();
    state.ready = true;
    return state;
  }

  // ── 学习进度（localStorage）─────────────────────────────
  // 结构刻意与本地版 starlab_engine 的 state 对齐：
  // 这样同一份数据在两边的推导结果一致，将来也便于互通。
  function emptyProgress() {
    return { points: 0, rewards: {}, attempts: {}, seen_equipment: [], daily_minutes: 60, mode: 'study' };
  }

  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return emptyProgress();
      const parsed = JSON.parse(raw);
      return Object.assign(emptyProgress(), parsed);
    } catch (error) {
      return emptyProgress();
    }
  }

  function saveProgress() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state.progress));
      return true;
    } catch (error) {
      return false;
    }
  }

  function resetProgress() {
    state.progress = emptyProgress();
    saveProgress();
  }

  // ── 积分（与 starlab_engine 同一公式）───────────────────
  function questionPoints(difficulty, stars, clears) {
    const base = state.rules.QUESTION_BASE[String(difficulty || 1)] || 10;
    const mult = state.rules.STAR_MULT[String(stars || 0)] || 0;
    const bonus = clears ? 1 : state.rules.FIRST_CLEAR_BONUS;
    const decay = state.rules.REPEAT_DECAY[Math.min(clears || 0, state.rules.REPEAT_DECAY.length - 1)];
    return Math.round(base * mult * bonus * decay);
  }

  function award(reason, ref, amount) {
    const key = reason + ':' + ref;
    if (state.progress.rewards[key]) return 0;
    const value = Math.max(0, Math.min(Number(amount) || 0, state.rules.MAX_AWARD));
    if (!value) return 0;
    state.progress.rewards[key] = value;
    state.progress.points += value;
    return value;
  }

  // ── 修为推导（与 star_engine.py 同一判据）──────────────
  function levelFromPoints(points) {
    const levels = state.tables.LEVELS;
    let level = 0;
    for (const row of levels) {
      if (points >= row.need) level = row.level;
      else break;
    }
    const current = levels[level];
    const isMax = level >= state.tables.MAX_LEVEL;
    const next = isMax ? null : levels[level + 1];
    const span = isMax ? 1 : Math.max(1, next.need - current.need);
    return {
      points: points, level: level, name: current.name, realm: current.realm,
      stage: current.stage, max_level: state.tables.MAX_LEVEL, is_max: isMax,
      floor: current.need, next_need: isMax ? null : next.need,
      next_name: isMax ? '' : next.name, to_next: isMax ? 0 : Math.max(0, next.need - points),
      progress: isMax ? 100 : Math.max(0, Math.min(100, Math.round((points - current.need) / span * 100))),
    };
  }

  function artFor(levelOrRealm) {
    // 传等级号时要从 LEVELS 表里查境界 —— 不能用 levelFromPoints（它读的是修为点）
    const resolved = typeof levelOrRealm === 'string'
      ? (state.tables.REALM_ART[levelOrRealm] ? levelOrRealm : '尘世')
      : levelRow(levelOrRealm).realm;
    const art = Object.assign({}, state.tables.REALM_ART[resolved] || state.tables.REALM_ART['尘世']);
    art.realm = resolved;
    art.range = state.tables.REALM_RANGE[resolved] || { start: 0, end: 0 };
    return art;
  }

  function instrumentFor(level) {
    const row = state.tables.STAR_INSTRUMENTS[String(Math.max(0, Math.min(
      state.tables.MAX_LEVEL, Number(level) || 0)))];
    const fallback = state.tables.STAR_INSTRUMENTS['0'];
    const value = row || fallback;
    return { name: value[0], term: value[1], desc: value[2] };
  }

  function chapterOfQuestion(id) {
    const item = state.byId.get(id);
    return item ? item.chapter_id : null;
  }

  // 赛道判定：与 starlab_engine 的 TRACK_BY_CHAPTER 对齐
  const TRACK = { 4: 'agent', 5: 'agent', 6: 'agent', 7: 'rag', 8: 'finetune', 9: 'deploy',
                  1: 'base', 2: 'base', 3: 'base' };

  function trackOf(chapterId) {
    return TRACK[chapterId] || 'other';
  }

  function difficultyOf(id) {
    const item = state.byId.get(id);
    return item ? Number(item.difficulty || 1) : 1;
  }

  function isNight(stamp) {
    const text = String(stamp || '');
    if (text.indexOf(' ') < 0) return false;
    const hour = parseInt(text.split(' ')[1].slice(0, 2), 10);
    return hour >= 23 || hour < 5;
  }

  function deriveStats() {
    const attempts = state.progress.attempts || {};
    const rewards = state.progress.rewards || {};
    const stats = {
      points: state.progress.points, attempted: 0, total_solved: 0, total_stars: 0,
      stars3: 0, stars2: 0, stars3_hard: 0, stars3_medium: 0, stars3_easy: 0,
      clean_solves: 0, ai_assisted: 0, wrong_fixed: 0, wrong_open: 0,
      hard_solved: 0, hard_attempted: 0, agent_solved: 0, agent_perfect: 0,
      rag_solved: 0, kp_done: 0, chapter_done: 0, chapters_full: 0,
      exam_count: 0, exam_best: 0, night_solves: 0, active_days: 0,
      streak_days: 0, streak_best: 0,
    };
    const days = new Set();
    Object.keys(attempts).forEach((qid) => {
      const record = attempts[qid] || {};
      const chapterId = record.chapter_id != null ? record.chapter_id : chapterOfQuestion(qid);
      const track = trackOf(chapterId);
      stats.attempted += 1;
      if (record.solved) {
        stats.total_solved += 1;
        if (track === 'agent') stats.agent_solved += 1;
        if (track === 'rag') stats.rag_solved += 1;
      }
      const best = Number(record.best_stars || 0);
      stats.total_stars += best;
      const difficulty = difficultyOf(qid);
      if (best >= 3) {
        stats.stars3 += 1;
        if (track === 'agent') stats.agent_perfect += 1;
        if (difficulty >= 3) stats.stars3_hard += 1;
        else if (difficulty === 2) stats.stars3_medium += 1;
        else stats.stars3_easy += 1;
      } else if (best === 2) {
        stats.stars2 += 1;
      }
      if (difficulty >= 3) {
        stats.hard_attempted += 1;
        if (record.solved) stats.hard_solved += 1;
      }
      if (record.clears && !record.wrong) stats.clean_solves += 1;
      stats.ai_assisted += Number(record.ai_help || 0);
      if (record.wrong && record.solved) stats.wrong_fixed += 1;
      else if (record.wrong) stats.wrong_open += 1;
      [record.first_solved_at, record.last_at].forEach((stamp) => {
        if (isNight(stamp)) { stats.night_solves += 1; }
      });
      if (record.last_at) days.add(String(record.last_at).slice(0, 10));
    });
    Object.keys(rewards).forEach((key) => {
      if (key.indexOf('kp:') === 0) stats.kp_done += 1;
      if (key.indexOf('chapter:') === 0) stats.chapter_done += 1;
    });
    stats.chapters_full = stats.chapter_done;

    // 连续学习天数
    const sorted = [...days].sort();
    let best = sorted.length ? 1 : 0;
    let run = best;
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = new Date(sorted[i - 1] + 'T00:00:00');
      const cur = new Date(sorted[i] + 'T00:00:00');
      run = (cur - prev) === 86400000 ? run + 1 : 1;
      best = Math.max(best, run);
    }
    stats.streak_best = best;
    stats.active_days = sorted.length;
    stats.streak_days = best;
    return stats;
  }

  function evaluateEquipment(stats) {
    return state.tables.EQUIPMENT.map((item) => {
      const have = Number(stats[item.metric] || 0);
      const target = Number(item.target);
      return Object.assign({}, item, {
        have: Math.min(have, target), raw_have: have, target: target,
        ratio: target ? Math.min(1, have / target) : 1,
        unlocked: have >= target,
      });
    });
  }

  function evaluateTrials(stats) {
    const claimed = new Set(Object.keys(state.progress.rewards || {})
      .filter((key) => key.indexOf('trial:') === 0)
      .map((key) => key.split(':')[1]));
    return state.tables.TRIALS.map((trial, index) => {
      let doneCount = 0;
      const objectives = (trial.objectives || []).map((row) => {
        const have = Number(stats[row[2]] || 0);
        const target = Number(row[3]);
        const done = have >= target;
        if (done) doneCount += 1;
        return { id: row[0], text: row[1], metric: row[2],
                 have: Math.min(have, target), raw_have: have, target: target, done: done };
      });
      const total = objectives.length || 1;
      return {
        realm: trial.realm, tier: index, reward: trial.reward, objectives: objectives,
        done: objectives.length > 0 && doneCount === total,
        claimed: claimed.has(trial.realm),
        progress: Math.round(doneCount / total * 100),
      };
    });
  }

  function powerBreakdown(profile, stats, equipment, trialsDone) {
    const weight = state.tables.POWER_WEIGHT;
    const parts = [
      { label: '修为点', value: stats.points * weight.per_point, unit: '点', note: '每点修为 = 1 战力' },
      { label: '境界', value: profile.level * weight.per_level, unit: '级', note: '每级境界 = 80 战力，长期目标' },
      { label: '星辉', value: stats.total_stars * weight.per_star, unit: '星', note: '每颗星 = 25 战力' },
      { label: '通关', value: stats.total_solved * weight.per_solve, unit: '题', note: '每题 = 10 战力' },
      { label: '星器', value: equipment.filter((e) => e.unlocked).length * weight.per_equip, unit: '件', note: '每件 = 60 战力' },
      { label: '星辰试炼', value: trialsDone * weight.per_trial, unit: '境', note: '每境 = 40 战力' },
    ].filter((p) => p.value);
    return { total: parts.reduce((sum, p) => sum + p.value, 0), parts: parts };
  }

  /** 领试炼奖励：与本地版一样是唯一写回点，靠 rewards 账本幂等。 */
  function claimTrials() {
    const granted = [];
    for (let round = 0; round < 3; round += 1) {
      const stats = deriveStats();
      const pending = evaluateTrials(stats).filter((t) => t.done && !t.claimed);
      if (!pending.length) break;
      pending.forEach((trial) => {
        const got = award('trial', trial.realm, trial.reward);
        if (got) granted.push({ realm: trial.realm, reward: got });
      });
    }
    if (granted.length) saveProgress();
    return granted;
  }

  /** 按「等级号」取等级行。
   *
   * 注意不要用 levelFromPoints 干这件事：它参数是**修为点**，
   * 传等级号进去会算错 —— 比如 coachFormFor(5) 想表达"5 级"，
   * 却被解读成"5 个修为点"，于是永远停在最低境界。这个坑踩过一次。
   */
  function levelRow(level) {
    const index = Math.max(0, Math.min(state.tables.MAX_LEVEL, Number(level) || 0));
    return state.tables.LEVELS[index] || state.tables.LEVELS[0];
  }

  function coachFormFor(levelOrRealm) {
    const isRealm = typeof levelOrRealm === 'string';
    const level = isRealm ? 0 : Math.max(0, Math.min(state.tables.MAX_LEVEL, Number(levelOrRealm) || 0));
    const realm = isRealm ? levelOrRealm : levelRow(level).realm;
    const resolved = state.tables.COACH_FORMS[realm] ? realm : '尘世';
    const form = Object.assign({}, state.tables.COACH_FORMS[resolved]);
    const stage = level ? levelRow(level).stage : '';
    if (resolved === '星系织者' && state.tables.COACH_FINAL_STAGES[stage]) {
      const delta = state.tables.COACH_FINAL_STAGES[stage];
      Object.keys(delta).forEach((key) => {
        if (key === 'name') form.name = delta[key];
        else if (typeof delta[key] === 'number') form[key] = Math.max(0, (form[key] || 0) + delta[key]);
        else form[key] = delta[key];
      });
    }
    form.realm = resolved;
    form.level = level;
    form.stage = stage;
    form.range = state.tables.REALM_RANGE[resolved] || { start: 0, end: 0 };
    return form;
  }

  function snapshot() {
    const profile = levelFromPoints(state.progress.points);
    const stats = deriveStats();
    const equipment = evaluateEquipment(stats);
    const trials = evaluateTrials(stats);
    const trialsDone = trials.filter((t) => t.claimed).length;
    return {
      success: true, user: 'guest', is_guest: true, profile: profile,
      art: artFor(profile.level), stats: stats,
      power: powerBreakdown(profile, stats, equipment, trialsDone),
      equipment: equipment, trials: trials,
      levels: state.tables.LEVELS.map((row) => Object.assign({}, row, {
        reached: state.progress.points >= row.need,
        current: row.level === profile.level,
        primary: (state.tables.REALM_ART[row.realm] || {}).primary || '#7ee1ff',
        instrument: instrumentFor(row.level),
      })),
      realms: state.tables.REALM_ORDER.map((realm, index) => {
        const range = state.tables.REALM_RANGE[realm];
        return {
          realm: realm, tier: index + 1, art: artFor(realm), range: range,
          instrument_start: instrumentFor(range.start), instrument_end: instrumentFor(range.end),
          trial: trials.find((t) => t.realm === realm) || null,
          reached: profile.level >= range.start,
          current: profile.level >= range.start && profile.level <= range.end,
        };
      }),
      rules: state.rules,
    };
  }

  // ── 逐日路线（与 roadmap.py 同一排布规则）───────────────
  function plainLength(html) {
    return String(html || '').replace(/<[^>]+>/g, '').length;
  }

  function kpMinutes(kp) {
    const cfg = state.rules.ROADMAP || {};
    const reading = plainLength(kp.content) / (cfg.CHARS_PER_MINUTE || 200);
    return Math.max(cfg.KP_FLOOR_MINUTES || 22, Math.round(reading + (cfg.PRACTICE_MINUTES || 14)));
  }

  function doneKps() {
    return new Set(Object.keys(state.progress.rewards || {})
      .filter((key) => key.indexOf('kp:') === 0)
      .map((key) => key.split(':')[1]));
  }

  function buildRoadmap(dailyMinutes) {
    const cfg = state.rules.ROADMAP || {};
    const daily = Math.max(30, Number(dailyMinutes) || cfg.DEFAULT_DAILY_MINUTES || 60);
    const done = doneKps();
    const days = [];
    let current = { minutes: 0, items: [], stage: null };
    const stageSeen = [];
    const reviewMinutes = cfg.REVIEW_MINUTES || 45;

    const flush = (reviewLabel, stage) => {
      if (!current.items.length && !reviewLabel) return;
      const items = reviewLabel ? [{
        type: 'review', chapter_id: 0, title: reviewLabel,
        chapter_title: stage || '', minutes: reviewMinutes, done: false, url: '#',
      }] : current.items;
      days.push({
        stage: stage || current.stage || '',
        minutes: items.reduce((sum, item) => sum + item.minutes, 0),
        items: items,
      });
      current = { minutes: 0, items: [], stage: stage || current.stage };
    };

    state.courses.forEach((chapter) => {
      const stage = chapter.stage || '';
      if (stage && stageSeen.indexOf(stage) < 0) {
        if (stageSeen.length) flush('复盘日：重做「' + stageSeen[stageSeen.length - 1] + '」的错题',
                                   stageSeen[stageSeen.length - 1]);
        stageSeen.push(stage);
        current.stage = stage;
      }
      (chapter.knowledge_points || []).forEach((kp) => {
        const minutes = kpMinutes(kp);
        if (current.minutes && current.minutes + minutes > daily) flush(null, null);
        const key = chapter.id + '_' + kp.index;
        current.items.push({
          type: 'kp', chapter_id: chapter.id, kp_index: kp.index, title: kp.title,
          chapter_title: chapter.title, chapter_icon: chapter.icon || '✦',
          highlight: Boolean(chapter.highlight), minutes: minutes, done: done.has(key),
          url: 'chapter-' + chapter.id + '.html#kp-' + (kp.index + 1),
        });
        current.minutes += minutes;
      });
      // 主线章节后面挂一次集中练习
      if (chapter.highlight) {
        const kps = chapter.knowledge_points || [];
        const finished = kps.every((kp) => done.has(chapter.id + '_' + kp.index));
        current.items.push({
          type: 'practice', chapter_id: chapter.id,
          title: '「' + chapter.title + '」章节练习（重点章节）',
          chapter_title: chapter.title, chapter_icon: chapter.icon || '✦',
          highlight: true, minutes: 30, done: finished,
          url: 'training.html?chapters=' + chapter.id,
        });
        current.minutes += 30;
      }
      flush(null, null);
    });

    // 收尾：整条路线的冲刺阶段。
    // 注意这是**两天**，不是一天：先一天限时组卷，再一天模拟面试。
    // 我第一版把它们并成一天，路线就比本地版少了一天 —— 这种偏差
    // 单看在线站发现不了，只有和本地逐项比对才暴露。
    current.stage = stageSeen.length ? stageSeen[stageSeen.length - 1] : '';
    const sprintMinutes = cfg.SPRINT_MINUTES || 90;
    // 第一天：组卷日（走 flush 的复盘分支，与本地版同一路径）
    flush('冲刺日：三轮组卷（限时）', '全站冲刺');
    // 第二天：面试日
    days.push({
      stage: '全站冲刺',
      minutes: sprintMinutes + 40,
      items: [
        { type: 'exam', chapter_id: 0, title: '冲刺日：三轮组卷（限时）',
          chapter_title: '全站冲刺', minutes: sprintMinutes, done: false,
          url: 'training.html?tab=exam' },
        { type: 'interview', chapter_id: 0, title: '冲刺日：模拟面试 ×2 场',
          chapter_title: '全站冲刺', minutes: 40, done: false, url: 'coach.html?interview=1' },
      ],
    });

    const today = new Date();
    const rows = days.map((day, index) => {
      const date = new Date(today.getTime() + index * 86400000);
      return Object.assign({}, day, {
        day: index + 1,
        date: date.toISOString().slice(0, 10),
        weekday: '一二三四五六日'[(date.getDay() + 6) % 7],
        done: day.items.length > 0 && day.items.every((item) => item.done),
      });
    });
    const firstOpen = rows.find((row) => !row.done);
    const totalMinutes = rows.reduce((sum, row) => sum + row.minutes, 0);
    return {
      success: true, days: rows, daily_minutes: daily,
      summary: {
        total_days: rows.length,
        total_hours: Math.round(totalMinutes / 60 * 10) / 10,
        done_days: rows.filter((r) => r.done).length,
        progress: rows.length ? Math.round(rows.filter((r) => r.done).length / rows.length * 100) : 0,
        current_day: firstOpen ? firstOpen.day : rows.length,
        current_title: firstOpen && firstOpen.items.length ? firstOpen.items[0].title : '',
        weeks: Math.round(rows.length / 7 * 10) / 10,
      },
    };
  }

  // ── 题库 ───────────────────────────────────────────────
  function questionBrief(item) {
    const record = (state.progress.attempts || {})[item.id] || {};
    const brief = {
      id: item.id, chapter_id: item.chapter_id, chapter_title: item.chapter_title,
      title: item.title, type: item.type || 'choice',
      difficulty: Number(item.difficulty || 1), track: item.track || '',
      tags: item.tags || [], statement: item.statement || '',
      points: questionPoints(item.difficulty, 3, 0),
      solved: Boolean(record.solved), best_stars: Number(record.best_stars || 0),
      wrong: Boolean(record.wrong),
    };
    if (brief.type === 'choice') brief.options = item.options || [];
    else { brief.hints = (item.hints || []).slice(0, 3); brief.starter_code = item.starter_code || ''; }
    return brief;
  }

  function fullQuestion(id) {
    const item = state.byId.get(id);
    if (!item) return null;
    return Object.assign(questionBrief(item), {
      reference: item.reference || '', solution: item.solution || '',
      explanation: item.explanation || '', answer: item.answer,
    });
  }

  function filterQuestions(options) {
    const opts = options || {};
    const chapters = new Set((opts.chapters || []).map(Number));
    const attempts = state.progress.attempts || {};
    return state.bank.filter((item) => {
      if (chapters.size && !chapters.has(Number(item.chapter_id))) return false;
      if (opts.type && (item.type || 'choice') !== opts.type) return false;
      if (opts.difficulty && Number(item.difficulty) !== Number(opts.difficulty)) return false;
      const record = attempts[item.id] || {};
      if (opts.only === 'unsolved' && record.solved) return false;
      if (opts.only === 'solved' && !record.solved) return false;
      if (opts.only === 'wrong' && !record.wrong) return false;
      return true;
    });
  }

  function catalog() {
    const byChapter = new Map();
    state.bank.forEach((item) => {
      const bucket = byChapter.get(item.chapter_id) ||
        { count: 0, solved: 0, wrong: 0 };
      bucket.count += 1;
      const record = (state.progress.attempts || {})[item.id] || {};
      if (record.solved) bucket.solved += 1;
      if (record.wrong) bucket.wrong += 1;
      byChapter.set(item.chapter_id, bucket);
    });
    return state.courses.filter((c) => byChapter.has(c.id)).map((c) => {
      const bucket = byChapter.get(c.id);
      return {
        id: c.id, title: c.title, icon: c.icon || '✦', track: c.highlight ? 'agent' : 'course',
        stage: c.stage, highlight: Boolean(c.highlight), count: bucket.count,
        solved: bucket.solved, wrong: bucket.wrong,
        progress: bucket.count ? Math.round(bucket.solved / bucket.count * 100) : 0,
      };
    });
  }

  /** 本地判分并结算。选择题在本地就能判；主观题需要 AI。 */
  function submitAnswer(id, answer, score, feedback) {
    const item = state.byId.get(id);
    if (!item) return { success: false, message: '题目不存在' };
    const record = (state.progress.attempts || {})[id] || {};
    const type = item.type || 'choice';
    let passed, stars;
    if (type === 'choice') {
      const picked = parseInt(answer, 10);
      passed = picked === Number(item.answer);
      stars = passed ? 3 : 0;
      if (!feedback) {
        feedback = passed
          ? String(item.explanation || '').replace(/<[^>]+>/g, '').slice(0, 400)
          : '再想想：正确答案是「' + (item.options || [])[Number(item.answer)] + '」。' +
            String(item.explanation || '').replace(/<[^>]+>/g, '').slice(0, 300);
      }
    } else {
      const value = Number(score);
      if (!Number.isFinite(value)) return { success: false, message: '简答与代码题需要 AI 评分' };
      passed = value >= 60;
      stars = value >= 90 ? 3 : value >= 70 ? 2 : value >= 60 ? 1 : 0;
    }

    record.attempts = Number(record.attempts || 0) + 1;
    record.last_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
    record.last_answer = String(answer || '').slice(0, 4000);
    record.chapter_id = item.chapter_id;
    if (passed) {
      record.solved = true;
      if (stars > Number(record.best_stars || 0)) record.best_stars = stars;
      if (!record.first_solved_at) record.first_solved_at = record.last_at;
    } else {
      record.wrong = Number(record.wrong || 0) + 1;
    }
    state.progress.attempts[id] = record;

    let points = 0;
    if (passed) {
      const clears = Number(record.clears || 0);
      points = questionPoints(item.difficulty, stars, clears);
      const ref = clears ? id + '#' + (clears + 1) : id;
      const gave = award('question', ref, points);
      if (gave) { record.clears = clears + 1; points = gave; }
      else { points = 0; }
    }
    // 一章的题全通关 → 章节奖励（与本地版一致）
    const chapterQuestions = state.bank.filter((q) => q.chapter_id === item.chapter_id);
    if (chapterQuestions.length && chapterQuestions.every((q) => (state.progress.attempts[q.id] || {}).solved)) {
      award('chapter', String(item.chapter_id), state.rules.CHAPTER_POINTS);
    }
    saveProgress();

    const stats = deriveStats();
    return {
      success: true, guest: true,
      verdict: { passed: passed, stars: stars, score: type === 'choice' ? (passed ? 100 : 0) : Number(score) },
      feedback: feedback, reveal: fullQuestion(id),
      settle: { points: points, stars: stars, best_stars: record.best_stars,
                profile: levelFromPoints(state.progress.points),
                just_unlocked: evaluateEquipment(stats).filter((e) => e.unlocked).map((e) => e.name) },
    };
  }

  function completeKp(chapterId, kpIndex) {
    const chapter = state.courses.find((c) => c.id === Number(chapterId));
    if (!chapter) return { success: false, message: '章节不存在' };
    const ref = chapterId + '_' + kpIndex;
    const awarded = award('kp', ref, state.rules.KP_POINTS);
    const kps = chapter.knowledge_points || [];
    const keys = new Set(Object.keys(state.progress.rewards || {})
      .filter((k) => k.indexOf('kp:') === 0).map((k) => k.split(':')[1]));
    let bonus = 0;
    if (kps.length && kps.every((kp) => keys.has(chapterId + '_' + kp.index))) {
      bonus = award('chapter', String(chapterId), state.rules.CHAPTER_POINTS);
    }
    saveProgress();
    return {
      success: true, awarded: awarded + bonus, bonus: bonus,
      profile: levelFromPoints(state.progress.points),
      completed_kps: [...keys],
    };
  }

  function completedKps() {
    return [...new Set(Object.keys(state.progress.rewards || {})
      .filter((k) => k.indexOf('kp:') === 0).map((k) => k.split(':')[1]))];
  }

  function overview() {
    const profile = levelFromPoints(state.progress.points);
    const stats = deriveStats();
    const equipment = evaluateEquipment(stats);
    const trials = evaluateTrials(stats);
    const done = doneKps();
    return {
      success: true, username: 'guest', is_guest: true, profile: profile, stats: stats,
      power: powerBreakdown(profile, stats, equipment, trials.filter((t) => t.claimed).length),
      chapters: state.courses.map((chapter) => {
        const kps = chapter.knowledge_points || [];
        const bank = state.bank.filter((q) => q.chapter_id === chapter.id);
        const kpDone = kps.filter((kp) => done.has(chapter.id + '_' + kp.index)).length;
        return {
          id: chapter.id, title: chapter.title, icon: chapter.icon || '✦', stage: chapter.stage,
          highlight: Boolean(chapter.highlight), kp_total: kps.length, kp_done: kpDone,
          q_total: bank.length,
          q_solved: bank.filter((q) => (state.progress.attempts[q.id] || {}).solved).length,
          q_wrong: bank.filter((q) => {
            const r = state.progress.attempts[q.id] || {};
            return r.wrong && !r.solved;
          }).length,
          progress: kps.length ? Math.round(kpDone / kps.length * 100) : 0,
        };
      }),
      exams: [], log: [],
    };
  }

  function suggestQuestions() {
    const weak = overview().chapters
      .filter((c) => c.q_total > c.q_solved)
      .sort((a, b) => (b.q_wrong - a.q_wrong) || (a.progress - b.progress));
    const rows = [];
    weak.slice(0, 3).forEach((c) => {
      rows.push({ text: '我要练第 ' + c.id + ' 章《' + c.title + '》的题',
                  hint: '还剩 ' + (c.q_total - c.q_solved) + ' 道' });
    });
    rows.push({ text: '我该怎么安排学习？', hint: '打开逐日路线' });
    rows.push({ text: '我现在什么水平？', hint: '打开星空修为' });
    return rows.slice(0, 6);
  }

  function blackboard() {
    const done = doneKps();
    const weak = [];
    state.courses.forEach((chapter) => {
      const kps = chapter.knowledge_points || [];
      const pending = kps.filter((kp) => !done.has(chapter.id + '_' + kp.index));
      const wrong = state.bank.filter((q) => q.chapter_id === chapter.id &&
        (state.progress.attempts[q.id] || {}).wrong &&
        !(state.progress.attempts[q.id] || {}).solved);
      if (!pending.length && !wrong.length) return;
      weak.push({
        chapter_id: chapter.id, title: chapter.title, icon: chapter.icon || '✦',
        highlight: Boolean(chapter.highlight),
        pending_kps: pending.slice(0, 4).map((kp) => ({ index: kp.index, title: kp.title })),
        pending_count: pending.length, wrong_count: wrong.length,
        reason: wrong.length ? '有 ' + wrong.length + ' 道错题还没重做'
                             : '还有 ' + pending.length + ' 个知识点没完成',
      });
    });
    weak.sort((a, b) => (b.wrong_count - a.wrong_count) || (b.pending_count - a.pending_count));
    const profile = levelFromPoints(state.progress.points);
    return { success: true, level: profile.level, realm: profile.realm,
             points: profile.points, weak: weak.slice(0, 8), recommend: weak[0] || null };
  }

  /** 扫描并预加载正文里的教材截图。
   *
   * 为什么不能只靠 loading="lazy"：章节正文很长（两万多像素），
   * 懒加载在长页面上并不可靠 —— 实测无头浏览器里后半段的图
   * 永远不会被触发加载，页面上就是一块空白（看起来像排版留白，
   * 很容易被当成正常）。这里改成「自己算位置、进视口前 600px 就加载」，
   * 顺带把失效的图换成一句可读的说明，不让它静默留白。
   */
  function warmImages(root) {
    const scope = root || document;
    const images = [...scope.querySelectorAll('.lesson img[loading="lazy"]')];
    if (!images.length) return 0;
    let loaded = 0;
    const watch = () => {
      const limit = window.innerHeight + 600;
      images.forEach((img) => {
        if (img.dataset.warm) return;
        const rect = img.getBoundingClientRect();
        if (rect.top > limit) return;
        img.dataset.warm = '1';
        // 关键：只改 loading 属性不足以让浏览器真的去取图 ——
        // 长页面上懒加载的"待加载"状态可能已经被放弃。
        // 把 src 重新赋一次（先清空再写回）才会重新发起请求。
        const src = img.getAttribute('src');
        if (src) {
          img.loading = 'eager';
          img.removeAttribute('loading');
          img.src = '';
          img.src = src;
        }
        img.addEventListener('error', () => {
          // 加载失败时不留空白：给一句能读的说明
          const note = document.createElement('div');
          note.className = 'img-missing';
          note.textContent = '（这张图没能加载：' + (img.getAttribute('alt') || '教材截图') + '）';
          note.style.cssText = 'padding:10px 14px;margin:8px 0;border-left:2px solid #ff9db3;' +
            'background:rgba(255,157,179,.08);color:#ffd6e0;font-size:12.5px;border-radius:0 6px 6px 0;';
          img.replaceWith(note);
        }, { once: true });
        if (img.complete && img.naturalWidth > 0) loaded += 1;
      });
    };
    watch();
    // 滚动时继续补：一次算完在长页面上不够，用户还在往下翻
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { watch(); ticking = false; });
    }, { passive: true });
    return images.length;
  }

  return {
    init: init, state: state,
    // 数据
    courses: () => state.courses, bank: () => state.bank, registry: () => state.registry,
    // 修为
    snapshot: snapshot, levelFromPoints: levelFromPoints, artFor: artFor,
    instrumentFor: instrumentFor, coachFormFor: coachFormFor,
    deriveStats: deriveStats, evaluateEquipment: evaluateEquipment,
    evaluateTrials: evaluateTrials, claimTrials: claimTrials,
    // 路线
    buildRoadmap: buildRoadmap, kpMinutes: kpMinutes,
    // 题库
    catalog: catalog, filterQuestions: filterQuestions, questionBrief: questionBrief,
    fullQuestion: fullQuestion, submitAnswer: submitAnswer, completeKp: completeKp,
    completedKps: completedKps, overview: overview,
    suggestQuestions: suggestQuestions, blackboard: blackboard,
    // 图片
    warmImages: warmImages,
    // 进度
    progress: () => state.progress, saveProgress: saveProgress,
    resetProgress: resetProgress,
    TABLE: state.tables,
  };
})();
