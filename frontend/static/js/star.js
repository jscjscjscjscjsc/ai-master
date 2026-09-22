/* ===========================================================
   星辰系统 · 公共前端
   -----------------------------------------------------------
   这个文件只放三样东西，全站都要用：
     1. 统一的请求封装（JSON + 流式 SSE），四个页面的流式解析逻辑
        只此一份 —— 复制粘贴四遍的解析循环是上一代平台最大的维护负担。
     2. 智能体「星语」面板：全站悬浮可用，负责问答与跳转。
     3. 若干渲染小工具（Markdown、时间、toast）。
   =========================================================== */

const Star = {
  user: { username: 'guest', is_guest: true },

  /* ── 请求 ───────────────────────────────────────────── */
  async api(url, options = {}) {
    const response = await fetch(url, {
      method: options.method || (options.body ? 'POST' : 'GET'),
      headers: options.body ? { 'Content-Type': 'application/json' } : {},
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
    if (!response.ok && response.status >= 500) {
      throw new Error(`服务异常（HTTP ${response.status}）`);
    }
    const data = await response.json().catch(() => null);
    if (!data) throw new Error('返回内容不是合法 JSON，请重试。');
    return data;
  },

  /**
   * 流式读取。这是全站唯一的 SSE 解析实现。
   * 协议：每帧 `data: {json}\n\n`，用 split('\n\n') 切分并保留半截帧。
   * 必须用 fetch 而不是 EventSource —— 后者不支持 POST 请求体。
   */
  async stream(url, body, handlers = {}) {
    const controller = new AbortController();
    const timeout = handlers.timeout || 90000;
    const timer = setTimeout(() => controller.abort(), timeout);
    let answer = '';
    let done = false;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || `请求失败（HTTP ${response.status}）`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
        const frames = buffer.split('\n\n');
        buffer = frames.pop();
        for (const frame of frames) {
          if (!frame.startsWith('data: ')) continue;
          let event;
          try { event = JSON.parse(frame.slice(6)); } catch (e) { continue; }
          if (event.type === 'delta') {
            answer += event.text;
            if (handlers.onDelta) handlers.onDelta(answer, event.text);
          } else if (event.type === 'replace') {
            answer = event.text || answer;
            if (handlers.onReplace) handlers.onReplace(event);
          } else if (event.type === 'status' || event.type === 'switch') {
            if (handlers.onStatus) handlers.onStatus(event.message);
          } else if (event.type === 'session') {
            if (handlers.onSession) handlers.onSession(event);
          } else if (event.type === 'error') {
            throw new Error(event.message || '模型返回错误');
          } else if (event.type === 'done') {
            done = true;
            if (handlers.onDone) handlers.onDone(event);
          }
        }
        if (chunk.done) break;
      }
      if (!done && !handlers.allowPartial) throw new Error('连接提前结束，请重试。');
      return answer;
    } catch (error) {
      const message = error.name === 'AbortError' ? '响应超时，请重试。' : error.message;
      if (handlers.onError) handlers.onError(message, answer);
      else throw error;
      return answer;
    } finally {
      clearTimeout(timer);
    }
  },

  /* ── 工具 ───────────────────────────────────────────── */
  md: (text) => (window.MdLite ? window.MdLite.toHtml(text || '') : Star.esc(text || '')),

  esc(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  toast(message, kind = '') {
    let wrap = document.querySelector('.toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    const node = document.createElement('div');
    node.className = 'toast ' + kind;
    node.textContent = message;
    wrap.appendChild(node);
    setTimeout(() => node.remove(), 3600);
  },

  time() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  },

  /** 把「第 N 天」渲染成一句人话的日期 */
  dateLabel(value) {
    const date = new Date(value + 'T00:00:00');
    if (Number.isNaN(date.getTime())) return value;
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  },
};

/* ===========================================================
   全局智能体「星语」
   -----------------------------------------------------------
   它在每个页面都可用，因为它的核心价值不是答疑，而是**带路**：
   学生说「我不熟悉工具调用」，它直接把页面跳到那一节。
   因此它必须能从任何地方被唤起来 —— 这就是它做成悬浮层而不是
   独立页面的原因（独立页面还是得先让人找到它）。
   =========================================================== */
const StarAgent = {
  el: null,
  busy: false,
  opened: false,

  mount() {
    if (document.querySelector('.agent-panel')) return;
    const fab = document.createElement('button');
    fab.className = 'agent-fab';
    fab.innerHTML = '<b>✦</b> 问星语';
    fab.title = '全局学习智能体：答疑，并把你带到该去的那一页（Ctrl+K）';
    fab.addEventListener('click', () => this.toggle());
    document.body.appendChild(fab);

    const panel = document.createElement('aside');
    panel.className = 'agent-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <header>
        <span class="who"><i></i> 星语 · 全局学习智能体</span>
        <span class="row">
          <button class="btn sm ghost" data-act="roadmap" title="打开逐日学习路线">学习路线</button>
          <button class="btn sm ghost" data-act="close">✕</button>
        </span>
      </header>
      <div class="agent-thread" id="agent-thread">
        <div class="agent-intro">
          <p>我能做两件事：**回答问题**，以及**把你直接送到该去的页面**。</p>
          <p class="muted">比如你说「我对工具调用不熟悉」，我会跳到那一节；
             说「我想做题」，我会打开练习。</p>
        </div>
        <div class="agent-suggests" id="agent-suggests"></div>
      </div>
      <div class="agent-compose">
        <textarea id="agent-input" rows="2" placeholder="说说你现在卡在哪，或者想去哪一章…（Enter 发送）"></textarea>
        <button class="btn primary" id="agent-send">发送</button>
      </div>`;
    document.body.appendChild(panel);
    this.el = panel;

    panel.querySelector('[data-act="close"]').addEventListener('click', () => this.toggle(false));
    panel.querySelector('[data-act="roadmap"]').addEventListener('click', () => {
      window.location.href = '/roadmap';
    });
    const input = panel.querySelector('#agent-input');
    const send = () => this.ask(input.value);
    panel.querySelector('#agent-send').addEventListener('click', send);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); }
    });
    window.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        this.toggle();
      }
    });
    this.loadSuggests();
  },

  toggle(force) {
    const panel = this.el || document.querySelector('.agent-panel');
    if (!panel) return;
    const show = force === undefined ? panel.hidden : force;
    panel.hidden = !show;
    if (show) {
      this.opened = true;
      const input = panel.querySelector('#agent-input');
      if (input) setTimeout(() => input.focus(), 40);
    }
  },

  async loadSuggests() {
    const box = document.getElementById('agent-suggests');
    if (!box) return;
    try {
      const data = await Star.api('/api/agent/suggest');
      box.innerHTML = (data.suggestions || []).map((row) =>
        `<button class="agent-suggest" data-text="${Star.esc(row.text)}">
           <span>${Star.esc(row.text)}</span><em>${Star.esc(row.hint || '')}</em>
         </button>`).join('');
      box.querySelectorAll('.agent-suggest').forEach((node) => {
        node.addEventListener('click', () => this.ask(node.dataset.text));
      });
    } catch (error) {
      box.innerHTML = '';
    }
  },

  push(role, html) {
    const thread = document.getElementById('agent-thread');
    const node = document.createElement('div');
    node.className = 'agent-msg ' + role;
    node.innerHTML = html;
    thread.appendChild(node);
    thread.scrollTop = thread.scrollHeight;
    return node;
  },

  async ask(text) {
    const question = String(text || '').trim();
    if (!question || this.busy) return;
    const panel = this.el || document.querySelector('.agent-panel');
    const input = panel.querySelector('#agent-input');
    if (input) input.value = '';
    this.toggle(true);
    this.busy = true;
    const send = panel.querySelector('#agent-send');
    send.disabled = true;

    this.push('me', Star.esc(question));
    const bubble = this.push('bot', '<span class="typing">正在判断该带你去哪…</span>');
    try {
      const data = await Star.api('/api/agent/ask', {
        body: {
          question,
          page: document.body.dataset.page || document.title,
          chapter_id: document.body.dataset.chapterId || '',
        },
      });
      if (!data.success) throw new Error(data.message || '智能体暂时不可用');
      let html = `<div class="md">${Star.md(data.reply)}</div>`;
      if (data.action_url) {
        html += `<a class="agent-action" href="${Star.esc(data.action_url)}">
                   <b>${Star.esc(data.action.label || '带我去')}</b><em>${Star.esc(data.action_url)}</em>
                 </a>`;
      }
      if (data.sources && data.sources.length) {
        html += `<div class="agent-sources">参考：${data.sources.map(Star.esc).join(' · ')}</div>`;
      }
      if (data.cached) html += '<div class="agent-sources">来自缓存 · 秒回</div>';
      bubble.innerHTML = html;
      /* 有跳转动作时不自动跳 —— 让人自己点。
         自动跳页面会打断学生正在做的事，这比多点一下更烦。 */
    } catch (error) {
      bubble.innerHTML = `<div class="md bad">${Star.esc(error.message)}</div>
        <div class="agent-sources">也可以直接点上面的快捷问句，或去「学习路线」页看逐日安排。</div>`;
    } finally {
      this.busy = false;
      send.disabled = false;
    }
  },
};

/* ── 页面公共启动 ─────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  if (window.Cultivation) Cultivation.mount();
  StarAgent.mount();
  try {
    const data = await Star.api('/api/user');
    Star.user = data;
    document.querySelectorAll('[data-username]').forEach((node) => {
      node.textContent = data.is_guest ? '游客' : data.username;
    });
    document.querySelectorAll('[data-guest-only]').forEach((node) => {
      node.hidden = !data.is_guest;
    });
  } catch (error) { /* 未登录状态不影响浏览 */ }
});
