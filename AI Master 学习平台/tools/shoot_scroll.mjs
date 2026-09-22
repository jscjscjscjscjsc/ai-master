/**
 * tools/shoot_scroll.mjs —— 滚动分段截图。
 *
 * 为什么不能只截一张整页图：Chromium 的 captureBeyondViewport 在
 * 超高页面上会返回大段空白（合成器的纹理上限），看起来像"页面没渲染出来"。
 * 实测刷题页 12000px 高时，中段 6000px 在整页图里是纯背景，
 * 但滚动到那个位置单看是正常的。所以验收必须按视口逐段截，
 * 与人实际滚动看到的一致。
 *
 * 用法：node tools/shoot_scroll.mjs <path> <name> [段高] [最大段数]
 * 输出：logs/shots/<name>-1.png, <name>-2.png ...
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SHOTS = join(ROOT, 'logs', 'shots');
const BASE = process.env.STARLAB_BASE || 'http://127.0.0.1:5178';
const PORT = 9335;
const USER = '验收同学';
const PASS = 'test123456';
const WIDTH = 1600;
const SEG = 940;

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
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
      const list = await (await fetch(`${url}/json/list`)).json();
      const target = list.find((t) => t.type === 'page');
      if (target) {
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener('open', res, { once: true });
          ws.addEventListener('error', rej, { once: true });
        });
        return new CDP(ws);
      }
    } catch (error) { /* 没起来 */ }
    await sleep(400);
  }
  throw new Error('连不上调试端口');
}

async function main() {
  // Git Bash 会把 /chapter/4 这种参数改写成 C:/Program Files/Git/chapter/4，
  // 所以补一次归一化：剥掉被注入的前缀，只保留真正的路由部分。
  const raw = process.argv.slice(2);
  let [path, name, segArg, maxArg] = raw;
  if (path && !path.startsWith('http')) {
    let cleaned = path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '');
    const marker = cleaned.lastIndexOf('/Git/');
    if (marker >= 0) cleaned = cleaned.slice(marker + 4);
    path = cleaned.startsWith('/') ? cleaned : '/' + cleaned;
  }
  if (!path || !name) { console.error('用法: node tools/shoot_scroll.mjs <path> <name> [段高] [最大段数]'); process.exit(1); }
  const seg = Number(segArg) || SEG;
  const maxSegs = Number(maxArg) || 8;
  mkdirSync(SHOTS, { recursive: true });

  const profile = join(process.env.TEMP || '/tmp', 'starlab_scroll');
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    `--window-size=${WIDTH},${seg}`, 'about:blank',
  ], { stdio: 'ignore' });

  try {
    const cdp = await connect(`http://127.0.0.1:${PORT}`);
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    const res = await fetch(BASE + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER, password: PASS }),
    });
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie()[0] : res.headers.get('set-cookie');
    if (raw) {
      const [cookieName, ...rest] = raw.split(';')[0].split('=');
      await cdp.send('Network.setCookie', { name: cookieName, value: rest.join('='), domain: '127.0.0.1', path: '/' });
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: seg, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: BASE + path });
    await sleep(4200);

    const total = await cdp.send('Runtime.evaluate', {
      expression: 'document.documentElement.scrollHeight', returnByValue: true,
    }).then((r) => r.result.value);
    console.log('%s 总高 %dpx，按 %dpx 分段', path, total, seg);

    const count = Math.min(maxSegs, Math.ceil(total / seg));
    for (let i = 0; i < count; i += 1) {
      const offset = i * seg;
      await cdp.send('Runtime.evaluate', {
        expression: `window.scrollTo(0, ${offset}); void 0;`, returnByValue: true,
      });
      await sleep(620);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const out = join(SHOTS, `${name}-${i + 1}.png`);
      writeFileSync(out, Buffer.from(shot.data, 'base64'));
      console.log('  %s  y=%d  %d KB', `${name}-${i + 1}.png`, offset,
        Math.round(Buffer.from(shot.data, 'base64').length / 1024));
    }
  } finally {
    child.kill();
  }
}

main();
