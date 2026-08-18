/* ============================================================
   PyMaster — Main JavaScript
   ============================================================ */

// ==================== Particle System ====================
(function() {
  const canvas = document.getElementById('particles-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let particles = [];
  let animationId;
  const PARTICLE_COUNT = 80;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  class Particle {
    constructor() {
      this.reset();
      this.y = Math.random() * canvas.height;
      this.opacity = Math.random() * 0.5 + 0.1;
    }
    reset() {
      this.x = Math.random() * canvas.width;
      this.y = -10;
      this.size = Math.random() * 2 + 0.5;
      this.speed = Math.random() * 0.6 + 0.2;
      this.opacity = Math.random() * 0.5 + 0.1;
      this.wobble = Math.random() * Math.PI * 2;
      this.wobbleSpeed = (Math.random() - 0.5) * 0.02;
      this.wobbleAmp = Math.random() * 0.5;
    }
    update() {
      this.y += this.speed;
      this.wobble += this.wobbleSpeed;
      this.x += Math.sin(this.wobble) * this.wobbleAmp;
      if (this.y > canvas.height + 10) {
        this.reset();
        this.y = -10;
      }
    }
    draw(ctx) {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      const color = this.size > 1.5 ? '0, 212, 255' : '163, 113, 247';
      ctx.fillStyle = `rgba(${color}, ${this.opacity})`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size * 2.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${color}, ${this.opacity * 0.15})`;
      ctx.fill();
    }
  }

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push(new Particle());
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => { p.update(); p.draw(ctx); });
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 120) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(0, 212, 255, ${0.04 * (1 - dist / 120)})`;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }
    animationId = requestAnimationFrame(animate);
  }
  animate();
})();

// ==================== Toast ====================
function showToast(message, type) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3000);
}

// ==================== Auth Page Logic ====================
(function() {
  const tabBtns = document.querySelectorAll('.auth-tab');
  if (!tabBtns.length) return;
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      tabBtns.forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      const target = this.dataset.tab;
      document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
      if (target === 'login') loginForm.classList.add('active');
      else registerForm.classList.add('active');
    });
  });

  loginForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    if (!username || !password) { showToast('请填写用户名和密码', 'error'); return; }
    try {
      const res = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (data.success) { showToast('登录成功！正在跳转...', 'success'); setTimeout(() => { window.location.href = '../../transition'; }, 600); }
      else showToast(data.message, 'error');
    } catch (err) { showToast('网络错误，请稍后重试', 'error'); }
  });

  if (!registerForm || registerForm.tagName !== 'FORM') return;
  registerForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value;
    const confirm = document.getElementById('reg-password-confirm').value;
    if (!username || !password || !confirm) { showToast('请填写所有字段', 'error'); return; }
    if (username.length < 3) { showToast('用户名至少3个字符', 'error'); return; }
    if (password.length < 6) { showToast('密码至少6个字符', 'error'); return; }
    if (password !== confirm) { showToast('两次输入的密码不一致', 'error'); return; }
    try {
      const res = await fetch('/api/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (data.success) { showToast('注册成功！请登录', 'success'); tabBtns[0].click(); document.getElementById('login-username').value = username; registerForm.reset(); }
      else showToast(data.message, 'error');
    } catch (err) { showToast('网络错误，请稍后重试', 'error'); }
  });
})();

// ==================== Chapter Page Logic ====================
(function() {
  const tabs = document.querySelectorAll('.section-tab');
  if (!tabs.length) return;
  tabs.forEach(tab => {
    tab.addEventListener('click', function() {
      tabs.forEach(t => t.classList.remove('active'));
      this.classList.add('active');
      const target = this.dataset.panel;
      document.getElementById('knowledge-panel').classList.toggle('active', target === 'knowledge');
      const ep = document.getElementById('exercise-panel');
      if (ep) ep.classList.toggle('active', target === 'exercise');
    });
  });
})();

function toggleKP(header) {
  const item = header.parentElement;
  item.classList.toggle('open');
}

// Open and focus a knowledge point when arriving from the knowledge universe.
(function focusLinkedKnowledgePoint() {
  const params = new URLSearchParams(window.location.search);
  const index = params.get('kp');
  if (index === null) return;
  const reveal = () => {
    const safeIndex = String(index).replace(/[^0-9]/g, '');
    const item = document.querySelector(`.kp-item[data-kp-index="${safeIndex}"]`);
    if (!item) return;
    item.scrollIntoView({ behavior: 'smooth', block: 'start' });
    item.classList.add('star-arrival');
    if (item.classList.contains('unlocked')) item.classList.add('open');
    else if (typeof showToast === 'function') showToast('这颗星球尚未解锁，请先完成前置知识', 'error');
    window.setTimeout(() => item.classList.remove('star-arrival'), 3600);
  };
  window.setTimeout(reveal, 180);
})();

// ==================== Learning System ====================

// --- Choice Exercise ---
function submitChoiceEx(btn, chapterId, kpIndex, exIndex) {
  const card = btn.closest('.kp-exercise');
  const selected = card.querySelector('.ex-option.selected');
  if (!selected) { showToast('请先选择一个答案', 'error'); return; }
  if (card.dataset.exSubmitted === 'true') { showToast('已完成此题', 'error'); return; }

  const optionsDiv = card.querySelector('.ex-options');
  const correctIdx = parseInt(optionsDiv.dataset.correct);
  const chosenIdx = parseInt(selected.dataset.opt);
  const allOpts = card.querySelectorAll('.ex-option');
  const question = card.querySelector('.ex-question')?.textContent || '';
  const optLabels = ['A','B','C','D'];

  card.dataset.exSubmitted = 'true';
  btn.disabled = true;

  allOpts.forEach((opt, i) => {
    opt.style.pointerEvents = 'none';
    if (i === correctIdx) opt.classList.add('correct');
  });

  const correctAnswer = optLabels[correctIdx];
  const userAnswer = optLabels[chosenIdx];

  if (chosenIdx === correctIdx) {
    selected.classList.add('correct');
    showToast('✅ 回答正确！', 'success');
    fetch('/api/submit-answer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapter_id: chapterId, kp_index: kpIndex, ex_index: exIndex,
        correct: true, question, user_answer: userAnswer, correct_answer: correctAnswer })
    });
    checkKPCompletion(chapterId, kpIndex, card);
  } else {
    selected.classList.add('wrong');
    showToast('❌ 回答错误，已记录到错题本', 'error');
    fetch('/api/submit-answer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapter_id: chapterId, kp_index: kpIndex, ex_index: exIndex,
        correct: false, question, user_answer: userAnswer, correct_answer: correctAnswer })
    });
  }
}

function showExAnswer(btn) {
  const card = btn.closest('.kp-exercise');
  const answerDiv = card.querySelector('.ex-answer');
  const optionsDiv = card.querySelector('.ex-options');
  const correctIdx = parseInt(optionsDiv.dataset.correct);

  if (card.dataset.exSubmitted !== 'true') {
    card.querySelectorAll('.ex-option').forEach((opt, i) => {
      opt.style.pointerEvents = 'none';
      if (i === correctIdx) opt.classList.add('correct');
    });
  }
  answerDiv.style.display = answerDiv.style.display === 'none' ? 'block' : 'none';
  btn.textContent = answerDiv.style.display === 'block' ? '收起解析' : '查看解析';
}

// --- Code Exercise ---
let codeExState = { chapterId: null, kpIndex: null, exIndex: null };

