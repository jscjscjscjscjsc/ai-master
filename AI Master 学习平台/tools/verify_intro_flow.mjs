/**
 * tools/verify_intro_flow.mjs —— 验收站点入口链路：「看板 → 开场 CG → 看板」必须收敛。
 *
 * 为什么需要它：这条链跨越两个页面（dashboard 的引导守卫 + entry_cg 的 finish()），
 * 任何一侧单独看都正常。真实事故是 dashboard 读了 sessionStorage 标记、
 * 片头里却没人写，于是「跳过开场」→ / → 又被送回 /intro，学生永远出不去。
 * 两页互踢的缺陷，单页截图和静态内链检查都发现不了 —— 必须真开浏览器跑一遍。
 *
 * 覆盖四件事：
 *   ① 全新会话打开看板 → 应引导到片头；
 *   ② 点「跳过开场」→ 应落到看板并停住（不回头）；
 *   ③ 末幕按空格 → 应出站（末幕不能没有出口）；
 *   ④ 存储读写都被拒时 → 必须留在看板，不把人挡在门外；
 *   ⑤ 星海「返回主界面」→ 应回站内页，不是 404。
 *
 * 用法：node tools/verify_intro_flow.mjs [base]
 * 退出码 0 = 全部通过，1 = 有失败项。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9416;
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

const base = (process.argv[2] || 'http://127.0.0.1:5178').replace(/\/$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      } else if (m.method) this.events.push(m);
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
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
  /** 主框架的跳转序列（path + query）。互踢问题只有看这条序列才能定性。 */
  navs() {
    return this.events
      .filter((e) => e.method === 'Page.frameNavigated' && !e.params.frame.parentId)
      .map((e) => new URL(e.params.frame.url).pathname + new URL(e.params.frame.url).search);
  }
  clearNavs() { this.events = []; }
  /** 真鼠标点击：合成 .click() 会绕开命中测试，按钮被遮挡时照样"成功"，验不出问题。 */
  async click(selector) {
    const box = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
    })()`);
    if (!box) return null;
    const p = { x: box.x, y: box.y, button: 'left', clickCount: 1 };
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, ...p });
    }
    return box;
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

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`   ${ok ? '√' : '✗'} ${name}${detail ? '  ' + detail : ''}`);
};

const profile = mkdtempSync(join(tmpdir(), 'aimaster-flow-'));
const child = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1440,900', '--no-first-run', '--no-default-browser-check',
  '--disable-features=Translate', 'about:blank',
], { stdio: 'ignore' });

try {
  const cdp = await connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  /* ① 全新会话打开看板：应当被引导到片头 */
  console.log('\n① 全新会话打开看板');
  await cdp.send('Page.navigate', { url: base + '/' });
  await sleep(2600);
  let seq = cdp.navs();
  console.log('   跳转序列：', seq.join('  →  '));
  check('被引导到开场 CG（首次打开先播片头）', seq.some((u) => u.startsWith('/intro')));

  /* ② 像用户那样真点「跳过开场」：要落到看板并停住 */
  console.log('\n② 点「跳过开场」');
  cdp.clearNavs();
  const box = await cdp.click('#skip');
  if (!box) throw new Error('开场页上没有可点的「跳过开场」按钮');
  console.log(`   点击坐标 ${Math.round(box.x)},${Math.round(box.y)}（尺寸 ${Math.round(box.w)}×${Math.round(box.h)}）`);
  await sleep(3000);
  seq = cdp.navs();
  console.log('   跳转序列：', seq.join('  →  '));
  const last = seq[seq.length - 1];
  const backToIntro = seq.filter((u) => u.startsWith('/intro')).length;
  check('落到看板且没有被送回片头', last === '/' && backToIntro === 0, `终点 ${last}`);
  const flag = await cdp.eval(`(sessionStorage.getItem('aimaster_entry_seen') || '(空)')`);
  check('片头已写下已看标记', flag === '1', `aimaster_entry_seen = ${flag}`);

  /* ③ 同会话内再次打开看板：不该再弹片头 */
  console.log('\n③ 同会话内再次打开看板');
  await cdp.send('Page.navigate', { url: base + '/' });
  await sleep(2200);
  const here = await cdp.eval('location.pathname');
  check('停在看板、不再弹片头', here === '/', `停在 ${here}`);

  /* ④ 末幕必须有出口：按空格应出站，而不是被 clamp 弹回原处 */
  console.log('\n④ 末幕（?ch=5）按空格继续');
  cdp.clearNavs();
  await cdp.send('Page.navigate', { url: base + '/intro?ch=5' });
  await sleep(2200);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
  await sleep(2600);
  seq = cdp.navs();
  console.log('   跳转序列：', seq.join('  →  '));
  check('末幕空格能出站（不再是死路）', seq.includes('/'), `终点 ${seq[seq.length - 1]}`);

  /* ⑤ 存储读写都被拒时的兜底：不能把学生挡在门外、也不能白屏 */
  console.log('\n⑤ 存储不可用（无痕/被拒）时的兜底');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `Object.defineProperty(window, 'sessionStorage', { configurable: true, get() {
      return { getItem: () => null, setItem: () => { throw new Error('storage denied'); },
               removeItem: () => {}, clear: () => {}, key: () => null, length: 0 };
    }});`,
  });
  cdp.clearNavs();
  await cdp.send('Page.navigate', { url: base + '/' });
  await sleep(2600);
  seq = cdp.navs();
  console.log('   跳转序列：', seq.join('  →  '));
  const stayed = await cdp.eval('location.pathname');
  const title = await cdp.eval(`(document.querySelector('h1')?.textContent || '').trim().slice(0, 24)`);
  check('停在看板（没被反复弹去片头）', stayed === '/' && !seq.some((u) => u.startsWith('/intro')),
    `停在 ${stayed}`);
  check('看板正文照常渲染（没白屏）', title.includes('欢迎归航'), `标题「${title}」`);

  /* ⑥ 星海「返回主界面」：原版写死 /dashboard，平台没有这个路由（404） */
  console.log('\n⑥ 星海页「返回主界面」');
  await cdp.send('Page.navigate', { url: base + '/stars' });
  await sleep(5500);   // 星海要加载 three.js 并拉一次星图数据
  const ready = await cdp.eval(`document.querySelector('#loading')?.classList.contains('hide')`);
  check('星海已就绪（加载层收起）', ready === true);
  const hit = await cdp.eval(`(() => {
    const el = document.querySelector('#dashboardButton');
    if (!el) return '(按钮不存在)';
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return (el === top || el.contains(top)) ? 'ok' : '被 ' + (top?.className || top?.tagName) + ' 遮挡';
  })()`);
  check('按钮没被别的层盖住', hit === 'ok', hit === 'ok' ? '' : hit);
  cdp.clearNavs();
  const atlasBox = await cdp.click('#dashboardButton');
  check('按钮存在且可见', !!atlasBox);
  await sleep(2600);
  seq = cdp.navs();
  console.log('   跳转序列：', seq.join('  →  '));
  const landed = await cdp.eval('location.pathname');
  check('回到站内页而不是 404', landed === '/', `落在 ${landed}`);

} catch (err) {
  console.log('\n脚本出错：', err.message);
  results.push({ name: '脚本执行', ok: false });
} finally {
  child.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 项通过` +
  (failed.length ? ` —— 失败：${failed.map((f) => f.name).join('、')}` : ''));
process.exit(failed.length ? 1 : 0);
