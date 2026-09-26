/**
 * tools/shoot_agent_draw.mjs —— 验收"智能体真画图"这条链路。
 *
 * 为什么必须真开浏览器：这次修的是「模型用字符画（├─│└）冒充画图」。
 * 光看接口返回的 render 事件只能证明后端产出了结构，
 * 证明不了前端能不能把它画出来 —— 中间还隔着 agent_viz.js 的 SVG 渲染。
 * 所以这里点真的按钮、发真的问题、截真的图。
 *
 * 用法：node tools/shoot_agent_draw.mjs [base]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'logs', 'shots', 'agent-draw');
const PORT = 9417;
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

const base = (process.argv[2] || 'http://127.0.0.1:5178').replace(/\/$/, '');
const USER = process.argv[3] || 'reviewer';
const PASS = process.argv[4] || 'aimaster2026';
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
      }, 60000);
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
  const profile = join(process.env.TEMP || '/tmp', 'draw_cdp_' + Date.now());
  const child = spawn(EDGE, [
    '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader', '--hide-scrollbars',
    '--no-first-run', '--disable-extensions', '--disable-features=Translate',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--window-size=1400,1600', 'about:blank',
  ], { stdio: 'ignore' });

  try {
    const cdp = await connect('http://127.0.0.1:' + PORT);
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride',
      { width: 1400, height: 1600, deviceScaleFactor: 1, mobile: false });

    console.log('[1] 登录并预置"已看过片头"标记');
    await cdp.send('Page.navigate', { url: base + '/login' });
    await sleep(2000);
    const prep = await cdp.send('Runtime.evaluate', {
      expression: `(async () => {
        await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ username: ${JSON.stringify(USER)}, password: ${JSON.stringify(PASS)} }) });
        sessionStorage.setItem('aimaster_entry_seen', '1');
        sessionStorage.setItem('aimaster_entry_guided', '1');
        window.AgentVizReady = !!window.AgentViz;
        return { vizOnPage: !!window.AgentViz };
      })()`, awaitPromise: true, returnByValue: true,
    });
    console.log('    ', JSON.stringify(prep.result.value));

    console.log('[2] 打开星辰教练页');
    await cdp.send('Page.navigate', { url: base + '/coach' });
    let stable = 0;
    for (let i = 0; i < 70; i += 1) {
      const { result } = await cdp.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      stable = result.value === 'complete' ? stable + 1 : 0;
      if (stable >= 3) break;
      await sleep(220);
    }
    await sleep(3000);

    const vizLoaded = await cdp.send('Runtime.evaluate', {
      expression: `({ agentViz: typeof window.AgentViz, hasRender: !!(window.AgentViz && window.AgentViz.render) })`,
      returnByValue: true,
    });
    console.log('    AgentViz 加载情况:', JSON.stringify(vizLoaded.result.value));

    console.log('[3] 输入"画一个思维导图"并发送');
    const asked = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const ta = document.querySelector('textarea, input[type="text"]');
        if (!ta) return { err: 'no input' };
        ta.focus();
        const setter = Object.getOwnPropertyDescriptor(
          ta.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set;
        setter.call(ta, '画一个思维导图说明什么是 RAG');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return { ok: true, tag: ta.tagName };
      })()`, returnByValue: true,
    });
    console.log('    ', JSON.stringify(asked.result.value));
    await sleep(600);

    const sent = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const send = btns.find((b) => /发送|提问|问一下/.test(b.innerText || '') && b.offsetParent !== null);
        if (send) { send.click(); return { clicked: (send.innerText||'').trim() }; }
        // 退路：回车提交
        const ta = document.querySelector('textarea, input[type="text"]');
        if (ta) {
          ta.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', bubbles:true }));
          return { clicked: 'enter' };
        }
        return { clicked: false };
      })()`, returnByValue: true,
    });
    console.log('    ', JSON.stringify(sent.result.value));

    console.log('[4] 等待生成（最多 90 秒）');
    let chart = null;
    for (let i = 0; i < 45; i += 1) {
      await sleep(2000);
      const probe = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const svgs = Array.from(document.querySelectorAll('svg'));
          const viz = svgs.filter((s) => s.closest('[class*="render"], [class*="viz"], .bubble, .msg, .thread'));
          const texts = svgs.map((s) => (s.textContent || '').slice(0, 60));
          const body = document.body.innerText || '';
          return {
            svgCount: svgs.length,
            vizCount: viz.length,
            texts: texts.slice(0, 3),
            asciiArt: ['├','└','│','┌'].some((m) => body.includes(m)),
            busy: /正在|思考|画/.test(body.slice(-400)),
          };
        })()`, returnByValue: true,
      });
      chart = probe.result.value;
      if (chart.svgCount > 2 && !chart.busy) break;
    }
    console.log('    探针:', JSON.stringify(chart));

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(join(OUT, 'coach-draw.png'), Buffer.from(shot.data, 'base64'));
    console.log('  ->', join(OUT, 'coach-draw.png'));

    console.log('\n结论：');
    console.log('  图形已渲染(SVG>2):', chart.svgCount > 2 ? '✓' : '✗');
    console.log('  未使用字符画:', chart.asciiArt ? '✗ 出现了字符画' : '✓');
  } finally {
    child.kill();
  }
}

main().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
