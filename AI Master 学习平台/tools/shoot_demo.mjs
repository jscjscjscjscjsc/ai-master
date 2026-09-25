/**
 * tools/shoot_demo.mjs —— 用演示账号登录后截「学习档案」页。
 *
 * 为什么单独写一个：比赛演示时评委看到的是**演示账号**（reviewer）的档案，
 * 而命令行 --screenshot 是无状态请求、拿不到登录态；不登录看到的是游客视图
 * （图谱全灰、薄弱点为空），完全看不出这个功能的实际效果。
 *
 * 用法：node tools/shoot_demo.mjs [base] [账号] [口令]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'logs', 'shots', 'demo');
const PORT = 9416;
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

const base = (process.argv[2] || 'http://127.0.0.1:5178').replace(/\/$/, '');
const USER = process.argv[3] || process.env.STARLAB_DEMO_USER || 'reviewer';
const PASS = process.argv[4] || process.env.STARLAB_DEMO_PASSWORD || 'aimaster2026';
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
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); }
      }, 40000);
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

async function settle(cdp, ms) {
  let stable = 0;
  for (let i = 0; i < 70; i += 1) {
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
    stable = result.value === 'complete' ? stable + 1 : 0;
    if (stable >= 3) break;
    await sleep(220);
  }
  await sleep(ms);
}

async function shot(cdp, name, w, h) {
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await sleep(1600);
  const s = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const file = join(OUT, name + '.png');
  writeFileSync(file, Buffer.from(s.data, 'base64'));
  console.log('  ->', file);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const profile = join(process.env.TEMP || '/tmp', 'demo_cdp_' + Date.now());
  const child = spawn(EDGE, [
    '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--hide-scrollbars',
    '--no-first-run', '--disable-extensions', '--disable-features=Translate',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--window-size=1500,2200', 'about:blank',
  ], { stdio: 'ignore' });

  try {
    const cdp = await connect('http://127.0.0.1:' + PORT);
    await cdp.send('Page.enable');

    console.log('[1] 用演示账号登录：' + USER);
    await cdp.send('Page.navigate', { url: base + '/login' });
    await sleep(2000);
    const login = await cdp.send('Runtime.evaluate', {
      expression: `(async () => {
        const r = await fetch('/api/login', { method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ username: ${JSON.stringify(USER)}, password: ${JSON.stringify(PASS)} }) });
        return await r.json();
      })()`, awaitPromise: true, returnByValue: true,
    });
    console.log('    ', JSON.stringify(login.result.value));
    if (!login.result.value || !login.result.value.success) {
      throw new Error('演示账号登录失败：请确认 .env 里的 STARLAB_DEMO_USER / STARLAB_DEMO_PASSWORD');
    }

    console.log('[2] 学习档案（知识图谱 + 该补哪里）');
    await cdp.send('Page.navigate', { url: base + '/progress' });
    await settle(cdp, 3500);
    const probe = await cdp.send('Runtime.evaluate', {
      expression: `(() => ({
        weakRows: document.querySelectorAll('.pg-weak-row').length,
        nodes: document.querySelectorAll('.pg-graph-node').length,
        strong: document.querySelectorAll('.pg-graph-node.strong').length,
        developing: document.querySelectorAll('.pg-graph-node.developing').length,
        weak: document.querySelectorAll('.pg-graph-node.weak').length
      }))()`, returnByValue: true,
    });
    console.log('    探针:', JSON.stringify(probe.result.value));
    await shot(cdp, 'progress', 1500, 2300);
    await shot(cdp, 'progress-mobile', 414, 1400);

    console.log('[3] 指挥舱（首页）');
    await cdp.send('Page.navigate', { url: base + '/' });
    await settle(cdp, 3000);
    await shot(cdp, 'dashboard', 1500, 1400);

    console.log('\n完成。截图目录：' + OUT);
  } finally {
    child.kill();
  }
}

main().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
