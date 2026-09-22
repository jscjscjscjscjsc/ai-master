/**
 * tools/verify_static_site.mjs —— 在线演示站的功能验收。
 *
 * 为什么不能只看 HTTP 200：静态站最容易犯的错是"页面打开正常、
 * 但功能全部哑掉"—— 修为算出来是 0、题库列表空的、路线排不出天数。
 * 这些在截图里都和"正常的空状态"长得一样。
 *
 * 所以这里逐个调用静态站自己的接口（它由 static_mode_bridge.js 在浏览器里接住），
 * 拿真实返回值做断言：等级表算得对不对、题库能不能筛、判分与加分是否生效、
 * 以及 localStorage 存档是否真的落盘。
 *
 * 用法：node tools/verify_static_site.mjs [http://127.0.0.1:5180]
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:5180';
const PORT = 9375;
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + method)); } }, 40000);
    });
  }
}

async function connect(url, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const list = await (await fetch(`${url}/json/list`)).json();
      const t = list.find((x) => x.type === 'page');
      if (t) {
        const ws = new WebSocket(t.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener('open', res, { once: true });
          ws.addEventListener('error', rej, { once: true });
        });
        return new CDP(ws);
      }
    } catch (e) { /* 还没起来 */ }
    await sleep(400);
  }
  throw new Error('连不上调试端口');
}

let pass = 0; let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass += 1; console.log('  ✓ %s%s', label, detail ? '  ' + detail : ''); }
  else { fail += 1; console.log('  ✗ %s%s', label, detail ? '  ' + detail : ''); }
}