function openCodeEx(chapterId, kpIndex, exIndex, prompt) {
  codeExState = { chapterId, kpIndex, exIndex };
  document.getElementById('code-ex-prompt').textContent = '💡 ' + prompt;
  document.getElementById('code-ex-editor').value = '# 在这里编写你的 Python 代码\n';
  document.getElementById('code-ex-output').innerHTML = '';
  document.getElementById('code-ex-status').textContent = '';
  document.getElementById('code-ex-modal').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeCodeEx() {
  document.getElementById('code-ex-modal').classList.remove('active');
  document.body.style.overflow = '';
}

async function runCodeEx() {
  const editor = document.getElementById('code-ex-editor');
  const output = document.getElementById('code-ex-output');
  const status = document.getElementById('code-ex-status');
  const code = editor.value.trim();

  if (!code) { showToast('请先编写代码', 'error'); return; }

  status.textContent = '运行中...';
  status.style.color = 'var(--text-muted)';
  output.innerHTML = '<div style="color:var(--text-muted);">运行中...</div>';

  try {
    const kpItem = document.querySelector(`.kp-item[data-kp-index="${codeExState.kpIndex}"]`);
    const kpTitle = kpItem ? kpItem.querySelector('.kp-title')?.textContent?.trim() || '' : '';
    const res = await fetch('/api/run-code', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, kp_title: kpTitle })
    });
    const data = await res.json();

    if (data.success && data.exit_code === 0) {
      let simBadge = '';
      if (data.simulated) {
        simBadge = '<div style="font-size:12px;color:var(--amber);margin-bottom:8px;">🤖 AI 模拟执行（环境缺少部分库，已根据代码逻辑模拟输出）</div>';
      }
      output.innerHTML = '<div style="color:var(--green);">✅ 运行成功！\n\n' + simBadge + escapeHtml(data.output) + '</div>';
      status.textContent = '⏳ AI评分中...';
      status.style.color = 'var(--cyan)';

      // Get KP title from DOM
      const kpItem = document.querySelector(`.kp-item[data-kp-index="${codeExState.kpIndex}"]`);
      const kpTitle = kpItem ? kpItem.querySelector('.kp-title')?.textContent?.trim() || '' : '';
      const promptText = document.getElementById('code-ex-prompt')?.textContent?.replace('💡 ', '') || '';

      // AI Scoring — 带超时保护的评分流程
      output.innerHTML += '<div id="score-status" style="color:var(--cyan);margin-top:8px;">🤖 AI 正在评分中，请稍候...</div>';
      let score = 70, feedback = '', strengths = '', weaknesses = '';
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 45000); // 45s 前端超时
        const scoreRes = await fetch('/api/score-code', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kp_title: kpTitle, code, output: data.output,
            prompt: promptText
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        const scoreData = await scoreRes.json();
        if (scoreData.success) {
          score = scoreData.score;
          feedback = scoreData.feedback;
          strengths = scoreData.strengths;
          weaknesses = scoreData.weaknesses;
        }
      } catch (e) {
        // 评分超时或失败：使用默认分数，不阻塞完成流程
        if (e.name === 'AbortError') {
          feedback = '⏱ AI评分超时，但你的代码已成功运行！';
        } else {
          feedback = '🎉 代码运行成功！（AI评分暂不可用，但不影响完成）';
        }
      }
      // 移除评分状态提示
      var scoreStatus = document.getElementById('score-status');
      if (scoreStatus) scoreStatus.remove();

      // Show score animation
      showScoreAnimation(score, feedback, strengths, weaknesses);

      if (score >= 60) {
        status.textContent = `✅ ${score}分 通过！`;
        status.style.color = 'var(--green)';
        showToast(`🎉 AI评分 ${score}分，知识点已标记完成`, 'success');

        fetch('/api/submit-answer', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chapter_id: codeExState.chapterId,
            kp_index: codeExState.kpIndex, ex_index: codeExState.exIndex,
            correct: true, question: '代码练习: ' + codeExState.chapterId + '_' + codeExState.kpIndex,
            user_answer: '代码运行成功', correct_answer: '代码运行成功' })
        });

        await completeKP(codeExState.chapterId, codeExState.kpIndex);

        const card = document.querySelector(
          `.kp-item[data-kp-index="${codeExState.kpIndex}"] .kp-exercise[data-ex-idx="${codeExState.exIndex}"]`
        );
        if (card) {
          card.dataset.exSubmitted = 'true';
          const resultDiv = card.querySelector('.code-result');
          if (resultDiv) resultDiv.style.display = 'block';
          const btn = card.querySelector('.btn-code-ex');
          if (btn) { btn.textContent = `✅ ${score}分`; btn.disabled = true; btn.style.opacity = '0.6'; }
          checkKPCompletion(codeExState.chapterId, codeExState.kpIndex, card);
        }

        setTimeout(closeCodeEx, 2000);
      } else {
        status.textContent = `❌ ${score}分 未通过`;
        status.style.color = 'var(--red)';
        showToast(`AI评分 ${score}分，未达到60分及格线，请完善代码后重试`, 'error');
      }
    } else {
      let errMsg = data.error || data.output || '执行出错';
      output.innerHTML = '<div style="color:var(--red);">❌ 执行失败\n\n' + escapeHtml(errMsg) + '</div>';
      status.textContent = '❌ 执行失败';
      status.style.color = 'var(--red)';
    }
  } catch (err) {
    output.innerHTML = '<div style="color:var(--red);">❌ 网络错误: ' + err.message + '</div>';
    status.textContent = '❌ 错误';
    status.style.color = 'var(--red)';
  }
}

// --- KP Completion ---
async function completeKP(chapterId, kpIndex) {
  try {
    await fetch('/api/complete-kp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapter_id: chapterId, kp_index: kpIndex })
    });
  } catch (e) {}
}

function checkKPCompletion(chapterId, kpIndex, exerciseCard) {
  const kpItem = exerciseCard.closest('.kp-item');
  const allExercises = kpItem.querySelectorAll('.kp-exercise');
  let allDone = true;

  allExercises.forEach(ex => {
    if (ex.dataset.exSubmitted !== 'true') allDone = false;
  });

  if (allDone) {
    // Also update server-side completed_kps
    completeKP(chapterId, kpIndex);
    kpItem.classList.add('completed');
    // Add done badge
    let badge = kpItem.querySelector('.kp-done-badge');
    if (!badge) {
      const actions = kpItem.querySelector('.kp-actions');
      if (actions) {
        badge = document.createElement('span');
        badge.className = 'kp-done-badge';
        badge.textContent = '✅ 已完成';
        actions.appendChild(badge);
      }
    }
    // Update the indicator
    const indicator = kpItem.querySelector('.kp-indicator');
    if (indicator) indicator.textContent = '✅';

    // Unlock next KP
    const nextItem = kpItem.nextElementSibling;
    if (nextItem && nextItem.classList.contains('kp-item')) {
      nextItem.classList.remove('locked');
      nextItem.classList.add('unlocked');
      const nextHeader = nextItem.querySelector('.kp-header');
      if (nextHeader) {
        const titleSpan = nextHeader.querySelector('.kp-title span:first-child');
        if (titleSpan) titleSpan.style.color = 'var(--cyan)';
        const lockIcon = nextHeader.querySelector('.kp-indicator');
        if (lockIcon && lockIcon.textContent === '🔒') lockIcon.textContent = '▼';
      }
      const lockOverlay = nextItem.querySelector('.kp-locked-overlay');
      if (lockOverlay) lockOverlay.remove();
      // Show real content (already in DOM, just hidden)
      const bodyInner = nextItem.querySelector('.kp-body-inner');
      if (bodyInner) bodyInner.style.display = '';
      // Fix header onclick so it toggles instead of showing locked toast
      if (nextHeader) nextHeader.onclick = function() { toggleKP(this); };
    }

    showToast('🎉 恭喜完成本知识点！', 'success');

    // Check chapter completion via server data (more reliable than DOM)
    checkChapterComplete(chapterId);
  }
}

