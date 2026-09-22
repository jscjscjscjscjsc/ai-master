/* ===========================================================
   智能体工作台
   -----------------------------------------------------------
   这个页面的重点不是"聊天"，而是把智能体的判断过程**摊开给学生看**：
   右边那块「它现在看到的状态」直接调 /api/agent/blackboard，
   学生可以核对它有没有看错自己的进度。可验证的智能体才可信。
   =========================================================== */

const AgentPage = {
  busy: false,

  init() {
    const send = document.getElementById('ask-send');
    const input = document.getElementById('ask-input');
    send.addEventListener('click', () => this.ask(input.value));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); this.ask(input.value); }
    });
    this.loadSamples();
    this.loadBoard();
  },

  async loadSamples() {
    const box = document.getElementById('ask-samples');
    try {
      const data = await Star.api('/api/agent/suggest');
      box.innerHTML = (data.suggestions || []).map((row) =>
        `<button class="ask-sample" data-text="${Star.esc(row.text)}">
           <span>${Star.esc(row.text)}</span><em>${Star.esc(row.hint || '')}</em>
         </button>`).join('');
      box.querySelectorAll('.ask-sample').forEach((node) => {
        node.addEventListener('click', () => this.ask(node.dataset.text));
      });
    } catch (error) {
      box.innerHTML = '<p style="color:var(--muted)">暂时拿不到建议问句，直接输入也可以。</p>';
    }
  },

  async loadBoard() {
    const box = document.getElementById('board');
    try {
      const data = await Star.api('/api/agent/blackboard');
      let html = `<div class="board-level">
        <b>${Star.esc(data.realm || '未启程')}</b>
        <span>${data.points} 修为 · ${(data.weak || []).length} 处待补</span>
      </div>`;
      if (!(data.weak || []).length) {
        html += '<p style="color:var(--muted);font-size:12.5px">全部章节的知识点都完成了。接下来该去做组卷和模拟面试。</p>';
      } else {
        html += data.weak.slice(0, 5).map((row) => `
          <div class="board-item ${data.recommend && data.recommend.chapter_id === row.chapter_id ? 'hot' : ''}">
            <div class="bi-top">
              <b>${row.icon} ${Star.esc(row.title)}</b>
              <span>${Star.esc(row.reason)}</span>
            </div>
            <p>${row.pending_kps.slice(0, 3).map((kp) =>
                Star.esc(kp.title)).join(' · ') || '题目还全部未做'}</p>
          </div>`).join('');
      }
      box.innerHTML = html;
    } catch (error) {
      box.innerHTML = '<p style="color:var(--muted);font-size:12.5px">拿不到状态。</p>';
    }
  },

  push(role, html) {
    const thread = document.getElementById('ask-thread');
    const node = document.createElement('div');
    node.className = 'msg ' + role;
    node.innerHTML = html;
    thread.appendChild(node);
    thread.scrollTop = thread.scrollHeight;
    return node;
  },

  async ask(text) {
    const question = String(text || '').trim();
    if (!question || this.busy) return;
    this.busy = true;
    const send = document.getElementById('ask-send');
    send.disabled = true;
    document.getElementById('ask-input').value = '';
    this.push('me', Star.esc(question));
    const bubble = this.push('bot', '<span class="typing">正在判断该带你去哪</span>');
    try {
      const data = await Star.api('/api/agent/ask', {
        body: { question, page: '智能体工作台',
                chapter_id: document.body.dataset.chapterId || '' },
      });
      if (!data.success) throw new Error(data.message || '智能体暂时不可用');
      let html = `<div class="md">${Star.md(data.reply)}</div>`;
      if (data.action_url) {
        html += `<a class="go-card" href="${Star.esc(data.action_url)}">
                   <span><b>${Star.esc(data.action.label || '带我去')}</b>
                   <em>${Star.esc(data.action_url)}</em></span>
                   <span class="go-mark">→</span>
                 </a>`;
      }
      const trace = [];
      if (data.local_intent) trace.push('本地意图识别命中（未调用模型，零延迟）');
      if (data.cached) trace.push('命中回答缓存');
      if (data.sources && data.sources.length) trace.push('参考：' + data.sources.map(Star.esc).join(' · '));
      if (data.action && data.action.type !== 'none') trace.push('动作校验通过：' + data.action.type);
      if (trace.length) html += `<div class="trace">${trace.join('<br>')}</div>`;
      bubble.innerHTML = html;
      this.loadBoard();
    } catch (error) {
      bubble.innerHTML = `<div class="md" style="color:var(--rose)">${Star.esc(error.message)}</div>`;
    } finally {
      this.busy = false;
      send.disabled = false;
    }
  },
};

document.addEventListener('DOMContentLoaded', () => AgentPage.init());
