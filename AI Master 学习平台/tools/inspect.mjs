/**
 * tools/inspect.mjs —— 页面几何探针。
 *
 * 截图只能告诉我们「看起来是空的」；到底是真空白、元素没渲染、
 * 还是 Chromium 超长截图失真，必须读 DOM 才知道。
 * 这个脚本输出每个关键容器的 top/height/display 与子元素数量，
 * 用于区分这三种情况。
 *
 * 用法：node tools/inspect.mjs /training /roadmap ...
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BASE = process.env.STARLAB_BASE || 'http://127.0.0.1:5178';
const PORT = 9339;
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

const EXPR = `(() => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { top: Math.round(r.top + scrollY), h: Math.round(r.height),
             w: Math.round(r.width), disp: cs.display, vis: cs.visibility, op: cs.opacity };
  };
  const kids = (id) => {
    const el = document.getElementById(id);
    return el ? el.children.length : -1;
  };
  const list = document.getElementById('wb-list');
  const cards = list ? [...list.querySelectorAll('.qcard')] : [];
  return {
    path: location.pathname,
    errors: (window.__errors || []).slice(0, 4),
    docH: document.documentElement.scrollHeight,
    // 主内容容器
    slots: kids('wb-chapters') >= 0 ? null : null,
    blocks: {
      'q-slots': document.querySelectorAll('.q-slots').length,
      'kp': document.querySelectorAll('.kp').length,
      'qcard': document.querySelectorAll('.qcard').length,
      'cx-realm': document.querySelectorAll('.cx-realm').length,
      'cx-equip': document.querySelectorAll('.cx-equip').length,
      'rm-day': document.querySelectorAll('.rm-day').length,
      'g-star': document.querySelectorAll('.g-star').length,
      'pg-kpi': document.querySelectorAll('.pg-kpi').length,
      'board-item': document.querySelectorAll('.board-item').length,
      'ask-sample': document.querySelectorAll('.ask-sample').length,
      'agent-fab': document.querySelectorAll('.agent-fab').length,
    },
    boxes: {
      'wb-list': box(list),
      'wb-list-first': cards.length ? box(cards[0]) : null,
      'wb-list-last': cards.length ? box(cards[cards.length - 1]) : null,
      'rm-days': box(document.getElementById('rm-days')),
      'rm-first': box(document.querySelector('.rm-day')),
      'cx-realms': box(document.getElementById('cx-realms')),
      'cx-first': box(document.querySelector('.cx-realm')),
      'cx-trials': box(document.getElementById('cx-trials')),
      'pg-kpis': box(document.getElementById('pg-kpis')),
      'pg-table': box(document.querySelector('.pg-table')),
      'coach-side': box(document.querySelector('.coach-side')),
      'coach-main': box(document.querySelector('.coach-main')),
      'coach-figure': box(document.getElementById('coach-figure')),
      'interview': box(document.getElementById('interview-panel')),
      'qslots-first': box(document.querySelector('.q-slots')),
      'kp-first': box(document.querySelector('.kp')),
      'page': box(document.querySelector('main.page')),
    },
    hasContent: {
      'router-ok': Boolean(window.Chapter || window.Training || window.CoachPage || window.Constellation || window.Roadmap || window.ProgressPage || window.AgentPage),
    },
    sections: [...document.querySelectorAll('.section')].map((s) => ({
      title: (s.querySelector('h2') || {}).textContent || '',
      top: Math.round(s.getBoundingClientRect().top + scrollY),
      h: Math.round(s.getBoundingClientRect().height),
    })),
    pg: {
      wrong: box(document.getElementById('pg-wrong')),
      wrongTxt: ((document.getElementById('pg-wrong') || {}).textContent || '').trim().slice(0, 60),
      exams: box(document.getElementById('pg-exams')),
      log: box(document.getElementById('pg-log')),
    },
    coach: {
      figHtml: ((document.getElementById('coach-figure') || {}).innerHTML || '').slice(0, 60),
      figSvg: Boolean(document.querySelector('#coach-figure svg')),
      interviewDisplay: (() => {
        const el = document.getElementById('interview-panel');
        return el ? getComputedStyle(el).display : 'missing';
      })(),
    },
    kpBodies: [...document.querySelectorAll('.kp-body')].map((e) => (e.hidden ? 'hidden' : 'open')),
    kps: document.querySelectorAll('.kp').length,
    // 命中测试：右下角到底是哪一层盖住了内容。这是排查"看不见"最快的一招。
    hits: (() => {
      const probe = (x, y) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return 'null';
        return el.tagName + '.' + String(el.className || '').split(' ').slice(0, 2).join('.');
      };
      return {
        leftMid: probe(220, 400),
        rightMid: probe(900, 400),
        rightLow: probe(900, 700),
        listFirst: (() => {
          const c = document.querySelector('#wb-list .qcard');
          if (!c) return 'no-card';
          const r = c.getBoundingClientRect();
          return probe(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
        })(),
      };
    })(),
    layers: [...document.querySelectorAll('body > *')].slice(0, 6).map((el) => {
      const cs = getComputedStyle(el);
      return el.tagName + '.' + String(el.className || '').split(' ')[0] +
        ' pos=' + cs.position + ' z=' + cs.zIndex + ' op=' + cs.opacity;
    }),
  };
})()`;

async function main() {
  const paths = process.argv.slice(2);
  if (!EDGE) { console.error('找不到 Edge'); process.exit(1); }
  if (!paths.length) { console.error('用法: node tools/inspect.mjs /path ...'); process.exit(1); }
  const profile = join(process.env.TEMP || '/tmp', 'starlab_inspect');
  const child = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--window-size=1600,900', 'about:blank',
  ], { stdio: 'ignore' });

  try {
    const cdp = await connect(`http://127.0.0.1:${PORT}`);
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await cdp.send('Runtime.enable');
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

    for (const path of paths) {
      await cdp.send('Page.navigate', { url: BASE + path });
      await sleep(4600);
      const out = await cdp.send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
      const v = out.result.value;
      console.log('\n=== %s  docH=%d ===', v.path, v.docH);
      const blocks = Object.entries(v.blocks).filter(([, n]) => n > 0);
      console.log('  元素计数:', blocks.map(([k, n]) => `${k}=${n}`).join('  ') || '（无）');
      for (const [name, b] of Object.entries(v.boxes)) {
        if (!b) continue;
        console.log('  %-14s top=%-6d h=%-6d w=%-5d %s%s', name, b.top, b.h, b.w, b.disp,
          b.disp === 'none' || b.vis === 'hidden' || b.op === '0' ? '  ← 不可见' : '');
      }
      if (v.errors.length) console.log('  页面错误:', v.errors.join(' | '));
      if (v.sections && v.sections.length) {
        console.log('  区块:');
        for (const s of v.sections) {
          console.log('    %-16s top=%-6d h=%-5d', s.title.slice(0, 16) || '(无标题)', s.top, s.h);
        }
      }
      if (v.pg && (v.pg.wrong || v.pg.exams || v.pg.log)) {
        console.log('  档案: wrong=%s "%s"  exams=%s  log=%s',
          v.pg.wrong ? `${v.pg.wrong.top}/${v.pg.wrong.h}` : 'null', v.pg.wrongTxt,
          v.pg.exams ? `${v.pg.exams.top}/${v.pg.exams.h}` : 'null',
          v.pg.log ? `${v.pg.log.top}/${v.pg.log.h}` : 'null');
      }
      if (v.coach && (v.coach.figHtml || v.coach.interviewDisplay !== 'missing')) {
        console.log('  教练: svg=%s 图内容="%s" 面试面板=%s',
          v.coach.figSvg, v.coach.figHtml.slice(0, 40), v.coach.interviewDisplay);
      }
      if (v.kps) console.log('  知识点 %d 个，展开状态: %s', v.kps, v.kpBodies.join(','));
      if (v.hits) console.log('  命中测试: %s', JSON.stringify(v.hits));
      if (v.layers) console.log('  body 子层:\n    %s', v.layers.join('\n    '));
    }
  } finally {
    child.kill();
  }
  process.exit(0);
}

main();
