/**
 * tools/check_static_images.mjs —— 静态站的图片是否真的显示出来。
 *
 * 为什么需要它：教材截图在导出时被换成 WebP（24MB→5MB）。
 * 如果路径改写或格式转换有一步出错，页面会出现碎图 ——
 * 而碎图在整页截图里看起来就是"一块空白"，很容易被当成排版留白。
 * 所以这里直接读浏览器里的真实渲染结果：naturalWidth > 0 才算显示成功。
 *
 * 用法：node tools/check_static_images.mjs http://127.0.0.1:5180
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:5180';
const PORT = 9383;
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
              'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.p = new Map();
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data);
      if (m.id && this.p.has(m.id)) { const { resolve, reject } = this.p.get(m.id);
        this.p.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } }); }
  send(method, params = {}) { const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => { this.p.set(id, { resolve: res, reject: rej });
      setTimeout(() => { if (this.p.has(id)) { this.p.delete(id); rej(new Error('timeout ' + method)); } }, 40000); }); }
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
  throw new Error('x');
}

const child = spawn(EDGE, ['--headless=new', '--no-sandbox',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'starlab_simg'),
  `--remote-debugging-port=${PORT}`, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

try {
  const cdp = await connect(`http://127.0.0.1:${PORT}`);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  let total = 0; let broken = 0;
  for (let chapter = 1; chapter <= 9; chapter += 1) {
    await cdp.send('Page.navigate', { url: `${BASE}/chapter-${chapter}.html` });
    await sleep(4800);
    const r = await cdp.send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `
      (async () => {
        // 截图是 loading="lazy" 的，必须**逐张滚进视口**才会加载。
        // 直接跳到页底再回来是不够的 —— 中间那些图根本没进入过视口，
        // naturalWidth 一直是 0，会被误判成坏图（我上一版就误判了 34 张）。
        const imgs = [...document.querySelectorAll('.lesson img')];
        // 逐张滚动并**等它自己就绪**（complete && naturalWidth>0），最多等 1.6 秒。
        // 固定 sleep 不够：教材截图有 6000px 高的，解码比小图慢得多，
        // 用固定值会把"还在解码"误判成"坏图"（这个误判我犯过两次）。
        for (const img of imgs) {
          img.scrollIntoView({ block: 'center' });
          const deadline = Date.now() + 1600;
          while (Date.now() < deadline) {
            if (img.complete && img.naturalWidth > 0) break;
            if (img.complete && img.naturalWidth === 0 && img.dataset.warm === '1') {
              // 已尝试加载但仍失败：可能是真的坏了，多给一次机会
            }
            await new Promise(res => setTimeout(res, 120));
          }
        }
        await new Promise(res => setTimeout(res, 900));
        return {
          count: imgs.length,
          shown: imgs.filter(i => i.naturalWidth > 0).length,
          bad: imgs.filter(i => i.naturalWidth === 0)
                   .map(i => (i.getAttribute('src') || '').slice(-52)),
          webp: imgs.filter(i => (i.currentSrc || i.src || '').endsWith('.webp')).length,
        };
      })()` });
    const v = r.result.value || {};
    total += v.count || 0;
    broken += (v.bad || []).length;
    console.log('%s chapter-%d  图 %d 张，显示 %d 张（webp %d）%s',
      (v.count === v.shown) ? '✓' : '✗', chapter, v.count, v.shown, v.webp,
      (v.bad && v.bad.length) ? '  坏图: ' + v.bad.slice(0, 2).join(' | ') : '');
  }
  console.log('\n共 %d 张教材插图，坏图 %d 张', total, broken);
  process.exit(broken ? 1 : 0);
} finally { child.kill(); }
