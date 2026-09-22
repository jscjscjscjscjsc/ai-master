/* ===========================================================
   刷题中心
   -----------------------------------------------------------
   和章节页共用 QCards 里的作答逻辑，这里只负责三件事：
     1. 左侧筛选（章节 / 难度 / 题型 / 错题）→ 拉题列表
     2. 列表的展开与折叠（一次只展开一张，避免长列表卡顿）
     3. 组卷模式：组卷 → 逐题作答 → 交卷 → AI 讲评
   =========================================================== */

const Training = {
  chapters: [],
  selected: new Set(),
  difficulty: '',
  type: '',
  only: '',
  questions: [],
  exam: null,
  examIndex: 0,

  async init() {
    document.querySelectorAll('#wb-difficulty button').forEach((node) => this.bindSeg(node, 'difficulty'));
    document.querySelectorAll('#wb-type button').forEach((node) => this.bindSeg(node, 'type'));
    document.querySelectorAll('[data-quick]').forEach((node) => {
      node.addEventListener('click', () => this.quick(node.dataset.quick));
    });
    document.getElementById('wb-exam-start').addEventListener('click', () => this.startExam());
    const params = new URLSearchParams(location.search);
    if (params.get('chapters')) {
      params.get('chapters').split(',').forEach((id) => this.selected.add(String(id).trim()));
    }
    await this.loadCatalog();
    if (params.get('tab') === 'exam') this.startExam();
    else await this.loadQuestions();
    this.loadQuota();
  },

  bindSeg(node, field) {
    node.addEventListener('click', () => {
      node.parentElement.querySelectorAll('button').forEach((other) => other.classList.remove('on'));
      node.classList.add('on');
      this[field] = node.dataset.value;
      this.loadQuestions();
    });
  },

  quick(kind) {
    this.selected.clear();
    if (kind === 'agent') {
      this.chapters.filter((row) => row.highlight).forEach((row) => this.selected.add(String(row.id)));
    } else if (kind === 'wrong') {
      this.only = this.only === 'wrong' ? '' : 'wrong';
      this.renderChapters();
      this.loadQuestions();
      return;
    } else {
      this.only = '';
    }
    this.renderChapters();
    this.loadQuestions();
  },

  async loadCatalog() {
    try {
      const data = await Star.api('/api/training/catalog');
      this.chapters = data.chapters || [];
      this.renderChapters();
      document.getElementById('wb-count').textContent =
        `题库共 ${data.total} 道 · 覆盖 ${this.chapters.length} 个章节`;
    } catch (error) {
      document.getElementById('wb-chapters').innerHTML = '<p style="color:var(--muted);font-size:11.5px">题库还没准备好。</p>';
    }
  },

  renderChapters() {
    const box = document.getElementById('wb-chapters');
    box.innerHTML = this.chapters.map((row) => `
      <div class="wb-chapter ${this.selected.has(String(row.id)) ? 'on' : ''} ${row.highlight ? 'hot' : ''}"
           data-id="${row.id}">
        <b>${row.icon} ${Star.esc(row.title)}</b>
        <em>${row.solved}/${row.count}</em>
      </div>`).join('') + (this.only === 'wrong'
      ? '<div class="wb-chapter on"><b>只看错题</b><em>筛选中</em></div>' : '');
    box.querySelectorAll('.wb-chapter').forEach((node) => {
      const id = node.dataset.id;
      if (!id) return;
      node.addEventListener('click', () => {
        if (this.selected.has(id)) this.selected.delete(id);
        else this.selected.add(id);
        this.renderChapters();
        this.loadQuestions();
      });
    });
  },

  async loadQuestions() {
    const list = document.getElementById('wb-list');
    list.innerHTML = '<div class="wb-empty"><b>正在取题</b>稍等一下…</div>';
    document.getElementById('wb-exam-strip').hidden = true;
    this.exam = null;
    const params = new URLSearchParams();
    if (this.selected.size) params.set('chapters', [...this.selected].join(','));
    if (this.difficulty) params.set('difficulty', this.difficulty);
    if (this.type) params.set('type', this.type);
    if (this.only) params.set('only', this.only);
    params.set('limit', '120');
    try {
      const data = await Star.api('/api/training/questions?' + params.toString());
      this.questions = data.questions || [];
      this.renderList();
    } catch (error) {
      list.innerHTML = `<div class="wb-empty"><b>取题失败</b>${Star.esc(error.message)}</div>`;
    }
  },

  renderList() {
    const list = document.getElementById('wb-list');
    if (!this.questions.length) {
      list.innerHTML = '<div class="wb-empty"><b>这个范围内没有题</b>换个章节或清掉筛选条件试试。</div>';
      document.getElementById('wb-count').textContent = '0 道题';
      return;
    }
    document.getElementById('wb-count').textContent =
      `${this.questions.length} 道题 · 点开任意一题开始做`;
    // 一次只渲染前 30 题，其余按需加载。
    // 不是性能洁癖：整页一次性铺 120 张卡片会让文档高达 12000px，
    // 滚动时空窗极多，而且超长页面在某些渲染环境下会整段丢失。
    this.shown = Math.min(30, this.questions.length);
    this.renderChunk();
  },

  renderChunk() {
    const list = document.getElementById('wb-list');
    const slice = this.questions.slice(0, this.shown);
    // 列表只渲染表头，题面等展开时再拉 —— 上百张卡片一次性渲染题面会卡。
    list.innerHTML = slice.map((q, index) => `
      <div class="qcard" data-qid="${Star.esc(q.id)}" data-type="${q.type}"
           data-difficulty="${q.difficulty}" ${q.solved ? 'data-solved="1"' : ''}>
        <div class="q-head" data-act="head" style="cursor:pointer">
          <span class="q-type">${index + 1}</span>
          <span class="q-diff d${q.difficulty}">${['基础', '进阶', '挑战'][q.difficulty - 1]}</span>
          <span class="q-title">${Star.esc(q.title)}</span>
          <span class="chip">第 ${q.chapter_id} 章</span>
          ${q.solved ? `<span class="chip green">${q.best_stars || 3} 星</span>` : ''}
          ${(q.wrong && !q.solved) ? '<span class="chip" style="border-color:rgba(255,157,179,.5);color:#ffd6e0">待订正</span>' : ''}
        </div>
        <div class="q-expand" hidden></div>
      </div>`).join('')
      + (this.shown < this.questions.length
        ? `<button class="btn" id="wb-more" style="width:100%;justify-content:center">
             继续加载（还有 ${this.questions.length - this.shown} 题）</button>`
        : '');

    list.querySelectorAll('.qcard').forEach((node) => {
      node.querySelector('[data-act="head"]').addEventListener('click', () => this.expand(node));
    });
    const more = document.getElementById('wb-more');
    if (more) {
      more.addEventListener('click', () => {
        this.shown = Math.min(this.shown + 30, this.questions.length);
        this.renderChunk();
      });
    }
  },

  async expand(node, force) {
    const box = node.querySelector('.q-expand');
    if (box.dataset.loaded === '1' && !force) {
      box.hidden = !box.hidden;
      return;
    }
    box.hidden = false;
    box.innerHTML = '<div class="wb-review"><span class="typing">正在取题面</span></div>';
    try {
      const data = await Star.api(`/api/training/question/${encodeURIComponent(node.dataset.qid)}`);
      const full = data.question;
      // 组卷模式下：未交卷可作答；已交卷只展示题面与讲评
      const finished = Boolean(this.exam && this.exam.status === 'finished');
      box.innerHTML = `<div style="padding:14px 0 4px;border-top:1px solid var(--line);margin-top:12px">
        <div class="q-statement md">${Star.md(full.statement)}</div>
        ${finished
          ? '<span class="chip gold">已交卷 · 本次讲评见下方</span>'
          : (full.type === 'choice'
              ? `<div class="q-options">${(full.options || []).map((option, index) => `
                  <label class="q-option"><input type="radio" name="q-${full.id}" value="${index}">
                  <span>${Star.esc(option)}</span></label>`).join('')}</div>`
              : `<textarea class="q-answer" rows="5" placeholder="${full.type === 'code'
                  ? '写下你的代码，关键步骤加注释。' : '用自己的话回答。'}"></textarea>
                 ${(full.hints || []).length ? `<div class="q-hints">${full.hints.map((hint, i) =>
                    `<span class="chip">提示 ${i + 1}：${Star.esc(hint)}</span>`).join('')}</div>` : ''}`)}
        <div class="q-actions">
          ${finished ? ''
            : `<button class="btn primary sm" data-act="submit">${full.type === 'choice' ? '提交答案' : 'AI 批改'}</button>
               <button class="btn sm ghost" data-act="hint">不会，给点思路</button>`}
          <button class="btn sm ghost" data-act="answer">看参考答案</button>
          <span class="q-score" hidden></span>
        </div>
        <div class="q-feedback" hidden></div>
        <div class="q-model" hidden></div>
      </div>`;
      box.dataset.loaded = '1';
      node.dataset.type = full.type;
      QCards.mount(box);
      if (this.exam) this.paintExamStrip();
    } catch (error) {
      box.innerHTML = `<div class="wb-review" style="color:var(--rose)">${Star.esc(error.message)}</div>`;
    }
  },

  /* ── 组卷 ───────────────────────────────────────────── */
  async startExam() {
    const count = Number(document.getElementById('wb-exam-count').value);
    try {
      const data = await Star.api('/api/training/exam', {
        body: { chapters: [...this.selected], count, difficulty: this.difficulty || null },
      });
      if (!data.success) throw new Error(data.message);
      this.exam = data.exam;
      this.examIndex = 0;
      this.renderExam();
    } catch (error) {
      Star.toast(error.message, 'bad');
    }
  },

  renderExam() {
    document.getElementById('wb-list').innerHTML =
      '<div class="wb-empty"><b>组卷模式</b>从上面的题号条切题，做完点「交卷」。</div>';
    document.getElementById('wb-exam-strip').hidden = false;
    this.paintExamStrip();
    this.openExamQuestion(0);
  },

  paintExamStrip() {
    if (!this.exam) return;
    const strip = document.getElementById('wb-exam-strip');
    strip.innerHTML = `
      <span class="chip gold">组卷 ${this.exam.done}/${this.exam.count}</span>
      ${this.exam.items.map((item, index) => `
        <span class="dot ${item.status !== 'todo' ? 'done' : ''} ${index === this.examIndex ? 'cur' : ''}"
              data-index="${index}" title="${Star.esc(item.title)}">${index + 1}</span>`).join('')}
      <span style="flex:1"></span>
      <button class="btn sm ghost" id="exam-refresh">刷新</button>
      <button class="btn sm primary" id="exam-finish">交卷</button>`;
    strip.querySelectorAll('.dot').forEach((node) => {
      node.addEventListener('click', () => this.openExamQuestion(Number(node.dataset.index)));
    });
    const finish = strip.querySelector('#exam-finish');
    if (finish) finish.addEventListener('click', () => this.finishExam());
    const refresh = strip.querySelector('#exam-refresh');
    if (refresh) refresh.addEventListener('click', () => this.reloadExam());
    // 已交卷就不再显示「交卷」，避免重复提交
    if (this.exam.status === 'finished') {
      if (finish) finish.remove();
      if (!strip.querySelector('#exam-review')) {
        const review = document.createElement('button');
        review.className = 'btn sm';
        review.id = 'exam-review';
        review.textContent = '查看讲评';
        review.addEventListener('click', () => this.reviewExam());
        strip.appendChild(review);
      }
    }
  },

  async reloadExam() {
    try {
      const data = await Star.api('/api/training/exam/' + encodeURIComponent(this.exam.id));
      this.exam = data.exam;
      this.paintExamStrip();
      if (this.exam.review) this.renderReview(this.exam.review);
    } catch (error) { Star.toast(error.message, 'bad'); }
  },

  async openExamQuestion(index) {
    if (!this.exam) return;
    this.examIndex = index;
    this.paintExamStrip();
    const item = this.exam.items[index];
    const list = document.getElementById('wb-list');
    list.innerHTML = `<div class="qcard" data-qid="${Star.esc(item.id)}" data-type="${item.type}"
        data-difficulty="${item.difficulty}">
      <div class="q-head">
        <span class="q-type">第 ${index + 1} / ${this.exam.count} 题</span>
        <span class="q-diff d${item.difficulty}">${['基础', '进阶', '挑战'][item.difficulty - 1]}</span>
        <span class="q-title">${Star.esc(item.title)}</span>
        <span class="chip">第 ${item.chapter_id} 章</span>
      </div>
      <div class="q-expand" hidden></div>
    </div>`;
    await this.expand(list.querySelector('.qcard'));
  },

  async finishExam() {
    try {
      const data = await Star.api(`/api/training/exam/${encodeURIComponent(this.exam.id)}/finish`,
                                  { body: {} });
      if (!data.success) throw new Error(data.message);
      this.exam = data.exam;
      this.paintExamStrip();
      Star.toast(`交卷完成 · 得分 ${this.exam.score}`, 'good');
      if (data.settle && data.settle.profile && window.Cultivation) {
        Cultivation.applySettlement(data.settle);
      }
      await this.reviewExam();
    } catch (error) {
      Star.toast(error.message, 'bad');
    }
  },

  async reviewExam() {
    const list = document.getElementById('wb-list');
    list.innerHTML = '<div class="wb-review"><span class="typing">AI 正在逐题讲评</span></div>';
    try {
      await Star.stream(`/api/training/exam/${encodeURIComponent(this.exam.id)}/review`, {}, {
        onDelta: (text) => { list.innerHTML = `<div class="wb-review"><div class="md">${Star.md(text)}</div></div>`; },
        onStatus: (message) => { list.innerHTML = `<div class="wb-review"><span class="typing">${Star.esc(message)}</span></div>`; },
        onDone: () => this.reloadExam(),
        onError: (message) => {
          list.innerHTML = `<div class="wb-review" style="color:var(--rose)">${Star.esc(message)}</div>`;
        },
      });
    } catch (error) {
      list.innerHTML = `<div class="wb-review" style="color:var(--rose)">${Star.esc(error.message)}</div>`;
    }
  },

  renderReview(text) {
    document.getElementById('wb-list').innerHTML =
      `<div class="wb-review"><h3 style="margin:0 0 10px;font-size:14px">组卷讲评</h3>
       <div class="md">${Star.md(text)}</div></div>`;
  },

  async loadQuota() {
    try {
      const data = await Star.api('/api/progress/overview');
      const stats = data.stats || {};
      document.getElementById('wb-solved').textContent = `${stats.total_solved || 0} 题通关`;
      document.getElementById('wb-points').textContent = `${stats.points || 0} 修为`;
    } catch (error) { /* 游客态下拿不到就留默认值 */ }
  },
};

/* 章节页与刷题页都用到 QCards，这里只在刷题页挂 afterSubmit 钩子 */
QCards.afterSubmit = function (node, data) {
  const list = document.getElementById('wb-list');
  if (!list || !list.contains(node)) return;
  if (Training.exam) {
    Training.reloadExam();
    return;
  }
  const card = node.closest('.qcard');
  if (card && data.verdict && data.verdict.passed) card.dataset.solved = '1';
  Training.loadQuota();
};

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('wb-list')) Training.init();
});
