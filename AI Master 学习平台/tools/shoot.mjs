/**
 * tools/shoot.mjs —— 用 CDP 协议驱动 Edge/Chromium 做整页截图。
 *
 * 为什么不直接用 `msedge --screenshot`：那个模式有两个硬伤，
 * 正好会毁掉视觉验收的结论：
 *   1. 只截**首屏视口**，长页面中段的内容根本不在图里，看起来像"页面是空的"；
 *   2. 截图时机在 load 事件，异步渲染（智能体状态、路线图、进度档案）
 *      还没回来，图里就是空白。
 * 所以这里连 DevTools 协议，等网络空闲 + 额外静置时间，再用
 * captureBeyondViewport 抓完整页面高度。
 *
 * 用法：node tools/shoot.mjs [路径...]
 * 依赖：Node 22+（自带全局 WebSocket 与 fetch）
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SHOTS = join(ROOT, 'logs', 'shots');
const BASE = process.env.STARLAB_BASE || 'http://127.0.0.1:5178';
const PORT = 9333;
const USER = '验收同学';
const PASS = 'test123456';

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

const PAGES = [
  ['/', '01-dashboard'],
  ['/roadmap', '02-roadmap'],
  ['/agent', '03-agent'],
  ['/training', '04-training'],
  ['/coach', '05-coach'],
  ['/constellation', '06-constellation'],
  ['/stars', '07-stars'],
  ['/chapter/4', '08-chapter4'],
  ['/chapter/7', '08b-chapter7'],
  ['/progress', '09-progress'],
  ['/login', '10-login'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 极简 CDP 客户端：send(method, params) 返回 promise */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
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
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 40000);
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
        await new Promise((resolve, reject) => {
          ws.addEventListener('open', resolve, { once: true });
          ws.addEventListener('error', reject, { once: true });
        });
        return new CDP(ws);
      }
    } catch (error) { /* 浏览器还没起来 */ }
    await sleep(400);
  }
  throw new Error('连不上浏览器调试端口');
}

/** 登录一次拿到会话 Cookie，后续截图都带登录态 —— 否则进度类页面全是空数据 */
async function loginCookie() {
  for (const path of ['/api/login', '/api/register']) {
    const response = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER, password: PASS }),
    });
    const cookie = response.headers.getSetCookie
      ? response.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
      : (response.headers.get('set-cookie') || '').split(';')[0];
    const data = await response.json().catch(() => ({}));
    if (data.success && cookie) return cookie;
  }
  return '';
}

async function main() {
  const targets = process.argv.slice(2);
  if (!EDGE) { console.error('找不到 Edge'); process.exit(1); }
  mkdirSync(SHOTS, { recursive: true });

  const profile = join(process.env.TEMP || '/tmp', 'starlab_cdp');
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--disable-extensions', '--no-first-run', '--disable-features=Translate',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--window-size=1600,1000', 'about:blank',
  ], { stdio: 'ignore', detached: false });

  let failed = 0;
  try {
    const cdp = await connect(`http://127.0.0.1:${PORT}`);
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');

    const cookie = await loginCookie();
    if (cookie) {
      const [name, ...rest] = cookie.split('=');
      await cdp.send('Network.setCookie', {
        name, value: rest.join('='), domain: '127.0.0.1', path: '/',
      });
      console.log('已带登录态截图（%s）', USER);
    } else {
      console.log('未取得登录态，将以游客身份截图');
    }

    const rows = PAGES.filter(([url]) => !targets.length || targets.includes(url));
    for (const [url, name] of rows) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false,
      });
      await cdp.send('Page.navigate', { url: BASE + url });
      // 等网络静默：连续 3 次采样都没有新的请求说明异步渲染跑完了
      let quiet = 0;
      for (let i = 0; i < 40 && quiet < 3; i += 1) {
        await sleep(350);
        const { result } = await cdp.send('Runtime.evaluate', {
          expression: 'document.readyState',
          returnByValue: true,
        }).then((r) => ({ result: r }));
        quiet = result && result.value === 'complete' ? quiet + 1 : 0;
      }
      await sleep(1600); // 给入场动画留出时间

      const metrics = await cdp.send('Page.getLayoutMetrics');
      const height = Math.min(9000, Math.ceil(metrics.cssContentSize?.height || 1000));
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1600, height, deviceScaleFactor: 1, mobile: false,
      });
      await sleep(700);
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: true, optimizeForSpeed: false,
      });
      const out = join(SHOTS, `${name}.png`);
      writeFileSync(out, Buffer.from(shot.data, 'base64'));
      console.log('%-18s %-14s %dpx 高  %s KB', name, url, height,
        Math.round(Buffer.from(shot.data, 'base64').length / 1024));
    }
  } catch (error) {
    console.error('截图失败：', error.message);
    failed = 1;
  } finally {
    child.kill();
  }
  process.exit(failed);
}

main();
