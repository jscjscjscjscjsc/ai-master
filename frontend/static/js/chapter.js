/* ===========================================================
   章节页脚本
   -----------------------------------------------------------
   作答 / 判分 / 讲解全在 qcards.js 里，这里只管章节页自己特有的三件事：
     1. 知识点的展开折叠与「标记掌握」
     2. 本章进度条
     3. 朗读讲义（服务端 TTS → 浏览器语音两级降级）
   =========================================================== */

const Chapter = {
  id: document.body.dataset.chapterId,
  speaking: false,
  audio: null,

  init() {
    // 题目卡片由 QCards.html() 统一渲染后再挂事件：
    // 章节页与刷题页共用一个模板，避免两处判分逻辑漂移。
    document.querySelectorAll('.q-slots').forEach((slot) => {
      let rows = [];
      try { rows = JSON.parse(slot.dataset.questions || '[]'); } catch (e) { rows = []; }
      slot.innerHTML = rows.map((q) => QCards.html(q)).join('');
    });
    document.querySelectorAll('.kp').forEach((node) => this.bindKp(node));
    QCards.mount(document);
    QCards.afterSubmit = () => this.refreshProgress();
    this.bindChapterActions();
    this.refreshProgress();

    // 支持 /chapter/4#kp-3 这类直接跳转：落在哪一节就滚到哪一节
    if (location.hash) {
      const target = document.querySelector(location.hash);
      if (target && target.classList.contains('kp')) {
        setTimeout(() => target.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
      }
    }
  },

  bindKp(node) {
    const body = node.querySelector('.kp-body');
    const button = node.querySelector('[data-act="toggle"]');
    if (button && body) {
      button.addEventListener('click', () => {
        body.hidden = !body.hidden;
        button.textContent = body.hidden ? '展开' : '收起';
      });
    }
    const complete = node.querySelector('[data-act="complete"]');
    if (complete) complete.addEventListener('click', () => this.markComplete(node, complete));

    const ask = node.querySelector('[data-act="kp-ask"]');
    if (ask) {
      ask.addEventListener('click', () => {
        if (window.StarAgent) {
          StarAgent.toggle(true);
          StarAgent.ask(`我对第 ${this.id} 章的「${ask.dataset.title}」不熟悉，带我去看，并讲讲重点。`);
        }
      });
    }
    const speak = node.querySelector('[data-act="kp-tts"]');
    if (speak) speak.addEventListener('click', () => this.speakLesson(node, speak));
  },

  async markComplete(node, button) {
    button.disabled = true;
    try {
      const data = await Star.api('/api/complete-kp', {
        body: { chapter_id: Number(this.id), kp_index: Number(node.dataset.kpIndex) },
      });
      if (!data.success) throw new Error(data.message || '保存失败');
      node.dataset.done = '1';
      button.textContent = '已标记掌握';
      if (window.Cultivation) Cultivation.applySettlement(data);
      const meta = node.querySelector('.kp-meta');
      if (meta && !meta.querySelector('.chip.green')) {
        const chip = document.createElement('span');
        chip.className = 'chip green';
        chip.textContent = '已掌握';
        meta.appendChild(chip);
      }
      this.refreshProgress();
      Star.toast(`+${data.awarded || 0} 修为 · 已记录`, 'good');
    } catch (error) {
      button.disabled = false;
      Star.toast(error.message, 'bad');
    }
  },

  /* 朗读：先试服务端高质量语音，失败自动退回浏览器语音。
     语音是增强功能，绝不能因为它挂掉就让页面报错。 */
  async speakLesson(node, button) {
    if (this.speaking) {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
      if (this.audio) { this.audio.pause(); this.audio = null; }
      this.speaking = false;
      button.textContent = '🔊 朗读这一节';
      return;
    }
    const lesson = node.querySelector('.lesson');
    if (!lesson) return;
    const text = lesson.innerText.slice(0, 900);
    this.speaking = true;
    button.textContent = '⏳ 合成中…';
    try {
      const response = await fetch('/api/tts/speak', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, character: 'narrator' }),
      });
      if (response.ok && (response.headers.get('content-type') || '').includes('audio')) {
        const blob = await response.blob();
        this.audio = new Audio(URL.createObjectURL(blob));
        this.audio.onended = () => { this.speaking = false; button.textContent = '🔊 朗读这一节'; };
        await this.audio.play();
        button.textContent = '⏹ 停止朗读';
        return;
      }
    } catch (error) { /* 落到浏览器语音 */ }
    this.speakBrowser(text, button);
  },

  speakBrowser(text, button) {
    if (!window.speechSynthesis) {
      this.speaking = false;
      button.textContent = '🔊 朗读这一节';
      Star.toast('这个浏览器不支持语音朗读', 'bad');
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 1.06;
    utterance.onend = () => { this.speaking = false; button.textContent = '🔊 朗读这一节'; };
    window.speechSynthesis.speak(utterance);
    button.textContent = '⏹ 停止朗读';
  },

  bindChapterActions() {
    const ask = document.getElementById('btn-ask-chapter');
    if (ask) {
      ask.addEventListener('click', () => {
        const title = document.querySelector('.ch-head h1').innerText;
        if (window.StarAgent) {
          StarAgent.toggle(true);
          StarAgent.ask(`我想系统过一遍${title}，先告诉我这一章的重点和最容易搞错的地方。`);
        }
      });
    }
    this.bindCg();
  },

  /* ── 章节开场 CG ────────────────────────────────────────
     两种打开方式，刻意都留：
       「播放这一章的开场」→ 新标签全屏，真正沉浸地看（原版就是这个体验）
       「在页面里预览」    → 页内 iframe，快速扫一眼，不打断阅读
     只留一种都会别扭：只留新标签，学生会因为怕走丢而不点；
     只留预览，电影级 CG 在半个视口里就浪费了。 */
  bindCg() {
    const cg = document.getElementById('ch-cg');
    const overlay = document.getElementById('cg-overlay');
    if (!cg || !overlay) return;
    const main = cg.querySelector('.ch-cg-main');
    const url = main.dataset.url;
    const title = main.querySelector('h2').textContent;
    const frame = document.getElementById('cg-frame');
    const label = document.getElementById('cg-overlay-title');
    const openLink = document.getElementById('cg-overlay-open');

    const play = document.getElementById('cg-play');
    if (play) play.addEventListener('click', () => window.open(url, '_blank', 'noopener'));

    const embed = document.getElementById('cg-embed');
    const show = () => {
      label.textContent = title;
      openLink.href = url;
      frame.src = url;
      overlay.hidden = false;
      document.body.style.overflow = 'hidden';
    };
    const hide = () => {
      overlay.hidden = true;
      frame.src = 'about:blank';   // 停掉里面的动画，别让它继续烧 CPU
      document.body.style.overflow = '';
    };
    if (embed) embed.addEventListener('click', show);
    document.getElementById('cg-overlay-close').addEventListener('click', hide);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !overlay.hidden) hide();
    });

    // 点侧边的小卡也走页内预览（除非用户按了 Cmd/Ctrl 想开新标签）
    cg.querySelectorAll('.ch-cg-chip').forEach((node) => {
      node.addEventListener('click', (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        main.dataset.url = node.getAttribute('href');
        const name = node.querySelector('b').textContent;
        label.textContent = name;
        openLink.href = node.getAttribute('href');
        frame.src = node.getAttribute('href');
        overlay.hidden = false;
        document.body.style.overflow = 'hidden';
      });
    });
  },

  refreshProgress() {
    const total = document.querySelectorAll('.kp').length;
    const done = document.querySelectorAll('.kp[data-done="1"]').length;
    const text = document.getElementById('ch-progress-text');
    const bar = document.getElementById('ch-progress-bar');
    if (text) text.textContent = `${done} / ${total}`;
    if (bar) bar.style.width = `${total ? Math.round(done / total * 100) : 0}%`;
  },
};

document.addEventListener('DOMContentLoaded', () => Chapter.init());