async function main() {
  if (!EDGE) { console.error('找不到 Edge'); process.exit(1); }
  const child = spawn(EDGE, ['--headless=new', '--no-sandbox',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'starlab_vstatic'),
    '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

  try {
    const cdp = await connect(`http://127.0.0.1:${PORT}`);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    const errors = [];
    cdp.ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        errors.push(((d.exception && d.exception.description) || d.text).slice(0, 200));
      }
      if (m.method === 'Network.loadingFailed') {
        errors.push('加载失败 ' + m.params.errorText);
      }
    });

    // ── 1. 入口页 ────────────────────────────────────────
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: BASE + '/index.html' });
    await sleep(3000);
    // 每次验收都从干净存档开始：否则上一次的作答会让"加分"这类断言
    // 因为重复通关（衰减到 0）而假失败。
    await cdp.send('Runtime.evaluate', { returnByValue: true, expression:
      "try{localStorage.removeItem('starlab_static_v1')}catch(e){}" });
    await cdp.send('Page.reload');
    await sleep(4500);
    let r = await cdp.send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `
      (async () => {
        const res = await fetch('/api/training/catalog');
        const catalog = await res.json();
        const snap = await (await fetch('/api/game/state')).json();
        const roadmap = await (await fetch('/api/roadmap?daily=60')).json();
        const bank = await (await fetch('/api/training/questions?limit=300')).json();
        return {
          ready: Boolean(window.STARLAB_STATIC_READY),
          hasEngine: typeof StarlabStatic,
          catalogTotal: (catalog.chapters || []).reduce((s, c) => s + c.count, 0),
          chapters: (catalog.chapters || []).length,
          level: snap.profile && snap.profile.name,
          levels: (snap.levels || []).length,
          equipment: (snap.equipment || []).length,
          trials: (snap.trials || []).length,
          days: roadmap.summary && roadmap.summary.total_days,
          hours: roadmap.summary && roadmap.summary.total_hours,
          questions: bank.count,
        };
      })()` });

    console.log('\n=== 静态站功能验收 ===\n');
    const v = r.result.value || {};
    check('引擎已初始化', v.ready === true && v.hasEngine === 'object');
    check('题库可读', v.catalogTotal > 200 && v.questions > 200, `共 ${v.catalogTotal} 题 / 列表 ${v.questions}`);
    check('课程表可读', v.chapters === 9, `${v.chapters} 章`);
    // 不能断言具体境界名：这个浏览器 profile 可能带着上一次测试的存档，
    // 修为会累积。只断言「等级表完整且能算出境界」——这才是要验的东西。
    check('修为可推导', Boolean(v.level) && v.level !== 'undefined' && v.levels === 34,
      `境界 ${v.level} / ${v.levels} 级`);
    check('星器与试炼表在', v.equipment === 12 && v.trials === 11,
      `星器 ${v.equipment} / 试炼 ${v.trials}`);
    check('逐日路线可排', v.days > 10 && v.hours > 10, `${v.days} 天 / ${v.hours} 小时`);

    // ── 2. 判分与加分（选择题本地判） ─────────────────────
    const quiz = await cdp.send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `
      (async () => {
        const list = await (await fetch('/api/training/questions?type=choice&limit=5')).json();
        const id = list.questions[0].id;
        const full = (await (await fetch('/api/training/question/' + id)).json()).question;
        // 先故意答错
        const wrongIdx = (full.answer + 1) % 4;
        const bad = await (await fetch('/api/training/submit', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ question_id: id, answer: wrongIdx })
        })).json();
        // 再答对
        const good = await (await fetch('/api/training/submit', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ question_id: id, answer: full.answer })
        })).json();
        const after = await (await fetch('/api/game/state')).json();
        return {
          badPassed: bad.verdict && bad.verdict.passed,
          badHasFeedback: Boolean(bad.feedback && bad.feedback.length > 5),
          goodPassed: good.verdict && good.verdict.passed,
          goodPoints: good.settle && good.settle.points,
          points: after.profile.points,
          solved: after.stats.total_solved,
        };
      })()` });
    const q = quiz.result.value || {};
    check('答错判错并给解析', q.badPassed === false && q.badHasFeedback === true);
    check('答对判对并加分', q.goodPassed === true && q.goodPoints > 0, `+${q.goodPoints} 修为`);
    check('加分写入存档', q.points > 0 && q.solved === 1, `修为 ${q.points} / 通关 ${q.solved}`);

    // ── 3. 存档持久化 ────────────────────────────────────
    const persist = await cdp.send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `
      (async () => {
        const before = (await (await fetch('/api/cultivation/profile')).json()).profile.points;
        return { before, stored: Boolean(localStorage.getItem('starlab_static_v1')) };
      })()` });
    check('进度写入 localStorage', persist.result.value.stored === true);

    // ── 4. AI 功能给出明确提示（而不是静默失败） ──────────
    const ai = await cdp.send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `
      (async () => {
        const ask = await (await fetch('/api/agent/ask', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({question:'test'}) })).json();
        const score = await (await fetch('/api/score-answer', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({question:'q', answer:'a', reference:'r'}) })).json();
        return { askMsg: ask.message || '', scoreMsg: score.message || '' };
      })()` });
    const a = ai.result.value || {};
    check('AI 答疑说明原因', /大模型|本地版/.test(a.askMsg), a.askMsg.slice(0, 30));
    check('AI 评分说明原因', /大模型|本地版/.test(a.scoreMsg), a.scoreMsg.slice(0, 30));

    // ── 5. 页面可达性 ────────────────────────────────────
    console.log('');
    const pages = ['index.html', 'roadmap.html', 'constellation.html', 'training.html',
      'chapter-1.html', 'chapter-6.html', 'warp.html', 'stars.html'];
    for (const page of pages) {
      await cdp.send('Page.navigate', { url: BASE + '/' + page });
      await sleep(3600);
      const info = await cdp.send('Runtime.evaluate', { returnByValue: true, expression: `
        (() => ({
          title: document.title.slice(0, 26),
          len: document.body.innerText.replace(/\\s+/g,'').length,
          canvas: document.querySelectorAll('canvas').length,
        }))()` });
      const iv = info.result.value || {};
      check(page, (iv.len || 0) > 120, `「${iv.title}」${iv.len} 字` + (iv.canvas ? ` · ${iv.canvas} canvas` : ''));
    }

    console.log('\n=== 结果：%d 通过 / %d 失败 ===', pass, fail);
    if (errors.length) {
      console.log('页面错误：');
      [...new Set(errors)].slice(0, 8).forEach((e) => console.log('  ' + e));
    }
    process.exit(fail ? 1 : 0);
  } finally {
    child.kill();
  }
}

main();