async function checkChapterComplete(chapterId) {
  // 判断是否最后一个KP被完成（只要做完最后一题就触发星辰启示）
  const allKpItems = document.querySelectorAll('.kp-item');
  if (allKpItems.length === 0) return;

  const lastKpItem = allKpItems[allKpItems.length - 1];
  const isLastKpCompleted = lastKpItem.classList.contains('completed');

  if (isLastKpCompleted) {
    showToast('🌌 最后一题完成！即将进入星辰启示...', 'success');
    setTimeout(() => {
      window.location.href = '../revelation_cg.html?ch=' + chapterId;
    }, 1500);
  }
}

// --- Favorites ---
async function toggleFav(chapterId, exIndex, question) {
  try {
    const res = await fetch('/api/toggle-favorite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapter_id: chapterId, ex_index: exIndex, question })
    });
    const data = await res.json();
    if (data.success) {
      const stars = document.querySelectorAll('.btn-fav-star');
      stars.forEach(s => {
        if (s.closest('[data-ex-idx]')?.dataset.exIdx === String(exIndex)) {
          s.textContent = data.is_favorite ? '⭐' : '☆';
          s.title = data.is_favorite ? '取消收藏' : '收藏';
        }
      });
      showToast(data.is_favorite ? '⭐ 已收藏' : '取消收藏', 'success');
    }
  } catch (e) {}
}

async function showFavorites() {
  const modal = document.getElementById('fav-modal');
  const list = document.getElementById('fav-list');
  if (!modal || !list) return;

  try {
    const res = await fetch('/api/user');
    const data = await res.json();
    const favs = data.favorites || [];

    if (favs.length === 0) {
      list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">📭 还没有收藏的题目</div>';
    } else {
      list.innerHTML = favs.map(f =>
        `<div class="fav-item">
          <span class="fav-icon">⭐</span>
          <span class="fav-text">${escapeHtml(f.question.substring(0, 60))}${f.question.length > 60 ? '...' : ''}</span>
        </div>`
      ).join('');
    }
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  } catch (e) {
    list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--red);">加载失败</div>';
    modal.classList.add('active');
  }
}

// --- Wrong Answer Book ---
async function showWrongBook() {
  const modal = document.getElementById('wrong-modal');
  const list = document.getElementById('wrong-list');
  if (!modal || !list) return;

  try {
    const res = await fetch('/api/user');
    const data = await res.json();
    const wrong = data.wrong_answers || [];

    if (wrong.length === 0) {
      list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">🎉 暂无错题，继续保持！</div>';
    } else {
      list.innerHTML = wrong.map((w, i) =>
        `<div class="wrong-item">
          <div class="wrong-question">${escapeHtml(w.question.substring(0, 80))}</div>
          <div class="wrong-detail">
            <span class="wrong-tag wrong-user">你的答案: ${escapeHtml(w.user_answer || '代码练习')}</span>
            <span class="wrong-tag wrong-correct">正确答案: ${escapeHtml(w.correct_answer || '运行成功')}</span>
          </div>
          <button class="btn-wrong-dismiss" onclick="dismissWrong(${i})">✕ 移除</button>
        </div>`
      ).join('');
    }
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  } catch (e) {
    list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--red);">加载失败</div>';
    modal.classList.add('active');
  }
}

async function dismissWrong(index) {
  try {
    await fetch('/api/clear-wrong', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ indices: [index] })
    });
    showToast('错题已移除', 'success');
    showWrongBook();
  } catch (e) {}
}

// --- Notes ---
function toggleNotes(btn) {
  const editor = btn.parentElement.querySelector('.kp-notes-editor');
  if (editor) {
    const isVisible = editor.style.display !== 'none';
    editor.style.display = isVisible ? 'none' : 'block';
    btn.textContent = isVisible ? '📝 我的笔记' : '📝 收起笔记';

    // Load existing note
    if (!isVisible) {
      const textarea = editor.querySelector('.kp-notes-textarea');
      const kpKey = textarea.dataset.kpKey;
      loadNote(kpKey, textarea);
    }
  }
}

async function loadNote(kpKey, textarea) {
  try {
    const res = await fetch('/api/user');
    const data = await res.json();
    const notes = data.notes || {};
    if (notes[kpKey]) textarea.value = notes[kpKey];
  } catch (e) {}
}

async function saveNote(chapterId, kpIndex, btn) {
  const editor = btn.closest('.kp-notes-editor');
  const textarea = editor.querySelector('.kp-notes-textarea');
  const hint = editor.querySelector('.notes-saved-hint');
  const content = textarea.value;

  try {
    const res = await fetch('/api/save-note', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapter_id: chapterId, kp_index: kpIndex, content })
    });
    const data = await res.json();
    if (data.success) {
      if (hint) { hint.style.display = 'inline'; setTimeout(() => { hint.style.display = 'none'; }, 2000); }
      showToast('📝 笔记已保存', 'success');
    }
  } catch (e) {
    showToast('保存失败', 'error');
  }
}

// --- Mode Toggle ---
async function toggleMode() {
  const checkbox = document.getElementById('mode-toggle');
  const label = document.getElementById('mode-label');
  const newMode = checkbox.checked ? 'all_unlocked' : 'explore';

  try {
    const res = await fetch('/api/set-mode', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: newMode })
    });
    const data = await res.json();
    if (data.success) {
      label.textContent = newMode === 'all_unlocked' ? '🔓 全部解锁' : '🔒 探索模式';
      showToast(newMode === 'all_unlocked' ? '🔓 已切换为全部解锁模式' : '🔒 已切换为探索模式', 'success');
      // Reload to refresh chapter lock states
      setTimeout(() => location.reload(), 800);
    }
  } catch (e) {}
}

// --- Modal helpers ---
function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

// Close modals on Escape
document.addEventListener('keydown', function(e) {
  // Prevent Doubao extension from hijacking Ctrl+A
  if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
    e.stopImmediatePropagation();
  }
  if (e.key === 'Escape') {
    closeModal('fav-modal');
    closeModal('wrong-modal');
    const codeEx = document.getElementById('code-ex-modal');
    if (codeEx && codeEx.classList.contains('active')) closeCodeEx();
  }
  // Left/Right arrow for comic
  const comicOverlay = document.getElementById('comic-overlay');
  if (comicOverlay && comicOverlay.classList.contains('active')) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); navigateComic(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); navigateComic(1); }
  }
});

// ---- Exercise option click (inside chapter page) ----
(function() {
  document.addEventListener('click', function(e) {
    const opt = e.target.closest('.ex-option');
    if (!opt) return;
    const card = opt.closest('.kp-exercise');
    if (!card || card.dataset.exSubmitted === 'true') return;
    card.querySelectorAll('.ex-option').forEach(o => o.classList.remove('selected'));
    opt.classList.add('selected');
  });
})();

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==================== Comic Viewer ====================
let comicState = {
  panels: [], currentPanel: 0, chapterId: null, kpIndex: null, kpTitle: null
};

