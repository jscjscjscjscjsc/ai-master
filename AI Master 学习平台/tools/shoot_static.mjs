/**
 * tools/shoot_static.mjs —— 给导出的静态站截图（发布前的视觉复核）。
 *
 * 静态站的页面是改写过的 HTML，必须眼见为实：链接改写、资源相对化、
 * 图片换成 WebP —— 任何一步出错都可能让页面样式全丢，而 HTTP 200
 * 看不出来。所以发布前要用真实浏览器把关键页截一遍。
 *
 * 用法：node tools/shoot_static.mjs http://127.0.0.1:5180
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'logs', 'static-shots');
const BASE = process.argv[2] || 'http://127.0.0.1:5180';
const PORT = 9381;
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGES = [
  ['index.html', '01-dashboard'],
  ['roadmap.html', '02-roadmap'],
  ['constellation.html', '03-constellation'],
  ['training.html', '04-training'],
  ['chapter-1.html', '05-chapter1'],
  ['chapter-3.html', '06-chapter3'],
  ['chapter-6.html', '07-chapter6'],
  ['warp.html?to=chapter-3.html&kicker=SECTOR%2003&hold=1', '08-warp'],
  ['stars.html', '09-atlas'],
  ['static/cg/transformer_cg.html?autoplay=1&controls=0', '10-cg-transformer'],
  ['static/cg/multi_agent_cg.html?autoplay=1&controls=0', '11-cg-multi'],
  ['static/cg/ai_odyssey.html', '12-odyssey'],
  ['static/lab/transformer_lab.html', '13-lab'],
];

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } }); }
  send(method, params = {}) { const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + method)); } }, 45000); }); }
}
async function connect(url, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    try { const list = await (await fetch(`${url}/json/list`)).json();
      const t = list.find((x) => x.type === 'page');
      if (t) { const ws = new WebSocket(t.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true });
          ws.addEventListener('error', rej, { once: true }); }); return new CDP(ws); } } catch (e) {}
    await sleep(400);
  }
  throw new Error('连不上调试端口');
}

mkdirSync(OUT, { recursive: true });
const child = spawn(EDGE, ['--headless=new', '--no-sandbox', '--hide-scrollbars',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'starlab_sstatic'),
  '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

try {
  const cdp = await connect(`http://127.0.0.1:${PORT}`);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
  const bad = [];
  cdp.ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Network.responseReceived') {
      const r = m.params.response;
      if (r.status >= 400 && !r.url.includes('favicon')) bad.push(r.status + ' ' + r.url.slice(0, 96));
    }
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  for (const [path, name] of PAGES) {
    bad.length = 0;
    await cdp.send('Page.navigate', { url: `${BASE}/${path}` });
    await sleep(5200);
    // 整页高度（长页面也能看全）
    const metrics = await cdp.send('Page.getLayoutMetrics');
    const height = Math.min(7000, Math.ceil(metrics.cssContentSize.height || 900));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height, deviceScaleFactor: 1, mobile: false });
    await sleep(700);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    const buf = Buffer.from(shot.data, 'base64');
    writeFileSync(join(OUT, `${name}.png`), buf);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    console.log('%s %s  %dKB%s', bad.length ? '✗' : '✓', name.padEnd(20), Math.round(buf.length / 1024),
      bad.length ? '  4xx/5xx: ' + [...new Set(bad)].slice(0, 2).join(' | ') : '');
  }
} finally { child.kill(); }
process.exit(0);
