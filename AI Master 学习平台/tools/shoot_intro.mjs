/**
 * tools/shoot_intro.mjs —— 截开场 CG 的各幕，核对文案与画面。
 *
 * 为什么需要它：片头的文案是脚本按幕改写的（标题/提示/按钮），
 * 静态看 HTML 只能看到初始那一条，改完 paintAct 必须逐幕实际渲染才看得出
 * 末幕是否真的换成了出口文案。深链 ?ch=N 是唯一的可靠入口 ——
 * 无头截图抓不到连续动画的中间帧。
 *
 * 用法：node tools/shoot_intro.mjs [base] [ch,ch,...]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'logs', 'shots', 'intro');
const PORT = 9419;
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

const base = (process.argv[2] || 'http://127.0.0.1:5178').replace(/\/$/, '');
const acts = (process.argv[3] || '0,5').split(',').map((x) => parseInt(x, 10));
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
      }, 30000);
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
}

async function connect(tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const t = list.find((x) => x.type === 'page');
      if (t) {
        const ws = new WebSocket(t.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener('open', res, { once: true });
          ws.addEventListener('error', rej, { once: true });
        });
        return new CDP(ws);
      }
    } catch { /* 浏览器还没起来 */ }
    await sleep(250);
  }
  throw new Error('连不上无头 Edge 的调试端口');
}

mkdirSync(OUT, { recursive: true });
const child = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(OUT, 'profile')}`,
  '--window-size=1440,900', '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

try {
  const cdp = await connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  for (const ch of acts) {
    await cdp.send('Page.navigate', { url: `${base}/intro?ch=${ch}` });
    await sleep(3200);   // 等 three.js 建场 + 首帧
    const info = await cdp.eval(`JSON.stringify({
      n: (document.querySelectorAll('#nav button') || []).length,
      cur: (document.querySelector('#nav button.on') || {}).textContent || '(无)',
      eyebrow: document.querySelector('#eyebrow').textContent,
      title: document.querySelector('#title').textContent.trim(),
      hint: document.querySelector('#hint').textContent,
      skip: document.querySelector('#skip').textContent.trim(),
      act: document.querySelector('#sig').textContent
    })`);
    const d = JSON.parse(info);
    console.log(`ch=${ch}  ${d.eyebrow} ｜ 当前分幕「${d.cur}」｜ 状态 ${d.act}`);
    console.log(`       标题：${d.title}`);
    console.log(`       提示：${d.hint}`);
    console.log(`       按钮：${d.skip}`);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = join(OUT, `act${ch}.png`);
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log(`       截图：${file}`);
  }
} catch (err) {
  console.log('脚本出错：', err.message);
  process.exitCode = 1;
} finally {
  child.kill();
}
