/* ===========================================================
   在线演示站的 API 适配层
   -----------------------------------------------------------
   页面代码调用的是 /api/*（本地版由 Flask 提供）。在线站没有后端，
   这一层把每个请求接住，换成浏览器里能算出来的等价结果：

     能算的   → 交给 StarlabStatic（它用与 Python 侧同一批表与规则）
     算不出的 → 返回一句人话，说清"这个功能要什么"

   为什么不能只是"屏蔽"：直接让请求 404，页面会停在"加载中"，
   看起来像平台坏了。而学生看到"AI 评分需要大模型，下载本地版即可"
   是能理解的 —— 这不是缺陷，是在线演示的边界。

   只由 build_static_site.py 导出的页面加载本文件；本地部署不加载，
   平台行为完全不变。
   =========================================================== */

(function () {
  'use strict';

  var STATIC = window.StarlabStatic;
  if (!STATIC) {
    console.error('starlab_static.js 未加载，在线演示站无法初始化');
    return;
  }

  // 需要大模型或后端才能做的事：给出具体原因，而不是笼统的失败
  var NEEDS_MODEL = [
    ['/api/ask-star-stream', 'AI 答疑需要大模型'],
    ['/api/training/ai-help', 'AI 讲思路需要大模型'],
    ['/api/score-answer', 'AI 评分需要大模型'],
    ['/api/score-code', 'AI 评分需要大模型'],
    ['/api/agent/ask', '全局智能体需要大模型'],
    ['/api/agent/suggest', '智能体需要大模型'],
    ['/api/agent/blackboard', '智能体需要大模型'],
    ['/api/coach/chat', '星辰教练需要大模型'],
    ['/api/coach/sessions', '星辰教练的会话记录需要后端'],
    ['/api/coach/forms', '教练法相需要后端'],
    ['/api/interview/start', '模拟面试需要大模型'],
    ['/api/interview/answer', '模拟面试需要大模型'],
    ['/api/tts/speak', '服务端语音需要后端'],
    ['/api/chapter-revelation', '章节启示需要大模型'],
    ['/api/setup', '模型密钥只存在你自己电脑上'],
  ];

  var HINT_TAIL = '在线演示站不接大模型；下载本地版并填入自己的模型密钥即可使用。';

  function json(payload, status) {
    return new Response(JSON.stringify(payload), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  function notAvailable(reason) {
    return json({ success: false, available: false, message: reason + '。' + HINT_TAIL });
  }

  function wantsNumber(value) {
    var n = parseFloat(String(value));
    return Number.isFinite(n) ? n : 0;
  }

  /** 把 snapshot 的结果转成 /api/cultivation/profile 的形状（悬浮等级条要它）。 */
  function profilePayload() {
    var snap = STATIC.snapshot();
    var profile = Object.assign({}, snap.profile);
    var equipment = snap.equipment;
    profile.power = snap.power.total;
    profile.art = snap.art;
    profile.instrument = STATIC.instrumentFor(profile.level);
    profile.skill = profile.instrument;
    profile.equipment_unlocked = equipment.filter(function (e) { return e.unlocked; }).length;
    profile.equipment_total = equipment.length;
    profile.trial = snap.trials.filter(function (t) { return t.realm === profile.realm; })[0] || null;
    profile.levels = snap.levels.filter(function (row) { return row.level % 3 === 1; });
    profile.is_guest = true;
    profile.solved = snap.stats.total_solved;
    profile.attempted = snap.stats.attempted;
    return { success: true, profile: profile };
  }

  function userPayload() {
    return {
      success: true, username: 'guest', is_guest: true,
      points: STATIC.progress().points,
      completed_kps: STATIC.completedKps(),
      daily_minutes: STATIC.progress().daily_minutes || 60,
    };
  }

  // ── 路由表：路径 → 本地实现 ────────────────────────────
  function handle(path, url, init) {
    // 修为
    if (path === '/api/cultivation/profile') return profilePayload();
    if (path === '/api/game/state') {
      var snap = STATIC.snapshot();
      snap.granted_trials = STATIC.claimTrials();
      return snap;
    }
    if (path === '/api/user') return userPayload();
    if (path === '/api/progress/overview') return STATIC.overview();
    if (path === '/api/learning-status') {
      return { success: true, completed_kps: STATIC.completedKps(),
               username: 'guest', is_guest: true };
    }
    if (path === '/api/ai-status') {
      return { success: true, ok: false, message: '在线演示站不接大模型', model: '（未配置）' };
    }
    if (path === '/api/quote') {
      var art = STATIC.artFor(STATIC.progress().points);
      return { success: true, realm: art.realm, next: '', whisper: art.whisper };
    }
    if (path === '/api/glossary') {
      var terms = [];
      STATIC.courses().forEach(function (chapter) {
        (chapter.knowledge_points || []).forEach(function (kp) {
          terms.push({ term: kp.title, chapter_id: chapter.id, chapter: chapter.title,
                       icon: chapter.icon || '✦',
                       url: 'chapter-' + chapter.id + '.html#kp-' + (kp.index + 1) });
        });
      });
      return { success: true, terms: terms };
    }

    // 知识星海：直接读导出的 JSON
    if (path === '/api/knowledge-universe') {
      return fetch('data/knowledge-universe.json').then(function (r) { return r.json(); });
    }

    // 路线
    if (path === '/api/roadmap') {
      return STATIC.buildRoadmap(url.searchParams.get('daily'));
    }
    if (path === '/api/roadmap/daily') {
      var body = init && init.body ? JSON.parse(init.body) : {};
      var minutes = Math.max(30, Math.min(300, wantsNumber(body.daily_minutes) || 60));
      STATIC.progress().daily_minutes = minutes;
      STATIC.saveProgress();
      return STATIC.buildRoadmap(minutes);
    }

    // 题库
    if (path === '/api/training/catalog') {
      return { success: true, chapters: STATIC.catalog(), total: STATIC.bank().length };
    }
    if (path === '/api/training/questions') {
      var chapters = (url.searchParams.get('chapters') || '')
        .split(/[,，\s]+/).filter(Boolean);
      var rows = STATIC.filterQuestions({
        chapters: chapters,
        type: url.searchParams.get('type') || null,
        difficulty: url.searchParams.get('difficulty') || null,
        only: url.searchParams.get('only') || null,
      });
      var limit = Math.min(300, wantsNumber(url.searchParams.get('limit')) || 200);
      return { success: true, count: Math.min(rows.length, limit),
               questions: rows.slice(0, limit).map(STATIC.questionBrief) };
    }
    if (path.indexOf('/api/training/question/') === 0) {
      var qid = decodeURIComponent(path.slice('/api/training/question/'.length));
      var full = STATIC.fullQuestion(qid);
      if (!full) return json({ success: false, message: '题目不存在' }, 404);
      return { success: true, question: full };
    }
    if (path === '/api/training/submit') {
      var payload = init && init.body ? JSON.parse(init.body) : {};
      return STATIC.submitAnswer(payload.question_id, payload.answer,
                                 payload.score, payload.feedback);
    }
    if (path === '/api/complete-kp') {
      var kpBody = init && init.body ? JSON.parse(init.body) : {};
      return STATIC.completeKp(kpBody.chapter_id, kpBody.kp_index);
    }
    if (path === '/api/training/attempt' || path === '/api/training/draft') {
      // 在线站不做保存草稿与跳过记录：两者都只影响本地存档
      return { success: true, guest: true, saved_at: '' };
    }
    if (path === '/api/training/exam' || path.indexOf('/api/training/exam/') === 0) {
      return notAvailable('组卷与试卷讲评需要后端保存试卷');
    }
    if (path === '/api/register' || path === '/api/login') {
      return notAvailable('账号体系需要后端数据库');
    }
    return null;
  }

  // ── 拦截 fetch ─────────────────────────────────────────
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    var raw = typeof input === 'string' ? input : (input && input.url) || '';
    var url;
    try { url = new URL(raw, window.location.href); } catch (error) { url = null; }
    var path = url ? url.pathname : raw;

    // 只接管 /api/*，其余（数据文件、图片、CG）原样放行
    if (path.indexOf('/api/') !== 0) {
      return realFetch ? realFetch(input, init) : Promise.reject(new Error('no fetch'));
    }

    // 需要大模型的：先给出明确说明
    for (var i = 0; i < NEEDS_MODEL.length; i += 1) {
      if (path.indexOf(NEEDS_MODEL[i][0]) === 0) {
        return Promise.resolve(notAvailable(NEEDS_MODEL[i][1]));
      }
    }

    // 必须先等数据就绪：页面脚本的 fetch 可能比 StarlabStatic.init() 更早发出，
    // 那时 courses/题库还是空的 —— 会算出"没有题目"这种假结果。
    return STATIC.init().then(function () {
      var result;
      try {
        result = handle(path, url, init);
      } catch (error) {
        console.error('[static] 处理 ' + path + ' 失败', error);
        return json({ success: false, message: '在线演示站处理这个请求时出错' });
      }
      if (result === null || result === undefined) {
        return json({ success: false, message: '在线演示站没有这个接口' });
      }
      if (result instanceof Response) return result;
      if (result && typeof result.then === 'function') {
        return result.then(function (value) {
          return value instanceof Response ? value : json(value);
        });
      }
      return json(result);
    });
  };

  // ── 兜底：把还指向后端路由的链接拦下来 ─────────────────
  // 导出时已经改写过，但页面里可能有脚本动态拼出来的地址。
  var PAGE_MAP = {
    '/': 'index.html', '/roadmap': 'roadmap.html', '/agent': 'agent.html',
    '/training': 'training.html', '/coach': 'coach.html',
    '/constellation': 'constellation.html', '/stars': 'stars.html',
    '/progress': 'progress.html', '/login': 'login.html',
  };
  document.addEventListener('click', function (event) {
    var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!link) return;
    var href = link.getAttribute('href') || '';
    if (href.charAt(0) !== '/' || href.indexOf('//') === 0) return;
    var clean = href.split('?')[0].split('#')[0];
    var suffix = href.slice(clean.length);
    if (PAGE_MAP[clean]) {
      event.preventDefault();
      window.location.href = PAGE_MAP[clean] + suffix;
      return;
    }
    var chapter = clean.match(/^\/chapter\/(\d+)$/);
    if (chapter) {
      event.preventDefault();
      window.location.href = 'chapter-' + chapter[1] + '.html' + suffix;
      return;
    }
    if (clean === '/transition') {
      event.preventDefault();
      window.location.href = 'warp.html' + suffix;
    }
  }, true);

  // ── 「清空本机进度」 ───────────────────────────────────
  // 静态站没有账号，进度在 localStorage 里。所以「退出」换成清空进度，
  // 但它必须二次确认 —— 一点就把修为清零，是很重的操作。
  document.addEventListener('click', function (event) {
    var target = event.target && event.target.closest
      ? event.target.closest('[data-reset-progress]') : null;
    if (!target) return;
    event.preventDefault();
    if (!window.confirm('清空本机的学习进度（修为、作答记录）？此操作不可撤销。\n\n在线演示站的进度只存在这个浏览器里。')) return;
    STATIC.resetProgress();
    window.location.reload();
  }, true);

  // ── 顶部说明条：说清在线站能做什么 ─────────────────────
  function banner() {
    if (sessionStorage.getItem('starlab-static-banner') === 'off') return;
    if (document.getElementById('starlab-static-banner')) return;
    var bar = document.createElement('div');
    bar.id = 'starlab-static-banner';
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99998;display:flex;' +
      'gap:14px;align-items:center;justify-content:center;flex-wrap:wrap;' +
      'padding:10px 46px 10px 18px;background:linear-gradient(90deg,#0b1220f2,#0e1a2af2);' +
      'border-top:1px solid #72f6e455;color:#d6e6ff;font-size:13.5px;line-height:1.6;' +
      'font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;backdrop-filter:blur(8px);';
    bar.innerHTML = '<span>🧪 <b>在线演示站</b>：课程正文、教材截图、' +
      '<b>CG / 实验室 / 3D 星海</b>、<b>刷题与选择题判分</b>、' +
      '<b>逐日路线</b>、<b>星空修为</b>都可正常使用（进度存在你自己的浏览器里）；' +
      '<b>AI 答疑 / 评分 / 语音 / 模拟面试</b>需下载本地版</span>' +
      '<button style="background:#72f6e422;border:1px solid #72f6e455;color:#a8f3ea;' +
      'border-radius:8px;padding:5px 13px;cursor:pointer;font-size:13px;">知道了</button>';
    bar.querySelector('button').onclick = function () {
      sessionStorage.setItem('starlab-static-banner', 'off');
      bar.remove();
      document.body.style.paddingBottom = '';
    };
    document.body.appendChild(bar);
    // 提示条是固定的，会压住页面底部的内容（比如跃迁页的按钮）。
    // 给 body 补同高的下边距，让内容真的能滚到提示条上方 ——
    // 只调整某个页面的按钮位置是治标，这里一次解决所有页面。
    var h = bar.offsetHeight || 46;
    document.body.style.paddingBottom = (h + 12) + 'px';
  }

  // ── 启动 ───────────────────────────────────────────────
  function boot() {
    STATIC.init().then(function () {
      window.STARLAB_STATIC_READY = true;
      document.dispatchEvent(new CustomEvent('starlab-static-ready'));
      banner();
      // 正文里的教材截图：长页面上懒加载不可靠，自己接管
      try { STATIC.warmImages(); } catch (error) { console.warn('图片预加载失败', error); }
    }).catch(function (error) {
      console.error('[static] 初始化失败', error);
      var box = document.createElement('div');
      box.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);' +
        'background:#1a1020;border:1px solid #ff9db355;color:#ffd6e0;padding:20px 26px;' +
        'border-radius:12px;z-index:99999;max-width:80vw;font-size:14px;line-height:1.7;';
      box.innerHTML = '在线演示站的数据文件没能加载。<br>如果你是直接双击打开的 HTML，' +
        '请改用本地服务器访问（见仓库说明）。<br><small style="color:#8b949e">' +
        String(error && error.message || error) + '</small>';
      document.body.appendChild(box);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
