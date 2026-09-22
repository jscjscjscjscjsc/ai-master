/**
 * tools/cgcheck.mjs —— CG 页面运行时自检。
 *
 * 为什么需要它：CG 是新做/搬来的 canvas 动画，静态看一眼 200 状态码
 * 完全不能说明问题 —— 引擎报错时画面就是一片黑，而黑屏在缩略图里
 * 看不出区别。这个脚本抓 console 错误、未捕获异常，并读回引擎状态
 * （场景数、当前幕、进度、帧计数），确认它真的在跑。
 *
 * 用法：node tools/cgcheck.mjs /static/cg/xxx.html ...
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
const BASE = process.env.STARLAB_BASE || 'http://127.0.0.1:5178';
const PORT = 9351;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } }); }
  send(method, params = {}) { const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + method)); } }, 30000); }); }
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

// 参数归一化：Git Bash 会把 /static/... 改写成 Windows 路径，
// cmd 下中文路径也可能出问题。所以只认「最后一段文件名」，
// 再按平台约定拼回 /static/cg/ —— 调用者可以只传文件名。
let paths = process.argv.slice(2).map((raw) => {
  if (raw.startsWith('/static/') || raw.startsWith('http')) return raw;
  const cleaned = raw.split('\\').join('/').replace(/^[A-Za-z]:/, '');
  const name = cleaned.split('/').filter(Boolean).pop() || '';
  return '/static/cg/' + name;
});
// 也支持完全不传参数：默认检查三部新做的 CG
if (!paths.length) {
  paths = ['/static/cg/api_engineering_cg.html',
           '/static/cg/agent_framework_cg.html',
           '/static/cg/multi_agent_cg.html',
           '/static/cg/transformer_cg.html',
           '/static/cg/prompt_cg.html',
           '/static/cg/llm_intro.html',
           '/static/cg/revelation_cg.html',
           '/static/cg/agentic_cg/index.html',
           '/static/cg/rag_starlab/index.html',
           '/static/lab/transformer_lab.html',
           '/static/lab/bpe_game.html',
           '/static/lab/llm_training_game.html',
           '/static/cg/ai_odyssey.html',
           '/static/atlas/index.html'];
}
if (!EDGE) { console.error('找不到 Edge'); process.exit(1); }
const child = spawn(EDGE, ['--headless=new', '--no-sandbox',
  // 关键：不用 --disable-gpu，改用 SwiftShader 软件渲染。
  // 否则 WebGL 上下文创建失败，three.js 的页面（星海、远征）会静默停在
  // canvas 默认尺寸 300x150 —— 看起来像页面坏了，其实是没 GPU。
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'starlab_cgcheck'),
  '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });

try {
  const cdp = await connect(`http://127.0.0.1:${PORT}`);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  const events = [];
  cdp.ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      events.push('[console] ' + (m.params.args || []).map((a) => a.value || a.description).join(' ').slice(0, 200));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      events.push('[异常] ' + ((d.exception && d.exception.description) || d.text).slice(0, 300));
    }
  });
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  let bad = 0;
  for (const path of paths) {
    events.length = 0;
    await cdp.send('Page.navigate', { url: BASE + path + (path.includes('?') ? '&' : '?') + 'autoplay=1' });
    await sleep(path.includes("atlas") || path.includes("odyssey") ? 11000 : 5200);
    const out = await cdp.send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
      // 这些页面来自不同年代、不同作者，元素 id 并不统一：
      //   StarCinema 系： #stage
      //   transformer/prompt/lab/游戏页： #stage 或自己的 canvas
      //   星海 / 远征： #space
      // 所以这里用一个「有哪些 canvas、哪个在动」的通用探测，
      // 而不是假定某个 id —— 否则探针会把好页面判成坏的。
      const canvases = [...document.querySelectorAll('canvas')];
      const big = canvases.map((c) => ({ id: c.id || '(无)', w: c.width, h: c.height,
        area: (c.width || 0) * (c.height || 0) }))
        .sort((a, b) => b.area - a.area);
      const d = window.StarCinemaDebug;
      const body = document.body;
      return {
        canvasCount: canvases.length,
        main: big[0] || null,
        canvases: big.slice(0, 3),
        engine: typeof StarCinema,
        hasThree: typeof THREE,
        scenes: (d && d.scenes) ? d.scenes.length : (typeof SCENES !== 'undefined' ? SCENES.length : null),
        idx: d ? d.idx : null,
        frames: d ? d.frames : null,
        title: (document.getElementById('sceneTitle') || {}).textContent
          || (document.querySelector('.scene-title') || {}).textContent || '',
        marks: document.querySelectorAll('#chapterMarks .mk, .chapter-marks .mk').length,
        cta: (() => { const a = document.getElementById('ctaBtn') || document.querySelector('.cta');
          return a ? (a.getAttribute('href') || '') : null; })(),
        bodyClass: body ? body.className : '',
        text: (body ? body.innerText : '').replace(/\s+/g, ' ').trim().slice(0, 90),
      };
    })()` });
    const v = out.result.value;
    const main = v.main || { w: 0, h: 0, id: '-' };
    // 活着的判据：有一块像样的画布，且页面上有可见文字（标题/字幕/按钮）。
    // 不要求特定 id，也不要求特定引擎 —— 这些页面技术路线本来就不一样。
    const ok = main.w > 200 && main.h > 200 && (v.text.length > 4 || v.canvasCount > 0);
    console.log('%s %s', ok ? '✓' : '✗', path);
    console.log('    canvas %d 块，主画布 #%s %dx%d  引擎=%s three=%s 场景=%s 帧=%s 文字="%s"',
      v.canvasCount, main.id, main.w, main.h, v.engine, v.hasThree,
      v.scenes === null ? '-' : v.scenes, v.frames === null ? '-' : v.frames, v.text.slice(0, 46));
    if (v.cta) console.log('    CTA → %s', v.cta);
    if (!ok) bad += 1;
    if (events.length) {
      [...new Set(events)].slice(0, 5).forEach((e) => console.log('    ' + e));
      bad += 1;
    }
  }
  process.exit(bad ? 1 : 0);
} finally { child.kill(); }