async function openComic(chapterId, kpIndex, kpTitle) {
  comicState.chapterId = chapterId; comicState.kpIndex = kpIndex; comicState.kpTitle = kpTitle; comicState.currentPanel = 0;
  const overlay = document.getElementById('comic-overlay');
  const panelsContainer = document.getElementById('comic-panels');
  const nav = document.getElementById('comic-nav');
  const bottom = document.getElementById('comic-bottom');
  const settingsHint = document.getElementById('comic-settings-hint');
  const autoPlayWrap = document.getElementById('comic-autoplay-wrap');
  const badge = document.getElementById('comic-badge');
  panelsContainer.innerHTML = `<div class="comic-loading"><div class="loading-spinner"></div><p>正在生成漫画讲解...</p><p class="loading-sub">蛇蛇老师和同学正在创作中 🎨</p></div>`;
  nav.style.display = 'none'; bottom.style.display = 'none'; autoPlayWrap.style.display = 'none'; settingsHint.style.display = 'none';
  overlay.classList.add('active'); document.body.style.overflow = 'hidden';
  try {
    const res = await fetch(`/api/comic/${chapterId}/${kpIndex}`);
    const data = await res.json();
    if (!data.success) { panelsContainer.innerHTML = `<div class="comic-loading"><p>😔 ${data.message || '生成失败，请稍后重试'}</p></div>`; return; }
    const comic = data.comic; comicState.panels = comic.panels;
    document.getElementById('comic-title').textContent = comic.title;
    badge.textContent = `共 ${comic.total_panels} 格`;
    renderComicPanels(); nav.style.display = 'flex'; bottom.style.display = 'flex';
    document.getElementById('comic-autoplay-wrap').style.display = 'flex';
    if (!comic.has_api) settingsHint.style.display = 'block';
  } catch (err) { panelsContainer.innerHTML = `<div class="comic-loading"><p>😔 网络错误，请稍后重试</p></div>`; }
}

function renderComicPanels() {
  const container = document.getElementById('comic-panels');
  container.innerHTML = comicState.panels.map((p, i) => {
    const charClass = `${p.character}-panel`;
    return `<div class="comic-panel ${charClass}" data-panel="${i}" style="display:${i === comicState.currentPanel ? 'flex' : 'none'};animation-delay:${i * 0.05}s">
      <div class="comic-avatar">${p.avatar}</div>
      <div class="comic-bubble">
        <div class="bubble-name">${p.character_name}<button class="btn-voice" data-panel-idx="${i}" onclick="event.stopPropagation();speakPanel(${i})" title="🔊 语音播报">🔊</button></div>
        <div class="bubble-text">${escapeHtml(p.dialog)}</div>
        <div class="bubble-expression">${getExpressionEmoji(p.expression)} ${getExpressionLabel(p.expression)}</div>
        ${p.knowledge_bite ? `<span class="bubble-knowledge">💡 ${escapeHtml(p.knowledge_bite)}</span>` : ''}
      </div>
      <div class="comic-scene">📍 ${getSceneEmoji(p.scene)} ${getSceneLabel(p.scene)}</div>
    </div>`;
  }).join('');
  updateComicNav();
}

// ==================== Voice / TTS ====================
let currentSpeech = null, isSpeaking = false, cachedChineseVoices = [];

function initVoices() {
  const loadVoices = () => {
    const all = speechSynthesis.getVoices();
    cachedChineseVoices = all.filter(v => v.lang.startsWith('zh') || v.lang === 'zh-CN' || v.lang === 'zh-TW');
    if (cachedChineseVoices.length === 0) cachedChineseVoices = all.filter(v => v.name.includes('Chinese') || v.name.includes('Microsoft Huihui') || v.name.includes('Microsoft Kangkang') || v.name.includes('Yaoyao') || v.name.includes('Tingting'));
  };
  loadVoices(); speechSynthesis.onvoiceschanged = loadVoices;
}
if (typeof speechSynthesis !== 'undefined') initVoices();

