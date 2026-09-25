/**
 * tools/shoot_progress.mjs —— 带登录态截「学习档案」页，验证知识图谱与"该补哪里"面板。
 *
 * 为什么不能直接用 --screenshot：那是一次性无状态请求，拿不到登录态，
 * 进度页会退化成游客视图（所有数据为 0），看不出真实渲染。
 * 所以这里先登录、造学习痕迹，再截图。
 *
 * 用法：node tools/shoot_progress.mjs [base]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'logs', 'shots', 'progress');
const PORT = 9414;
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

const base = (process.argv[2] || 'http://127.0.0.1:5178').replace(/\/$/, '');
const USER = `验收${String(Date.now()).slice(-5)}`;
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
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); } }, 40000);
    });
  }
}

async function connect(url, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const list = await (await fetch(url + '/json/list')).json();
      const t = list.find((x) => x.type === 'page');
      if (t) {
        const ws = new WebSocket(t.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener('open', res, { once: true });
          ws.addEventListener('error', rej, { once: true });
        });
        return new CDP(ws);
      }
    } catch (e) { /* 未就绪 */ }
    await sleep(400);
  }
  throw new Error('连不上调试端口');
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const profile = join(process.env.TEMP || '/tmp', 'progress_cdp');
  const child = spawn(EDGE, [
    '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--hide-scrollbars',
    '--no-first-run', '--disable-extensions', '--disable-features=Translate',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--window-size=1500,2000', 'about:blank',
  ], { stdio: 'ignore' });

  try {
    const cdp = await connect('http://127.0.0.1:' + PORT);
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride',
      { width: 1500, height: 2000, deviceScaleFactor: 1, mobile: false });

    console.log('[1] 注册并造学习痕迹');
    await cdp.send('Page.navigate', { url: base + '/login' });
    await sleep(1800);
    const prep = await cdp.send('Runtime.evaluate', {
      expression: `(async () => {
        const post = (u, b) => fetch(u, { method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify(b||{}) }).then(r => r.json().catch(() => ({})));
        await post('/api/register', { username: ${JSON.stringify(USER)}, password: 'shot123456' });
        await post('/api/setup/skip', {});
        // 完成三个知识点 → 产生 lesson 证据
        for (const [c, k] of [[1,0],[1,1],[1,2]]) await post('/api/complete-kp', { chapter_id:c, kp_index:k });
        // 做几道题（交空代码，故意不通过 → 制造"没吃透"）
        for (const qid of ['ch01-01','ch01-02','ch01-03','ch01-04']) {
          await post('/api/training/submit', { question_id: qid, cells: ['print(1)'], chapter_id: 1, kp_index: 0 });
        }
        const g = await fetch('/api/learning-graph').then(r => r.json());
        return { user: ${JSON.stringify(USER)}, nodes: (g.nodes||[]).length, weak: (g.weak_spots||[]).length };
      })()`, awaitPromise: true, returnByValue: true,
    });
    console.log('    ', JSON.stringify(prep.result.value));

    console.log('[2] 打开学习档案页');
    await cdp.send('Page.navigate', { url: base + '/progress' });
    let stable = 0;
    for (let i = 0; i < 70; i += 1) {
      const { result } = await cdp.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      stable = result.value === 'complete' ? stable + 1 : 0;
      if (stable >= 3) break;
      await sleep(220);
    }
    await sleep(3500);

    const probe = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const weak = document.getElementById('pg-weak-section');
        const rows = document.querySelectorAll('.pg-weak-row');
        const nodes = document.querySelectorAll('.pg-graph-node');
        const strong = document.querySelectorAll('.pg-graph-node.strong').length;
        const weakN = document.querySelectorAll('.pg-graph-node.weak').length;
        return { weakHidden: weak ? weak.hidden : null, weakRows: rows.length,
                 graphNodes: nodes.length, strong, weak: weakN };
      })()`, returnByValue: true,
    });
    console.log('    页面探针:', JSON.stringify(probe.result.value));

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(join(OUT, 'progress-auth.png'), Buffer.from(shot.data, 'base64'));
    console.log('  ->', join(OUT, 'progress-auth.png'));

    // 只看"该补哪里"面板那一段
    const clip = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const el = document.getElementById('pg-weak-section');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.max(0, r.x), y: Math.max(0, r.y + window.scrollY),
                 width: Math.min(1500, r.width), height: r.height };
      })()`, returnByValue: true,
    });
    if (clip.result.value) {
      const c = clip.result.value;
      const one = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: c.x, y: c.y, width: c.width, height: Math.min(700, c.height), scale: 1.4 },
      });
      writeFileSync(join(OUT, 'weak-spots.png'), Buffer.from(one.data, 'base64'));
      console.log('  ->', join(OUT, 'weak-spots.png'));
    }
  } finally {
    child.kill();
  }
}

main().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
