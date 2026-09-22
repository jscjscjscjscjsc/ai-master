/* ===========================================================
   题目卡片：全站唯一的作答 / 判分 / 讲解实现
   -----------------------------------------------------------
   章节页与刷题页共用这一份。之所以要抽出来：判分链路是
   「选择题本地比对 / 主观题先 AI 评分再结算」两条不同路径，
   复制到两个页面意味着两处可能不一致 —— 学生就会看到同一个答案
   在章节页算对、在刷题页算错。

   使用方式：渲染出 .qcard 结构后调用 QCards.mount(container)。
   =========================================================== */

const QCards = {
  cards: new Map(),

  mount(root) {
    // root 可能本身就是一张卡片，也可能是卡片所在的容器。
    // 刷题页展开题面时传进来的是 .q-expand，而 .qcard 是它的父节点，
    // 只写 querySelectorAll('.qcard') 会一张都找不到 —— 按钮就变成死的。
    const scope = root || document;
    const nodes = [];
    if (scope.nodeType === 1 && scope.classList.contains('qcard')) nodes.push(scope);
    const card = scope.closest ? scope.closest('.qcard') : null;
    if (card) nodes.push(card);
    (scope.querySelectorAll ? scope.querySelectorAll('.qcard') : []).forEach((n) => nodes.push(n));
    nodes.forEach((node) => {
      if (this.cards.has(node.dataset.qid) && this.cards.get(node.dataset.qid).node === node) return;
      const entry = { node, busy: false, revealed: node.dataset.revealed === '1' };
      this.cards.set(node.dataset.qid, entry);
      node.querySelectorAll('[data-act]').forEach((button) => {
        const act = button.dataset.act;
        if (act === 'submit') button.addEventListener('click', () => this.submit(node, button));
        else if (act === 'hint') button.addEventListener('click', () => this.hint(node, button));
        else if (act === 'answer') button.addEventListener('click', () => this.reveal(node, button));
      });
    });
  },

  read(node) {
    if (node.dataset.type === 'choice') {
      const picked = node.querySelector('input[type="radio"]:checked');
      return picked ? Number(picked.value) : null;
    }
    const box = node.querySelector('.q-answer');
    return box ? box.value.trim() : '';
  },

  async submit(node, button) {
    const entry = this.cards.get(node.dataset.qid);
    if (!entry || entry.busy) return;
    const answer = this.read(node);
    if (answer === null || answer === '') { Star.toast('先作答再提交', 'bad'); return; }
    entry.busy = true;
    const type = node.dataset.type;
    const scoreBox = node.querySelector('.q-score');
    const feedback = node.querySelector('.q-feedback');

    if (type === 'choice') {
      button.disabled = true;
      try {
        const data = await Star.api('/api/training/submit', {
          body: { question_id: node.dataset.qid, answer: Number(answer) },
        });
        if (!data.success) throw new Error(data.message);
        this.paintChoice(node, Number(answer), data.reveal.answer);
        this.paintFeedback(node, data);
        this.afterSubmit(node, data);
      } catch (error) {
        Star.toast(error.message, 'bad');
      } finally {
        button.disabled = false;
        entry.busy = false;
      }
      return;
    }

    button.disabled = true;
    button.textContent = 'AI 正在批改…';
    scoreBox.hidden = false;
    scoreBox.className = 'q-score';
    scoreBox.textContent = '评分中…';
    feedback.hidden = false;
    feedback.className = 'q-feedback';
    feedback.innerHTML = '<span class="typing">正在对照标准答案要点逐条核对你的回答…</span>';
    try {
      const meta = await Star.api(`/api/training/question/${encodeURIComponent(node.dataset.qid)}`);
      const question = meta.question || {};
      const scored = await Star.api('/api/score-answer', {
        body: {
          question: question.statement || node.querySelector('.q-statement').innerText,
          answer: String(answer),
          reference: question.reference || '',
        },
      });
      if (!scored.success) throw new Error(scored.message || '评分失败');
      const verdict = await Star.api('/api/training/submit', {
        body: {
          question_id: node.dataset.qid, answer: String(answer),
          score: scored.score, feedback: scored.feedback, used_ai: true,
        },
      });
      if (!verdict.success) throw new Error(verdict.message || '结算失败');
      this.paintScore(scoreBox, scored.score);
      this.paintFeedback(node, { ...verdict, strengths: scored.strengths, weaknesses: scored.weaknesses });
      this.revealModel(node, verdict.reveal);
      this.afterSubmit(node, verdict);
    } catch (error) {
      scoreBox.hidden = true;
      feedback.innerHTML = `<span style="color:var(--rose)">${Star.esc(error.message)}</span>`;
    } finally {
      button.disabled = false;
      button.textContent = 'AI 批改';
      entry.busy = false;
    }
  },

  /* 子类可覆盖：章节页用它刷新进度条，刷题页用它更新列表状态 */
  afterSubmit(node, data) {},

  paintChoice(node, picked, correct) {
    node.querySelectorAll('.q-option').forEach((label, index) => {
      label.classList.remove('right', 'wrong');
      if (index === correct) label.classList.add('right');
      else if (index === picked) label.classList.add('wrong');
    });
  },

  paintScore(box, score) {
    box.hidden = false;
    box.textContent = `${score} 分`;
    box.className = 'q-score ' + (score >= 85 ? 'good' : score >= 60 ? 'mid' : 'bad');
  },

  paintFeedback(node, data) {
    const passed = data.verdict ? data.verdict.passed !== false : true;
    const box = node.querySelector('.q-feedback');
    box.hidden = false;
    box.className = 'q-feedback' + (passed ? '' : ' bad');
    let html = `<div>${Star.md(data.feedback || '')}</div>`;
    const strengths = data.strengths || [];
    const weaknesses = data.weaknesses || [];
    if (strengths.length || weaknesses.length) {
      html += '<div class="q-breakdown">';
      if (strengths.length) {
        html += `<div><h5>答到的地方</h5><ul>${strengths.map((s) => `<li>${Star.esc(s)}</li>`).join('')}</ul></div>`;
      }
      if (weaknesses.length) {
        html += `<div><h5>还差的</h5><ul>${weaknesses.map((s) => `<li>${Star.esc(s)}</li>`).join('')}</ul></div>`;
      }
      html += '</div>';
    }
    const settle = data.settle || {};
    if (settle.points) {
      html += `<div style="margin-top:9px;color:var(--gold);font-size:12.5px">修为 +${settle.points} · ${settle.stars} 星</div>`;
    } else if (data.guest) {
      // 游客能做题、能拿到 AI 批改，但分数不落盘 —— 这件事必须说出来，
      // 否则学生会以为系统算错了分。
      html += `<div style="margin-top:9px;font-size:12.5px">
        <span style="color:var(--muted)">游客模式不计修为。</span>
        <a href="/login" style="color:var(--cyan)">注册后</a>
        <span style="color:var(--muted)">这份成绩才会被保存。</span></div>`;
    } else if (!passed) {
      html += '<div style="margin-top:9px;color:var(--muted);font-size:12.5px">这次没通过，已记进错题本，随时能重做。</div>';
    }
    box.innerHTML = html;
    if (settle.profile && window.Cultivation) Cultivation.applySettlement(settle);
    node.dataset.solved = passed ? '1' : '0';
  },

  revealModel(node, reveal) {
    if (!reveal) return;
    const box = node.querySelector('.q-model');
    if (!box) return;
    box.hidden = false;
    let html = '<h5 style="margin:0 0 8px;font-size:12px;color:var(--muted)">标准答案要点</h5>';
    html += `<div>${Star.md(reveal.reference || '')}</div>`;
    if (reveal.solution) {
      html += `<h5 style="margin:12px 0 8px;font-size:12px;color:var(--muted)">参考实现</h5>
               <div class="md"><pre><code>${Star.esc(reveal.solution)}</code></pre></div>`;
    }
    if (reveal.explanation) {
      html += `<h5 style="margin:12px 0 8px;font-size:12px;color:var(--muted)">讲解</h5>
               <div>${Star.md(reveal.explanation)}</div>`;
    }
    box.innerHTML = html;
  },

  async reveal(node, button) {
    if (node.dataset.revealed === '1') {
      node.querySelector('.q-model').hidden = true;
      node.dataset.revealed = '0';
      button.textContent = '看参考答案';
      return;
    }
    button.disabled = true;
    try {
      const data = await Star.api(`/api/training/question/${encodeURIComponent(node.dataset.qid)}`);
      this.revealModel(node, data.question);
      node.dataset.revealed = '1';
      button.textContent = '收起答案';
      if (node.dataset.type === 'choice' && data.question.answer !== undefined) {
        this.paintChoice(node, -1, data.question.answer);
      }
    } catch (error) {
      Star.toast(error.message, 'bad');
    } finally {
      button.disabled = false;
    }
  },

  /* 卡住求助：流式思路，不给答案，也不扣分 —— 这一点很重要，
     否则学生会宁愿空着也不敢问。 */
  async hint(node, button) {
    const box = node.querySelector('.q-feedback');
    box.hidden = false;
    box.className = 'q-feedback';
    button.disabled = true;
    const original = button.textContent;
    button.textContent = '正在想…';
    box.innerHTML = '<span class="typing">星辰教练正在整理思路（只给方向，不给答案）</span>';
    try {
      await Star.stream('/api/training/ai-help', {
        question_id: node.dataset.qid,
        statement: node.querySelector('.q-statement').innerText,
        ask: '',
      }, {
        onDelta: (text) => { box.innerHTML = `<div class="md">${Star.md(text)}</div>`; },
        onStatus: (message) => { box.innerHTML = `<span class="typing">${Star.esc(message)}</span>`; },
        onError: (message) => { box.innerHTML = `<span style="color:var(--rose)">${Star.esc(message)}</span>`; },
      });
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  },

  /** 渲染一张题目卡片。三个页面（章节 / 刷题 / 组卷）共用这份模板。 */
  html(q) {
    const typeLabel = { choice: '选择题', short: '简答题', code: '代码题' }[q.type] || q.type;
    const diffLabel = ['基础', '进阶', '挑战'][q.difficulty - 1] || '基础';
    // 题干里可能是 Markdown，这里先渲染；选项是纯文本，要转义
    const statement = Star.md(q.statement || '');
    const body = q.type === 'choice'
      ? `<div class="q-options">${(q.options || []).map((option, index) => `
          <label class="q-option">
            <input type="radio" name="q-${q.id}" value="${index}">
            <span>${Star.esc(option)}</span>
          </label>`).join('')}</div>`
      : `<textarea class="q-answer" rows="5" placeholder="${q.type === 'code'
            ? '把你的代码写在这里，关键步骤加注释。'
            : '用自己的话回答 —— 讲得清楚比抄概念重要。'}"></textarea>
         ${(q.hints || []).length ? `<div class="q-hints">${q.hints.map((hint, i) =>
            `<span class="chip">提示 ${i + 1}：${Star.esc(hint)}</span>`).join('')}</div>` : ''}`;

    return `
      <div class="qcard" data-qid="${Star.esc(q.id)}" data-type="${q.type}"
           data-difficulty="${q.difficulty}" ${q.solved ? 'data-solved="1"' : ''}>
        <div class="q-head">
          <span class="q-type">${typeLabel}</span>
          <span class="q-diff d${q.difficulty}">${diffLabel}</span>
          <span class="q-title">${Star.esc(q.title)}</span>
          ${q.solved ? `<span class="chip green">${q.best_stars || 3} 星</span>` : ''}
          ${(q.wrong && !q.solved) ? '<span class="chip" style="border-color:rgba(255,157,179,.5);color:#ffd6e0">待订正</span>' : ''}
        </div>
        <div class="q-statement md">${statement}</div>
        ${body}
        <div class="q-actions">
          <button class="btn primary sm" data-act="submit">${q.type === 'choice' ? '提交答案' : 'AI 批改'}</button>
          <button class="btn sm ghost" data-act="hint">不会，给点思路</button>
          <button class="btn sm ghost" data-act="answer">看参考答案</button>
          <span class="q-score" hidden></span>
        </div>
        <div class="q-feedback" hidden></div>
        <div class="q-model" hidden></div>
      </div>`;
  },
};
