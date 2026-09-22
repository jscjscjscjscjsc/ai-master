/**
 * tools/shoot_cg.mjs —— 给 CG 页面截图（用于人眼复核画面，而不只是看状态码）。
 *
 * 为什么要它：tools/cgcheck.mjs 只能告诉你「引擎在跑」，
 * 但画面本身可能是黑的、元素叠在一起、字被裁掉。
 * 这些只有看图才知道，而 CG 恰恰是这一个项目最需要人眼确认的部分。
 *
 * 关键实现点：要开 SwiftShader 软件渲染，否则 WebGL 页面截出来是空白；
 * 并且要等动画真正跑起来（固定等待 + 让 JS 跳到指定幕）。
 *
 * 用法：node tools/shoot_cg.mjs          截默认清单
 *       node tools/shoot_cg.mjs 3        第 3 张起（继续跑剩下的）
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'logs', 'cg-shots');
const BASE = process.env.STARLAB_BASE || 'http://127.0.0.1:5178';
const PORT = 9357;
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// [路径, 文件名, 跳到第几幕（0 基）, 是整页截图还是视口]
const TARGETS = [
  // [路径, 文件名, 第几幕(0基, -1=不动), 幕内进度, 是否整页]
  // 幕内进度很关键：跳过去之后必须让画面「画完」，否则截到的是刚开场
  // 只有几笔线条的中间态 —— 看起来像 CG 没画出来。
  ['/static/cg/transformer_cg.html?autoplay=1&controls=0', 'cg-transformer', 3, 0.72, false],
  ['/static/cg/prompt_cg.html?autoplay=1&controls=0', 'cg-prompt', 3, 0.70, false],
  ['/static/cg/llm_intro.html', 'cg-llm-intro', -1, 0, false],
  ['/static/cg/api_engineering_cg.html?autoplay=1&controls=0', 'cg-api-1', 1, 0.92, false],
  ['/static/cg/api_engineering_cg.html?autoplay=1&controls=0', 'cg-api-2', 4, 0.92, false],
  ['/static/cg/agent_framework_cg.html?autoplay=1&controls=0', 'cg-framework-1', 1, 0.92, false],
  ['/static/cg/agent_framework_cg.html?autoplay=1&controls=0', 'cg-framework-2', 3, 0.55, false],
  ['/static/cg/multi_agent_cg.html?autoplay=1&controls=0', 'cg-multi-1', 1, 0.92, false],
  ['/static/cg/multi_agent_cg.html?autoplay=1&controls=0', 'cg-multi-2', 2, 0.90, false],
  ['/static/cg/agentic_cg/index.html', 'cg-agentic', -1, 0, false],
  ['/static/cg/rag_cg/index.html', 'cg-rag', -1, 0, false],
  ['/static/atlas/index.html', 'atlas-starfield', -1, 0, false],
  ['/static/cg/ai_odyssey.html', 'atlas-odyssey', -1, 0, false],
  ['/static/lab/transformer_lab.html', 'lab-transformer', -1, 0, false],
  ['/static/lab/bpe_game.html', 'lab-bpe', -1, 0, false],
  // 星际导航：路由是 /transition（不是 /static/...），hold=1 让它停住不跳
  ['/transition?to=/chapter/3&kicker=SECTOR 03&hold=1', 'transition-warp', -1, 0, false],
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

const startAt = Number(process.argv[2] || 0);
mkdirSync(OUT, { recursive: true });
const child = spawn(EDGE, ['--headless=new', '--no-sandbox', '--hide-scrollbars',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'starlab_cgshot'),
  '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

try {
  const cdp = await connect(`http://127.0.0.1:${PORT}`);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  for (let i = startAt; i < TARGETS.length; i += 1) {
    const [path, name, scene, within, fullPage] = TARGETS[i];
    await cdp.send('Page.navigate', { url: BASE + path });
    await sleep(5600);
    // 精确停帧：跳到指定幕的指定进度并暂停。
    // 用 freezeAt 而不是「goTo 然后 sleep」——后者只能靠猜等待时间，
    // 截到的可能是刚开场的中间态（看着像没画出来），而且不可复现。
    if (scene >= 0) {
      await cdp.send('Runtime.evaluate', {
        expression: `(function(){
          var d = window.StarCinemaDebug;
          if (!d) return 'no-probe';
          if (d.freezeAt) { d.freezeAt(${scene}, ${within}); return 'frozen'; }
          d.goTo(${scene}); return 'goto';
        })()`, returnByValue: true,
      });
      await sleep(1800);
    }
    let shot;
    if (fullPage) {
      const metrics = await cdp.send('Page.getLayoutMetrics');
      const height = Math.min(6000, Math.ceil(metrics.cssContentSize.height || 900));
      await cdp.send('Emulation.setDeviceMetricsOverride',
        { width: 1440, height, deviceScaleFactor: 1, mobile: false });
      await sleep(900);
      shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      await cdp.send('Emulation.setDeviceMetricsOverride',
        { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    } else {
      shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    }
    const buf = Buffer.from(shot.data, 'base64');
    writeFileSync(join(OUT, `${name}.png`), buf);
    console.log('%s  %s  scene=%s@%s  %d KB', name.padEnd(18), path.replace('?autoplay=1&controls=0', '').slice(0, 46).padEnd(46), scene, within, Math.round(buf.length / 1024));
  }
} finally { child.kill(); }
process.exit(0);
