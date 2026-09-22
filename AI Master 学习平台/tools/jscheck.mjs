/**
 * tools/jscheck.mjs —— 抓取页面运行时 JS 错误。
 *
 * 为什么需要它：CSS 正常、脚本 200、但页面某个模块完全不渲染，
 * 只有三种可能 —— 脚本抛异常、接口 404、或元素 id 对不上。
 * 这个工具把 console.error 与未捕获异常都打出来，一条命令定位。
 *
 * 用法：node tools/jscheck.mjs /coach /chapter/4
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));
const BASE = process.env.STARLAB_BASE || 'http://127.0.0.1:5178';
const PORT = 9343;
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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); } }, 30000);
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
    } catch (error) { /* 还没起来 */ }
    await sleep(400);
  }
  throw new Error('连不上调试端口');
}

async function main() {
  const paths = process.argv.slice(2);
  if (!EDGE || !paths.length) { console.error('用法: node tools/jscheck.mjs /path ...'); process.exit(1); }
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'starlab_jscheck'),
    '--window-size=1600,900', 'about:blank',
  ], { stdio: 'ignore' });

  try {
    const cdp = await connect(`http://127.0.0.1:${PORT}`);
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await cdp.send('Runtime.enable');

    const events = [];
    cdp.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
        events.push(`[console.${msg.params.type}] ` +
          (msg.params.args || []).map((a) => a.value || a.description || a.type).join(' ').slice(0, 300));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        events.push(`[未捕获异常] ${(d.exception && d.exception.description) || d.text}`.slice(0, 400));
      }
      if (msg.method === 'Network.loadingFailed') {
        events.push(`[加载失败] ${msg.params.errorText}`);
      }
    });

    const res = await fetch(BASE + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '验收同学', password: 'test123456' }),
    });
    const raw = res.headers.getSetCookie ? res.headers.getSetCookie()[0] : res.headers.get('set-cookie');
    if (raw) {
      const [name, ...rest] = raw.split(';')[0].split('=');
      await cdp.send('Network.setCookie', { name, value: rest.join('='), domain: '127.0.0.1', path: '/' });
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });

    let hasError = false;
    for (const path of paths) {
      events.length = 0;
      await cdp.send('Page.navigate', { url: BASE + path });
      await sleep(5000);
      const out = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: `(() => ({
          coach: typeof CoachPage, chapter: typeof Chapter, training: typeof Training,
          constellation: typeof Constellation, roadmap: typeof Roadmap,
          progress: typeof ProgressPage, agent: typeof AgentPage,
          qcards: typeof QCards, star: typeof Star, portrait: typeof Portrait,
          starCoach: typeof StarCoach,
          figSvg: Boolean(document.querySelector('#coach-figure svg')),
          figLen: (document.getElementById('coach-figure') || {}).innerHTML?.length || 0,
          promptCards: document.querySelectorAll('.prompt-card').length,
          threadKids: ((document.getElementById('coach-thread') || {}).children || []).length,
          threadTxt: ((document.getElementById('coach-thread') || {}).textContent || '').trim().slice(0, 60),
          shells: document.querySelectorAll('.coach-shell').length,
          tabs: document.querySelectorAll('.coach-tab').length,
          qslots: document.querySelectorAll('.q-slots').length,
          kpOpen: [...document.querySelectorAll('.kp-body')].filter((e) => !e.hidden).length,
        }))()`,
      });
      console.log('\n=== %s ===', path);
      console.log('  ' + JSON.stringify(out.result.value));
      if (events.length) {
        hasError = true;
        console.log('  运行时事件:');
        [...new Set(events)].slice(0, 8).forEach((line) => console.log('    ' + line));
      } else {
        console.log('  无错误');
      }
    }
    process.exit(hasError ? 0 : 0);
  } finally {
    child.kill();
  }
}

main();
