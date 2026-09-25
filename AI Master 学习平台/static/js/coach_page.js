/* ===========================================================
   星辰教练
   -----------------------------------------------------------
   两个模式共用一套对话区：
     coach      —— 陪练式答疑，回答会自动存入会话
     interview  —— 模拟面试，面试官评分 + 追问 + 收尾总结
   语音问答走「服务端 edge-tts → 失败退回浏览器 Web Speech」两级降级，
   语音识别用 Web Speech 的 SpeechRecognition（Chrome/Edge 支持，
   不支持的浏览器就把麦克风按钮隐藏掉，不留一个点了没反应的按钮）。
   =========================================================== */

const CoachPage = {
  mode: 'coach',
  sessionId: '',
  history: [],
  voiceOn: false,
  lastAnswer: '',
  seq: 0,

  interview: { focus: '', turn: 0, question: '', history: [], log: [] },

  async init() {
    document.querySelectorAll('.coach-tab').forEach((tab) => {
      tab.addEventListener('click', () => this.setMode(tab.dataset.mode));
    });
    const send = document.getElementById('coach-send');
    const input = document.getElementById('coach-input');
    send.addEventListener('click', () => this.send());
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); this.send(); }
    });
    document.getElementById('coach-new').addEventListener('click', () => this.newSession());
    document.getElementById('coach-clear').addEventListener('click', () => this.clearSession());
    document.getElementById('coach-copy').addEventListener('click', () => this.copyTranscript());
    document.getElementById('coach-tts-last').addEventListener('click', () => this.speak(this.lastAnswer, 'coach'));
    const voice = document.getElementById('voice-on');
    voice.checked = localStorage.getItem('starlab_voice_on') === '1';
    this.voiceOn = voice.checked;
    voice.addEventListener('change', () => {
      this.voiceOn = voice.checked;
      localStorage.setItem('starlab_voice_on', voice.checked ? '1' : '0');
    });
    this.initMic();
    document.getElementById('iv-start').addEventListener('click', () => this.startInterview());
    await this.loadForms();
    await this.loadSessions();
    this.renderEmpty();
    if (new URLSearchParams(location.search).get('interview') === '1') this.setMode('interview');
  },

  setMode(mode) {
    this.mode = mode;
    document.querySelectorAll('.coach-tab').forEach((tab) => {
      tab.classList.toggle('on', tab.dataset.mode === mode);
    });
    const panel = document.getElementById('interview-panel');
    panel.hidden = mode !== 'interview';
    const shell = document.getElementById('coach-shell');
    if (shell) shell.classList.toggle('interview', mode === 'interview');
    document.getElementById('coach-title').textContent = mode === 'interview' ? '模拟大模型面试' : '星辰教练';
    document.getElementById('coach-sub').textContent = mode === 'interview'
      ? '面试官一次只问一个问题，答完当场点评并追问 · 全程不给答案'
      : '陪练式答疑 · 只给思路不给答案，直到你自己讲清楚';
    this.renderEmpty();
  },

  /* ── 法相 ───────────────────────────────────────────── */
  async loadForms() {
    try {
      const data = await Star.api('/api/coach/forms');
      const box = document.getElementById('coach-figure');
      const form = data.current || {};
      if (window.StarCoach && form.form) {
        box.innerHTML = window.StarCoach.render({ art: form, seed: data.user, width: '100%' });
      }
      document.getElementById('coach-form-name').textContent =
        `${form.name || '星尘'} · ${data.realm || '尘世'}`;
    } catch (error) { /* 法相画不出来不影响聊天 */ }
  },

  /* ── 会话 ───────────────────────────────────────────── */
  async loadSessions() {
    const box = document.getElementById('coach-sessions');
    try {
      const data = await Star.api('/api/coach/sessions');
      const rows = data.sessions || [];
      if (!rows.length) {
        box.innerHTML = '<p style="color:var(--muted);font-size:11.5px;padding:4px">还没有对话。直接问，会自动建一个。</p>';
        return;
      }
      box.innerHTML = rows.map((row) => `
        <div class="coach-session ${row.id === this.sessionId ? 'on' : ''}" data-id="${row.id}">
          <span>${Star.esc(row.title || '对话')}</span>
          <em>${row.message_count}</em>
        </div>`).join('');
      box.querySelectorAll('.coach-session').forEach((node) => {
        node.addEventListener('click', () => this.openSession(node.dataset.id));
      });
    } catch (error) {
      box.innerHTML = '';
    }
  },

  async openSession(id) {
    try {
      const data = await Star.api('/api/coach/sessions/' + encodeURIComponent(id));
      this.sessionId = id;
      const thread = document.getElementById('coach-thread');
      thread.innerHTML = '';
      (data.session.messages || []).forEach((message) => {
        this.push(message.role === 'user' ? 'me' : 'jj', Star.esc(message.content), false);
      });
      if (!(data.session.messages || []).length) this.renderEmpty();
      document.getElementById('coach-title').textContent = data.session.title || '星辰教练';
      this.loadSessions();
    } catch (error) {
      Star.toast(error.message, 'bad');
    }
  },

  async newSession() {
    try {
      const data = await Star.api('/api/coach/sessions', { body: {} });
      if (!data.success) throw new Error(data.message);
      this.sessionId = data.session.id;
      document.getElementById('coach-thread').innerHTML = '';
      document.getElementById('coach-title').textContent = '星辰教练';
      this.renderEmpty();
      await this.loadSessions();
    } catch (error) {
      Star.toast(error.message, 'bad');
    }
  },

  async clearSession() {
    if (!this.sessionId) { document.getElementById('coach-thread').innerHTML = ''; this.renderEmpty(); return; }
    try {
      await Star.api(`/api/coach/sessions/${encodeURIComponent(this.sessionId)}/clear`, { body: {} });
      document.getElementById('coach-thread').innerHTML = '';
      this.renderEmpty();
    } catch (error) { Star.toast(error.message, 'bad'); }
  },

  async copyTranscript() {
    if (!this.sessionId) { Star.toast('还没有可导出的对话', 'bad'); return; }
    try {
      const data = await Star.api(`/api/coach/sessions/${encodeURIComponent(this.sessionId)}/transcript`);
      await navigator.clipboard.writeText(data.text || '');
      Star.toast('对话已复制到剪贴板，可以直接粘进笔记', 'good');
    } catch (error) { Star.toast('复制失败，浏览器可能不允许', 'bad'); }
  },

  renderEmpty() {
    const thread = document.getElementById('coach-thread');
    if (thread.querySelector('.prompt-cards') || thread.children.length) return;
    const cards = this.mode === 'interview' ? [
      ['我完全没做过项目，能面试吗', '面试官会从基础原理问起，如实说即可'],
      ['考我 Transformer 的注意力机制', '进入原理追问'],
      ['问我智能体的失败模式', '进入工程追问'],
    ] : [
      ['注意力机制为什么要除以 √d_k？', '经典追问，讲清方差与梯度'],
      ['RAG 和微调到底怎么选？', '给决策顺序与判据'],
      ['帮我看看我的 Agent 设计有什么漏洞', '贴代码或描述，我来挑'],
      ['我不清楚自己该学什么', '会转到学习路线'],
    ];
    const div = document.createElement('div');
    div.className = 'prompt-cards';
    div.innerHTML = cards.map(([text, hint]) =>
      `<button class="prompt-card" data-text="${Star.esc(text)}">${Star.esc(text)}
       <em style="display:block;color:var(--muted);font-size:11px;font-style:normal">${Star.esc(hint)}</em></button>`).join('');
    div.querySelectorAll('.prompt-card').forEach((node) => {
      node.addEventListener('click', () => {
        document.getElementById('coach-input').value = node.dataset.text;
        this.send();
      });
    });
    thread.appendChild(div);
  },

  push(role, content, isHtml = true) {
    const thread = document.getElementById('coach-thread');
    const row = document.createElement('div');
    row.className = 'msg-row ' + role;
    row.innerHTML = `
      <div class="msg-avatar">${role === 'me' ? '我' : '星'}</div>
      <div><div class="bubble">${isHtml ? content : Star.md(content)}</div>
      <div class="msg-tools"></div></div>`;
    thread.appendChild(row);
    thread.scrollTop = thread.scrollHeight;
    return row;
  },

  addTools(row, text) {
    const tools = row.querySelector('.msg-tools');
    const speak = document.createElement('button');
    speak.textContent = '朗读';
    speak.addEventListener('click', () => this.speak(text, 'coach'));
    tools.appendChild(speak);
    if (this.mode === 'interview') {
      const scoreBadge = document.createElement('span');
      scoreBadge.className = 'msg-score';
      tools.appendChild(scoreBadge);
    }
    const copy = document.createElement('button');
    copy.textContent = '复制';
    copy.addEventListener('click', async () => {
      await navigator.clipboard.writeText(text);
      Star.toast('已复制', 'good');
    });
    tools.appendChild(copy);
  },

  async send() {
    const input = document.getElementById('coach-input');
    const question = input.value.trim();
    if (!question) return;
    input.value = '';
    this.push('me', Star.esc(question).replace(/\n/g, '<br>'));
    const seq = ++this.seq;
    const row = this.push('jj', '<span class="typing">正在想</span>');
    const bubble = row.querySelector('.bubble');
    let answer = '';

    try {
      await Star.stream('/api/coach/chat', {
        question,
        session_id: this.sessionId,
        mode: this.mode,
        page: `第 ${document.body.dataset.chapterId || '?'} 章 · ${document.body.dataset.page || ''}`,
        chapter_id: document.body.dataset.chapterId || '',
      }, {
        onSession: (event) => { if (!this.sessionId) this.sessionId = event.session_id; },
        onStatus: (message) => { if (!answer) bubble.innerHTML = `<span class="typing">${Star.esc(message)}</span>`; },
        onDelta: (text) => {
          if (seq !== this.seq) return;
          answer = text;
          bubble.innerHTML = `<div class="md">${Star.md(text)}</div>`;
          document.getElementById('coach-thread').scrollTop = 1e6;
        },
        onReplace: (event) => {
          if (event.text) bubble.innerHTML = `<div class="md">${Star.md(event.text)}</div>`;
          if (event.score !== undefined && event.score !== null) {
            const badge = row.querySelector('.msg-score');
            badge.textContent = `${event.score} 分`;
          }
          if (event.summary) {
            const box = document.createElement('div');
            box.className = 'iv-turn';
            box.innerHTML = `<span class="iv-role">整场总结</span>${Star.md(event.summary)}`;
            document.getElementById('coach-thread').appendChild(box);
          }
          if (event.question) {
            const box = document.createElement('div');
            box.className = 'iv-turn';
            box.innerHTML = `<span class="iv-role">下一个问题</span><span class="iv-q">${Star.esc(event.question)}</span>`;
            document.getElementById('coach-thread').appendChild(box);
            document.getElementById('coach-thread').scrollTop = 1e6;
            this.lastAnswer = event.question;
            if (this.voiceOn) this.speak(event.question, 'interviewer');
          }
        },
        onDone: () => {
          this.lastAnswer = answer;
          if (answer) this.addTools(row, answer);
          if (this.voiceOn && this.mode !== 'interview') this.speak(answer, 'coach');
          this.loadSessions();
        },
        onError: (message) => {
          bubble.innerHTML = `<span style="color:var(--rose)">${Star.esc(message)}</span>`;
        },
      });
    } catch (error) {
      bubble.innerHTML = `<span style="color:var(--rose)">${Star.esc(error.message)}</span>`;
    }
  },

  /* ── 语音输出 ───────────────────────────────────────── */
  async speak(text, character) {
    const clean = String(text || '').replace(/[`*#>]/g, '').trim();
    if (!clean) return;
    const short = clean.slice(0, 700);
    try {
      const response = await fetch('/api/tts/speak', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: short, character: character || 'coach' }),
      });
      if (response.ok && (response.headers.get('content-type') || '').includes('audio')) {
        const blob = await response.blob();
        const audio = new Audio(URL.createObjectURL(blob));
        await audio.play();
        return;
      }
    } catch (error) { /* 退回浏览器语音 */ }
    if (!window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(short);
    utterance.lang = 'zh-CN';
    utterance.rate = character === 'interviewer' ? 0.96 : 1.04;
    window.speechSynthesis.speak(utterance);
  },

  /* ── 语音输入 ───────────────────────────────────────── */
  initMic() {
    const button = document.getElementById('coach-mic');
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { button.hidden = true; return; }
    const recognizer = new Recognition();
    recognizer.lang = 'zh-CN';
    recognizer.interimResults = false;
    recognizer.continuous = false;
    let recording = false;
    const start = () => {
      if (recording) return;
      recording = true;
      button.classList.add('rec');
      button.textContent = '聆听中…';
      recognizer.start();
    };
    const stop = () => {
      recording = false;
      button.classList.remove('rec');
      button.textContent = '语音输入';
      try { recognizer.stop(); } catch (error) { /* 已经停了 */ }
    };
    recognizer.onresult = (event) => {
      const text = event.results[0][0].transcript;
      const input = document.getElementById('coach-input');
      input.value = (input.value + ' ' + text).trim();
      input.focus();
    };
    recognizer.onerror = () => { stop(); Star.toast('没听清，再说一次或直接打字', 'bad'); };
    recognizer.onend = stop;
    button.addEventListener('mousedown', start);
    button.addEventListener('mouseup', stop);
    button.addEventListener('mouseleave', () => { if (recording) stop(); });
    button.addEventListener('touchstart', (event) => { event.preventDefault(); start(); });
    button.addEventListener('touchend', (event) => { event.preventDefault(); stop(); });
  },

  /* ── 模拟面试 ───────────────────────────────────────── */
  async startInterview() {
    const focus = document.getElementById('iv-focus').value.trim();
    const log = document.getElementById('iv-log');
    log.innerHTML = '<div class="iv-turn"><span class="typing">面试官正在看你的学习档案，准备第一个问题</span></div>';
    document.getElementById('iv-score').hidden = true;
    try {
      const data = await Star.api('/api/interview/start', { body: { focus } });
      if (!data.success) throw new Error(data.message);
      this.interview = {
        focus: data.focus, turn: 1, question: data.question,
        history: [{ role: 'assistant', content: data.question }], log: [],
      };
      if (data.session_id) { this.sessionId = data.session_id; this.loadSessions(); }
      log.innerHTML = '';
      this.appendTurn('开场', data.comment, null, data.focus);
      this.appendTurn('面试官的问题', data.question, null, '');
      document.getElementById('coach-input').focus();
      document.getElementById('coach-input').placeholder = '在这里回答面试官的问题…（Enter 提交）';
      this.mode = 'interview';
      this.setMode('interview');
    } catch (error) {
      log.innerHTML = `<div class="iv-turn" style="color:var(--rose)">${Star.esc(error.message)}</div>`;
    }
  },

  appendTurn(label, text, score, note) {
    const log = document.getElementById('iv-log');
    const node = document.createElement('div');
    node.className = 'iv-turn';
    node.innerHTML = `<span class="iv-role">${Star.esc(label)}</span>
      ${score !== null && score !== undefined ? `<span class="iv-score-badge">${score} 分</span>` : ''}
      <div>${Star.md(text)}</div>
      ${note ? `<div class="iv-comment">方向：${Star.esc(note)}</div>` : ''}`;
    log.appendChild(node);
    log.scrollTop = log.scrollHeight;
  },

  async answerInterview(answer) {
    const box = document.getElementById('iv-log');
    const pending = document.createElement('div');
    pending.className = 'iv-turn';
    pending.innerHTML = '<span class="typing">面试官正在记录</span>';
    box.appendChild(pending);
    box.scrollTop = box.scrollHeight;
    try {
      const data = await Star.api('/api/interview/answer', {
        body: {
          answer, focus: this.interview.focus, question: this.interview.question,
          history: this.interview.history, turn: this.interview.turn,
          session_id: this.sessionId,
        },
      });
      if (!data.success) throw new Error(data.message);
      pending.remove();
      this.appendTurn('点评', data.comment, data.score, '');
      this.interview.turn += 1;
      this.interview.history.push({ role: 'user', content: answer });
      if (data.done) {
        const scoreBox = document.getElementById('iv-score');
        scoreBox.hidden = false;
        scoreBox.innerHTML = `<h4>面试结束</h4>${Star.md(data.summary || '面试已结束。')}
          <div style="margin-top:9px;color:var(--muted)">想再练一场就点「开始面试」，方向可以换成别的章节。</div>`;
        document.getElementById('coach-input').placeholder = '想再练一场就点「开始面试」…';
        this.interview.question = '';
        this.lastAnswer = data.summary || data.comment;
        if (this.voiceOn) this.speak(data.summary || data.comment, 'interviewer');
        return;
      }
      this.interview.question = data.question;
      this.interview.history.push({ role: 'assistant', content: data.question });
      this.appendTurn('面试官的问题', data.question, null, '');
      this.lastAnswer = data.question;
      if (this.voiceOn) this.speak(data.question, 'interviewer');
    } catch (error) {
      pending.innerHTML = `<span style="color:var(--rose)">${Star.esc(error.message)}</span>`;
    }
  },
};

/* 面试模式下 Enter 直接提交，且渲染进右侧面试记录而不是中间对话区 */
document.addEventListener('DOMContentLoaded', () => {
  CoachPage.init();
  const input = document.getElementById('coach-input');
  const sendButton = document.getElementById('coach-send');
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (document.activeElement !== input) return;
    if (CoachPage.mode !== 'interview' || !CoachPage.interview.question) return;
    event.preventDefault();
    const answer = input.value.trim();
    if (!answer) return;
    input.value = '';
    CoachPage.appendTurn('我的回答', answer, null, '');
    CoachPage.lastAnswer = answer;
    CoachPage.answerInterview(answer);
  });
});