function speakPanel(panelIdx) {
  const panel = comicState.panels[panelIdx]; if (!panel) return;
  if (isSpeaking) { stopSpeak(); if (currentSpeech && currentSpeech._panelIdx === panelIdx) { currentSpeech = null; updateAllVoiceButtons(); return; } }
  const text = panel.dialog.replace(/[\u{1F000}-\u{1FFFF}]/gu,'').replace(/[\u{1F300}-\u{1F9FF}]/gu,'').replace(/[☀-➿]/gu,'').replace(/\*\*/g,'').replace(/`/g,'').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
  if (!text || text.length < 2) return;
  const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'zh-CN'; utterance.volume = 1.0;
  switch(panel.character){case'student':utterance.rate=1.2;utterance.pitch=1.3;break;case'narrator':utterance.rate=0.9;utterance.pitch=0.95;break;default:utterance.rate=1.0;utterance.pitch=1.05;break;}
  const voices = speechSynthesis.getVoices();
  if (voices.length > 0 && cachedChineseVoices.length === 0) cachedChineseVoices = voices.filter(v => v.lang.startsWith('zh') || v.lang === 'zh-CN' || v.lang === 'zh-TW' || v.name.includes('Chinese') || v.name.includes('Huihui') || v.name.includes('Kangkang') || v.name.includes('Yaoyao'));
  if (cachedChineseVoices.length > 0) { if (panel.character === 'student') { const female = cachedChineseVoices.find(v => v.name.includes('female')||v.name.includes('Female')||v.name.includes('Huihui')||v.name.includes('Yaoyao')||v.name.includes('Tingting')); utterance.voice = female || cachedChineseVoices[0]; } else { const male = cachedChineseVoices.find(v => v.name.includes('male')||v.name.includes('Male')||v.name.includes('Kangkang')); utterance.voice = male || cachedChineseVoices[0]; } }
  utterance._panelIdx = panelIdx; tryServerTTS(panelIdx, text, panel.character);
}

async function tryServerTTS(panelIdx, text, character) {
  const panel = comicState.panels[panelIdx]; const chId = comicState.chapterId; const kpId = comicState.kpIndex; const pId = panel.panel_id;
  try {
    const statusRes = await fetch('/api/tts/status'); const statusData = await statusRes.json();
    if (!statusData.edge_tts_available && !statusData.doubao_available) { const u = new SpeechSynthesisUtterance(text); u.lang='zh-CN'; u._panelIdx=panelIdx; speakWithBrowserTTS(u,panelIdx); return; }
    const url = `/api/tts/panel/${chId}/${kpId}/${pId}`; const audio = new Audio(url); audio._panelIdx = panelIdx;
    audio.onplay = () => { isSpeaking=true; currentSpeech=audio; updateAllVoiceButtons(); };
    audio.onended = () => { isSpeaking=false; currentSpeech=null; updateAllVoiceButtons(); const autoPlay=document.getElementById('comic-autoplay'); if(autoPlay&&autoPlay.checked){const next=panelIdx+1;if(next<comicState.panels.length){setTimeout(()=>{navigateComic(1);setTimeout(()=>speakPanel(next),500);},600);}} };
    audio.onerror = () => { isSpeaking=false; currentSpeech=null; const u=new SpeechSynthesisUtterance(text); u.lang='zh-CN'; u._panelIdx=panelIdx; speakWithBrowserTTS(u,panelIdx); };
    audio.play().catch(() => { const u=new SpeechSynthesisUtterance(text); u.lang='zh-CN'; u._panelIdx=panelIdx; speakWithBrowserTTS(u,panelIdx); });
  } catch(e) { const u=new SpeechSynthesisUtterance(text); u.lang='zh-CN'; u._panelIdx=panelIdx; speakWithBrowserTTS(u,panelIdx); }
}

function speakWithBrowserTTS(utterance, panelIdx) {
  utterance.onstart = () => { isSpeaking=true; currentSpeech=utterance; updateAllVoiceButtons(); };
  utterance.onend = () => { isSpeaking=false; currentSpeech=null; updateAllVoiceButtons(); const next=panelIdx+1; if(next<comicState.panels.length){const ap=document.getElementById('comic-autoplay'); if(ap&&ap.checked){setTimeout(()=>{navigateComic(1);setTimeout(()=>speakPanel(next),400);},600);}} };
  utterance.onerror = (e) => { if(e.error!=='interrupted')console.warn('TTS error:',e.error); isSpeaking=false; currentSpeech=null; updateAllVoiceButtons(); };
  speechSynthesis.speak(utterance);
}

function stopSpeak() { speechSynthesis.cancel(); if(currentSpeech){if(currentSpeech instanceof Audio){currentSpeech.pause();currentSpeech.currentTime=0;}} isSpeaking=false; currentSpeech=null; updateAllVoiceButtons(); const ap=document.getElementById('comic-autoplay'); if(ap&&ap.checked)ap.checked=false; }
function updateAllVoiceButtons() { document.querySelectorAll('.btn-voice').forEach(b=>{const i=parseInt(b.dataset.panelIdx);const a=currentSpeech&&currentSpeech._panelIdx===i;b.classList.toggle('speaking',a);b.textContent=a?'🔊':'🔊';b.title=a?'⏹ 停止':'🔊 语音播报';}); }
function updateComicNav() { document.getElementById('comic-prev').disabled=comicState.currentPanel<=0; document.getElementById('comic-next').disabled=comicState.currentPanel>=comicState.panels.length-1; document.getElementById('comic-counter').textContent=`${comicState.currentPanel+1} / ${comicState.panels.length}`; }
function navigateComic(delta) { const n=comicState.currentPanel+delta; if(n<0||n>=comicState.panels.length)return; const ce=document.querySelector(`.comic-panel[data-panel="${comicState.currentPanel}"]`); if(ce)ce.style.display='none'; comicState.currentPanel=n; const ne=document.querySelector(`.comic-panel[data-panel="${n}"]`); if(ne){ne.style.display='flex';ne.style.animation='none';ne.offsetHeight;ne.animation='panelSlideIn 0.4s ease both';} updateComicNav(); document.querySelector('.comic-container').scrollTo({top:ne.offsetTop-100,behavior:'smooth'}); }
function restartComic() { comicState.currentPanel=0; document.querySelectorAll('.comic-panel').forEach((e,i)=>{e.style.display=i===0?'flex':'none';}); updateComicNav(); document.querySelector('.comic-container').scrollTo({top:0,behavior:'smooth'}); }
function closeComic() { stopSpeak(); document.getElementById('comic-autoplay').checked=false; document.getElementById('comic-overlay').classList.remove('active'); document.body.style.overflow=''; comicState.panels=[]; comicState.currentPanel=0; }

// ==================== Comic Settings ====================
function showComicSettings() { document.getElementById('comic-settings-modal').style.display='flex'; }
function closeComicSettings() { document.getElementById('comic-settings-modal').style.display='none'; }
async function saveComicConfig() {
  const k=document.getElementById('comic-api-key').value.trim(); const b=document.getElementById('comic-api-base').value.trim(); const m=document.getElementById('comic-model').value.trim();
  if(!k){showToast('请填写 API Key','error');return;}
  try{const r=await fetch('/api/comic/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_key:k,api_base:b,model:m||'gpt-4o'})});const d=await r.json();if(d.success){showToast('配置已保存！','success');closeComicSettings();document.getElementById('comic-settings-hint').style.display='none';}else showToast('配置保存失败','error');}catch(e){showToast('网络错误','error');}
}

// ==================== Comic Helpers ====================
function getExpressionEmoji(e){const m={'explaining':'📝','thinking':'🤔','surprised':'😮','happy':'😊','questioning':'🙋','excited':'🤩','inspired':'💡'};return m[e]||'💬';}
function getExpressionLabel(e){const m={'explaining':'认真讲解中','thinking':'思考中','surprised':'感到惊讶','happy':'开心','questioning':'举手提问','excited':'兴奋','inspired':'恍然大悟'};return m[e]||e;}
function getSceneEmoji(s){const m={'classroom':'🏫','coding_lab':'💻','thought_bubble':'💭','whiteboard':'📋','computer_screen':'🖥️'};return m[s]||'📍';}
function getSceneLabel(s){const m={'classroom':'教室','coding_lab':'编程实验室','thought_bubble':'思考','whiteboard':'白板','computer_screen':'电脑屏幕'};return m[s]||s;}

// ==================== Mindmap ====================
let mindmapInstance = null, mindmapSvg = null;
async function openMindmap() {
  const overlay=document.getElementById('mindmap-overlay'); overlay.classList.add('active'); document.body.style.overflow='hidden';
  const mdData=document.getElementById('mindmap-data'); if(!mdData)return;
  const svg=document.getElementById('mindmap-svg'); svg.innerHTML='';
  try{const{Transformer}=window.markmap;const{Markmap}=window.markmap;const t=new Transformer();const{root}=t.transform(mdData.textContent);mindmapInstance=Markmap.create(svg,{autoFit:true,color:()=>getComputedStyle(document.body).getPropertyValue('--sector').trim()||'#72f6e4',colorFreezeLevel:1,duration:600,maxInitialScale:1.05,initialExpandLevel:3,spacingHorizontal:110,spacingVertical:14,paddingX:14,pan:true,zoom:true},root);mindmapSvg=svg;mindmapInstance.fit();}catch(e){svg.innerHTML='<div style="color:var(--text-secondary);text-align:center;padding:60px;">思维导图加载失败，请刷新重试</div>';}
}
function closeMindmap(){document.getElementById('mindmap-overlay').classList.remove('active');document.body.style.overflow='';}
function mindmapZoomIn(){if(mindmapInstance)mindmapInstance.rescale(1.3);}
function mindmapZoomOut(){if(mindmapInstance)mindmapInstance.rescale(0.7);}
function mindmapReset(){if(mindmapInstance)mindmapInstance.fit();}
function mindmapExpandAll(){if(mindmapInstance){mindmapInstance.setData(mindmapInstance.state.data);mindmapInstance.fit();}}
function mindmapCollapseAll(){if(!mindmapInstance)return;const cn=(n)=>{if(n.c){n.p={...n.p,f:true};n.c.forEach(cn);}};try{const d=JSON.parse(JSON.stringify(mindmapInstance.state.data));d.p={...d.p,f:true};if(d.c)d.c.forEach(cn);mindmapInstance.setData(d);}catch(e){}}

// ==================== JJ老师 AI Chat ====================
let jjCodeContext = '';
function toggleJJChat(){const o=document.getElementById('jj-chat-overlay');if(o)o.classList.toggle('active');if(o&&o.classList.contains('active'))setTimeout(()=>document.getElementById('jj-input').focus(),200);}
function askJJAboutExercise(question){jjCodeContext=question;const o=document.getElementById('jj-chat-overlay');if(o)o.classList.add('active');const i=document.getElementById('jj-input');if(i){i.value='这道题我不太懂，能帮我分析一下吗？';i.focus();}}
async function sendJJMessage() {
  const input=document.getElementById('jj-input');const btn=document.getElementById('jj-send-btn');const msgDiv=document.getElementById('jj-messages');const typing=document.getElementById('jj-typing');const q=(input.value||'').trim();
  if(!q||btn.disabled)return;
  const u=document.createElement('div');u.className='msg user';u.textContent=q;msgDiv.appendChild(u);input.value='';msgDiv.scrollTop=msgDiv.scrollHeight;
  btn.disabled=true;typing.style.display='block';msgDiv.scrollTop=msgDiv.scrollHeight;
  try{const body={question:q};if(jjCodeContext){body.context=jjCodeContext;jjCodeContext='';}const r=await fetch('/api/ask-jj',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();typing.style.display='none';const j=document.createElement('div');j.className='msg jj';j.innerHTML=d.success?formatJJAnswer(d.answer):'😔 '+(d.error||'出错了，请稍后重试');msgDiv.appendChild(j);msgDiv.scrollTop=msgDiv.scrollHeight;}catch(e){typing.style.display='none';const e2=document.createElement('div');e2.className='msg jj';e2.textContent='😔 网络错误，请检查网络连接后重试';msgDiv.appendChild(e2);}finally{btn.disabled=false;input.focus();}
}
function formatJJAnswer(text){return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/```(\w*)\n?([\s\S]*?)```/g,'<pre><code>$2</code></pre>').replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');}

// ==================== JJ Auto Chapter Guide & Completion ====================

async function autoJJChapterGuide() {
  // Check if this chapter has any progress — if no KPs completed, it's a fresh start
  const hasAnyProgress = COMPLETED_KPS.some(k => k.startsWith(CHAPTER_ID + '_'));
  if (hasAnyProgress) return;
  if (typeof CHAPTER_KP_TITLES === 'undefined') return;

  try {
    const res = await fetch('/api/jj-chapter-guide', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapter_id: CHAPTER_ID, chapter_title: CHAPTER_TITLE, kp_titles: CHAPTER_KP_TITLES })
    });
    const data = await res.json();
    if (!data.success) return;

    // Show JJ chat with the guide
    const msgDiv = document.getElementById('jj-messages');
    const typing = document.getElementById('jj-typing');
    const jjBtn = document.getElementById('btn-jj-float');
    if (msgDiv) {
      const guideMsg = document.createElement('div');
      guideMsg.className = 'msg jj';
      guideMsg.innerHTML = '🎯 <strong>章节学习指引</strong><br><br>' + formatJJAnswer(data.answer);
      msgDiv.appendChild(guideMsg);
      msgDiv.scrollTop = msgDiv.scrollHeight;
      // Auto-open JJ chat
      const overlay = document.getElementById('jj-chat-overlay');
      if (overlay && !overlay.classList.contains('active')) {
        overlay.classList.add('active');
      }
    }
  } catch (e) {}
}

async function autoJJChapterComplete() {
  if (typeof CHAPTER_KP_TITLES === 'undefined') return;

  try {
    const res = await fetch('/api/jj-chapter-complete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chapter_id: CHAPTER_ID, chapter_title: CHAPTER_TITLE,
        kp_titles: CHAPTER_KP_TITLES,
        wrong_answers: typeof CHAPTER_WRONG !== 'undefined' ? CHAPTER_WRONG : []
      })
    });
    const data = await res.json();
    if (!data.success) return;

    const msgDiv = document.getElementById('jj-messages');
    if (msgDiv) {
      const completeMsg = document.createElement('div');
      completeMsg.className = 'msg jj';
      completeMsg.innerHTML = '🎉 <strong>章节完成！</strong><br><br>' + formatJJAnswer(data.answer);
      msgDiv.appendChild(completeMsg);
      msgDiv.scrollTop = msgDiv.scrollHeight;
      // Auto-open JJ chat
      const overlay = document.getElementById('jj-chat-overlay');
      if (overlay && !overlay.classList.contains('active')) {
        overlay.classList.add('active');
      }
    }
  } catch (e) {}
}

// Check if this chapter is fully completed (all KPs done)
function isChapterComplete() {
  const totalKPs = document.querySelectorAll('.kp-item').length;
  const completedKPs = document.querySelectorAll('.kp-item.completed').length;
  return totalKPs > 0 && completedKPs >= totalKPs;
}

// ==================== User Mindmap (My Mindmap) — Mind Elixir ====================
let myMindmapInstance = null;

async function openMyMindmap() {
  const overlay = document.getElementById('my-mindmap-overlay');
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';

  const container = document.getElementById('mind-elixir-container');
  if (!container) return;

  // Destroy any existing instance
  if (myMindmapInstance) {
    myMindmapInstance.destroy();
    myMindmapInstance = null;
  }

  // Create MindElixir instance
  myMindmapInstance = new MindElixir({
    el: container,
    direction: MindElixir.SIDE,
    editable: true,
    contextMenu: true,
    toolBar: true,
    keypress: true,
    theme: MindElixir.DARK_THEME,
    overflowHidden: false
  });

  try {
    const res = await fetch('/api/mindmap/get?chapter_id=' + CHAPTER_ID);
    const data = await res.json();
    let initData = null;

    if (data.success && data.content) {
      try {
        const parsed = JSON.parse(data.content);
        if (parsed && parsed.nodeData) initData = parsed;
      } catch (e) {}
    }

    if (!initData) {
      initData = {
        nodeData: MindElixir.new(CHAPTER_TITLE || '我的思维导图').nodeData,
        arrows: [],
        summaries: [],
        meta: {}
      };
    }

    myMindmapInstance.init(initData);
    setTimeout(() => { try { myMindmapInstance.toCenter(); } catch(e) {} }, 200);
  } catch (e) {
    const initData = {
      nodeData: MindElixir.new(CHAPTER_TITLE || '我的思维导图').nodeData,
      arrows: [],
      summaries: [],
      meta: {}
    };
    myMindmapInstance.init(initData);
  }
}

function closeMyMindmap() {
  document.getElementById('my-mindmap-overlay').classList.remove('active');
  document.body.style.overflow = '';
  if (myMindmapInstance) {
    myMindmapInstance.destroy();
    myMindmapInstance = null;
  }
}

async function myMindmapSave() {
  if (!myMindmapInstance) { showToast('请先打开思维导图编辑器', 'error'); return; }
  try {
    const data = myMindmapInstance.getData();
    const content = JSON.stringify(data);
    const res = await fetch('/api/mindmap/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapter_id: CHAPTER_ID, content })
    });
    const result = await res.json();
    if (result.success) showToast('\U0001f4be 思维导图已保存！', 'success');
    else showToast('保存失败', 'error');
  } catch (e) { showToast('网络错误', 'error'); }
}

function myMindmapFit() {
  if (myMindmapInstance) {
    try { myMindmapInstance.toCenter(); } catch(e) {}
  }
}

function myMindmapUpload() {
  document.getElementById('my-mindmap-file-input').click();
}

function myMindmapLoadFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      if (data && data.nodeData) {
        if (myMindmapInstance) {
          myMindmapInstance.init(data);
          showToast('\U0001f4c2 思维导图已加载', 'success');
        } else {
          showToast('请先打开思维导图编辑器', 'error');
        }
      } else {
        showToast('无效的思维导图 JSON 格式', 'error');
      }
    } catch (err) {
      showToast('文件格式有误，请上传有效的 JSON 文件', 'error');
    }
  };
  reader.readAsText(file, 'UTF-8');
  event.target.value = '';
}

async function myMindmapDelete() {
  if (!confirm('确定删除自定义思维导图？')) return;
  try {
    const res = await fetch('/api/mindmap/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapter_id: CHAPTER_ID })
    });
    const data = await res.json();
    if (data.success) {
      if (myMindmapInstance) {
        const defaultData = {
          nodeData: MindElixir.new(CHAPTER_TITLE || '我的思维导图').nodeData,
          arrows: [],
          summaries: [],
          meta: {}
        };
        myMindmapInstance.init(defaultData);
      }
      showToast('已删除', 'success');
    }
  } catch (e) {}
}

// ==================== Fireworks System ====================
let fireworksAnimId = null;

function startFireworks(mode) {
  const canvas = document.getElementById('fireworks-canvas');
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');

  const isFull = mode === 'full';
  const particles = [];
  const rockets = [];
  const colors = ['#ff6b6b', '#ffd700', '#00d4ff', '#a371f7', '#3fb950', '#ff6b9d', '#ff9f43'];

  function createBurst(x, y) {
    const count = isFull ? 80 : 25;
    const color = colors[Math.floor(Math.random() * colors.length)];
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 / count) * i + (Math.random() - 0.5) * 0.5;
      const speed = (Math.random() * 3 + 2) * (isFull ? 1.5 : 1);
      particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: 0.015 + Math.random() * 0.01,
        size: Math.random() * 3 + 1,
        color
      });
    }
  }

  function createRocket() {
    const x = isFull
      ? Math.random() * canvas.width
      : (Math.random() < 0.5 ? Math.random() * canvas.width * 0.15 : canvas.width - Math.random() * canvas.width * 0.15);
    const targetY = isFull
      ? Math.random() * canvas.height * 0.5 + canvas.height * 0.1
      : Math.random() * canvas.height * 0.4 + canvas.height * 0.1;
    rockets.push({
      x, y: canvas.height, targetY, speed: 3 + Math.random() * 3, trail: []
    });
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Rockets
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i];
      r.trail.push({ x: r.x, y: r.y });
      if (r.trail.length > 10) r.trail.shift();
      r.y -= r.speed;
      r.x += (Math.random() - 0.5) * 0.6;

      // Draw trail
      for (let j = 0; j < r.trail.length; j++) {
        const alpha = j / r.trail.length;
        ctx.fillStyle = 'rgba(255,255,255,' + (alpha * 0.5) + ')';
        ctx.beginPath();
        ctx.arc(r.trail[j].x, r.trail[j].y, 1.5 * alpha, 0, Math.PI * 2);
        ctx.fill();
      }

      if (r.y <= r.targetY) {
        createBurst(r.x, r.y);
        rockets.splice(i, 1);
      }
    }

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.04;
      p.vx *= 0.99;
      p.life -= p.decay;

      if (p.life <= 0) { particles.splice(i, 1); continue; }

      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = p.life * 0.2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Launch rockets
    if (isFull) {
      if (Math.random() < 0.08) createRocket();
      if (Math.random() < 0.05) createRocket();
    } else {
      if (Math.random() < 0.03) createRocket();
    }

    if (rockets.length > 0 || particles.length > 0) {
      fireworksAnimId = requestAnimationFrame(animate);
    }
  }

  // Initial burst
  for (let i = 0; i < (isFull ? 5 : 2); i++) {
    setTimeout(createRocket, i * 200);
  }

  if (fireworksAnimId) cancelAnimationFrame(fireworksAnimId);
  animate();
}

function stopFireworks() {
  if (fireworksAnimId) {
    cancelAnimationFrame(fireworksAnimId);
    fireworksAnimId = null;
  }
  const canvas = document.getElementById('fireworks-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function createConfetti(count) {
  const colors = ['#ff6b6b', '#ffd700', '#00d4ff', '#a371f7', '#3fb950', '#ff6b9d', '#ff9f43'];
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    el.style.cssText = 'left:' + (Math.random() * 100) + 'vw;' +
      'background:' + colors[Math.floor(Math.random() * colors.length)] + ';' +
      'width:' + (Math.random() * 8 + 4) + 'px;' +
      'height:' + (Math.random() * 8 + 4) + 'px;' +
      'animation-duration:' + (2 + Math.random() * 2) + 's;' +
      'animation-delay:' + (Math.random() * 2) + 's;' +
      'border-radius:' + (Math.random() > 0.5 ? '50%' : '2px') + ';';
    document.body.appendChild(el);
    setTimeout(function() { if (el.parentNode) el.remove(); }, 5000);
  }
}

// ==================== Score Animation ====================
function showScoreAnimation(score, feedback, strengths, weaknesses) {
  const overlay = document.getElementById('score-overlay');
  const scoreNum = document.getElementById('score-number');
  const scoreLabel = document.getElementById('score-label');
  const feedbackEl = document.getElementById('score-feedback');
  const strengthsEl = document.getElementById('score-strengths');
  const weaknessesEl = document.getElementById('score-weaknesses');
  const quoteEl = document.getElementById('score-quote');
  const card = document.getElementById('score-card');

  if (!overlay) return;

  // Reset
  overlay.classList.remove('active');
  card.className = 'score-card';
  scoreNum.className = 'score-number';
  document.body.classList.remove('screen-shake');
  stopFireworks();
  document.querySelectorAll('.confetti-piece').forEach(function(el) { el.remove(); });

  // Set content
  feedbackEl.textContent = feedback || '';
  strengthsEl.textContent = strengths ? '✅ ' + strengths : '';
  weaknessesEl.textContent = weaknesses ? '❌ ' + weaknesses : '';

  var quoteText = '';
  var labelText = 'AI 评分';

  if (score >= 60 && score < 80) {
    scoreNum.className = 'score-number pass';
    labelText = '✅ 通过！再接再厉';
    var quotes = [
      '“成功是衰倒九次，爬起来十次。” — 香港俗语',
      '“不积步跬，无以至千里。” — 茀子',
      '“Practice makes perfect.” — 熟能生巧',
      '“每一次练习都是向大师脉进的一步。”',
      '“坚持是成功的另一个名字。”',
      '“Rome was not built in a day.”'
    ];
    quoteText = quotes[Math.floor(Math.random() * quotes.length)];
    setTimeout(function() { startFireworks('edge'); }, 300);

  } else if (score >= 80 && score < 95) {
    scoreNum.className = 'score-number medium';
    card.classList.add('glow');
    labelText = '🌟 才华横溢！';
    var poems = [
      '「心有灵狐一点通，学贯东西自不同。\n  代码如诗写乾坄，智慧光芒照苍穹。」',
      '「笔落惊风雨，码成泣鬼神。\n  逻辑如丝织锦绣，思维似剑破迷津。」',
      '「少年负壮气，奋烈自有时。\n  编程之道通天地，智慧之花绽满枝。」',
      '「博学之，审问之，慎思之，明辨之，積行之。」\n  —— 《礼记·中庸》',
      '「问渠哪得清如许，为有源头活水来。」\n  —— 朱熹《观书有感》'
    ];
    quoteText = poems[Math.floor(Math.random() * poems.length)];
    document.body.classList.add('screen-shake');
    setTimeout(function() { startFireworks('edge'); }, 300);

  } else if (score >= 95) {
    scoreNum.className = 'score-number winner';
    card.classList.add('glow');
    labelText = '🏆 绝世天才！';
    var praises = [
      '「此曲只应天上有，人间能得几回闻！」\n  你的代码如诗如画，堪称编程艺术的巅峰之作！',
      '「会当凌绝顶，一览众山小！」\n  你已站在编程之巅，让人叹为观止！',
      '「天纵之才，旷世难逢！」\n  你的逻辑思维和代码能力，已达到超凡入圣的境界！',
      '「春风得意马蹄急，一日看尽长安花！」\n  完美的解答，令人拍案叫绝！',
      '「大鹏一日同风起，扶摇直上九万里！」\n  你的编程天赋，正如大鹏展翅，不可限量！'
    ];
    quoteText = praises[Math.floor(Math.random() * praises.length)];
    setTimeout(function() { startFireworks('full'); }, 300);
    setTimeout(function() { createConfetti(50); }, 500);
    var confettiInterval = setInterval(function() {
      if (!overlay.classList.contains('active')) {
        clearInterval(confettiInterval);
        return;
      }
      createConfetti(15);
    }, 1500);
  }

  quoteEl.textContent = quoteText;
  scoreLabel.textContent = labelText;

  // Show overlay
  overlay.classList.add('active');
  scoreNum.textContent = '0';

  // Animate score counting up
  var duration = 1000;
  var startTime = Date.now();
  function animateScore() {
    var elapsed = Date.now() - startTime;
    var progress = Math.min(elapsed / duration, 1);
    var eased = 1 - Math.pow(1 - progress, 3);
    var current = Math.round(eased * score);
    scoreNum.textContent = current;
    if (progress < 1) {
      requestAnimationFrame(animateScore);
    } else {
      scoreNum.textContent = score;
    }
  }
  animateScore();
}

function closeScoreOverlay() {
  const overlay = document.getElementById('score-overlay');
  if (overlay) overlay.classList.remove('active');
  document.body.classList.remove('screen-shake');
  stopFireworks();
  document.querySelectorAll('.confetti-piece').forEach(function(el) { el.remove(); });
}


// ── Auto-trigger on page load ──
document.addEventListener('DOMContentLoaded', function() {
  // JJ Chapter Guide for first-time chapter visit
  if (typeof CHAPTER_ID !== 'undefined') {
    autoJJChapterGuide();
  }
});

// ==================== Close modals by clicking overlay ====================
document.addEventListener('click', function(e) {
  if (e.target.closest('.modal-overlay') && !e.target.closest('.modal-container')) {
    document.querySelectorAll('.modal-overlay.active').forEach(m => { m.classList.remove('active'); document.body.style.overflow = ''; });
  }
  if (e.target.closest('.code-ex-overlay') && !e.target.closest('.code-ex-container')) {
    closeCodeEx();
  }
});

// ==================== Theme Toggle ====================
(function() {
  const KEY = 'ai_master_theme';
  const saved = localStorage.getItem(KEY);
  if (saved === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    const btn = document.querySelector('.btn-theme-toggle');
    if (btn) {
      const icon = btn.querySelector('.theme-icon');
      if (icon) icon.textContent = '☀'; else btn.textContent = '☀️';
    }
  }
})();

function toggleTheme() {
  const html = document.documentElement;
  const btn = document.querySelector('.btn-theme-toggle');
  const isLight = html.getAttribute('data-theme') === 'light';
  if (isLight) {
    html.removeAttribute('data-theme');
    if (btn) {
      const icon = btn.querySelector('.theme-icon');
      if (icon) icon.textContent = '◐'; else btn.textContent = '🌙';
    }
    localStorage.setItem('ai_master_theme', 'dark');
  } else {
    html.setAttribute('data-theme', 'light');
    if (btn) {
      const icon = btn.querySelector('.theme-icon');
      if (icon) icon.textContent = '☀'; else btn.textContent = '☀️';
    }
    localStorage.setItem('ai_master_theme', 'light');
  }
}

// ==================== Glossary ====================
async function showGlossary() {
  const modal = document.getElementById('glossary-modal');
  const list = document.getElementById('glossary-list');
  if (!modal || !list) return;

  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
  list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">加载中...</div>';

  try {
    const res = await fetch('/api/glossary');
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    list.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;">';
    data.terms.forEach(function(term) {
      list.innerHTML += '<div class="glossary-item" onclick="toggleGlossaryTerm(this)" style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:10px;padding:12px 14px;cursor:pointer;transition:all 0.2s ease;">' +
        '<div style="display:flex;align-items:center;gap:8px;">' +
        '<span style="color:var(--cyan);font-weight:600;font-size:14px;">' + escapeHtml(term.term) + '</span>' +
        '<span style="color:var(--text-muted);font-size:11px;">' + escapeHtml(term.en || '') + '</span>' +
        '</div>' +
        '<div class="glossary-desc" style="display:none;margin-top:8px;padding-top:8px;border-top:1px solid var(--border-subtle);color:var(--text-secondary);font-size:13px;line-height:1.6;">' + escapeHtml(term.desc) + '</div>' +
        '</div>';
    });
    list.innerHTML += '</div>';
  } catch (e) {
    list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--red);">加载失败，请刷新重试</div>';
  }
}

function toggleGlossaryTerm(el) {
  const desc = el.querySelector('.glossary-desc');
  if (desc) {
    desc.style.display = desc.style.display === 'none' ? 'block' : 'none';
  }
}

// BGM Player
let bgmAudio = null;
let bgmPlaying = false;
function toggleBGM() {
  const label = document.getElementById('bgm-label');
  if (!bgmAudio) {
    bgmAudio = new Audio('../bgm.mp3');
    bgmAudio.loop = true;
    bgmAudio.volume = 0.3;
  }
  if (bgmPlaying) {
    bgmAudio.pause();
    bgmPlaying = false;
    if (label) label.textContent = document.body.classList.contains('dashboard-page') ? '环境声场 / OFF' : 'BGM 关';
  } else {
    bgmAudio.play().then(() => {
      bgmPlaying = true;
      if (label) label.textContent = document.body.classList.contains('dashboard-page') ? '环境声场 / ON' : 'BGM 开';
    }).catch(() => {
      if (label) label.textContent = document.body.classList.contains('dashboard-page') ? '环境声场 / OFF' : 'BGM 关';
      showToast('请添加背景音乐文件到 static/bgm.mp3', 'error');
    });
  }
}

// ==================== 章节启示CG返回处理 ====================
(function() {
  if (typeof CHAPTER_ID === 'undefined') return;
  const params = new URL(location.href).searchParams;
  if (params.get('reveal') === '1') {
    // Clean URL without reload
    if (history.replaceState) {
      const cleanUrl = location.pathname;
      history.replaceState({}, '', cleanUrl);
    }
    // Auto-open JJ chat and trigger chapter complete analysis
    setTimeout(() => {
      if (typeof autoJJChapterComplete === 'function') {
        autoJJChapterComplete();
      }
      if (typeof startLLMAgent === 'function') {
        setTimeout(() => startLLMAgent(CHAPTER_ID), 2000);
      }
    }, 1200);
  }
})();
