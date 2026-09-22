/* 学习档案 */

const ProgressPage = {
  icons: { kp: '✦', practice: '✎', review: '↻', exam: '◈', interview: '◐' },

  async init() {
    try {
      const data = await Star.api('/api/progress/overview');
      this.paintKpis(data);
      this.paintChapters(data);
      this.paintWrong(data);
      this.paintExams(data);
      this.paintLog(data);
      if (data.is_guest) {
        document.getElementById('pg-kpis').insertAdjacentHTML('beforeend',
          `<div class="pg-kpi" style="grid-column:1/-1">
             <span>当前是游客模式</span>
             <b style="font-size:15px;font-family:var(--sans)">进度不会保存</b>
             <em><a href="/login" style="color:var(--cyan)">注册后</a>才能留下这份档案。</em>
           </div>`);
      }
    } catch (error) {
      Star.toast(error.message, 'bad');
    }
  },

  paintKpis(data) {
    const stats = data.stats || {};
    const profile = data.profile || {};
    const items = [
      ['修为点', stats.points || 0, 'hl', profile.name || ''],
      ['探索战力', (data.power || {}).total || 0, 'gold', '见星空修为页拆分'],
      ['通关题数', stats.total_solved || 0, '', `尝试过 ${stats.attempted || 0} 道`],
      ['满分次数', stats.stars3 || 0, '', `进阶题满分 ${stats.stars3_hard || 0} 次`],
      ['知识点', stats.kp_done || 0, '', `完整章节 ${stats.chapters_full || 0} 个`],
      ['智能体题', stats.agent_solved || 0, 'hl', `其中满分 ${stats.agent_perfect || 0} 次`],
      ['错题待订正', stats.wrong_open || 0, '', `已订正 ${stats.wrong_fixed || 0} 道`],
      ['连续学习', stats.streak_days || 0, '', `最长 ${stats.streak_best || 0} 天`],
    ];
    document.getElementById('pg-kpis').innerHTML = items.map(([label, value, cls, note]) => `
      <div class="pg-kpi"><span>${label}</span>
        <b class="${cls}">${value}</b>
        ${note ? `<em>${Star.esc(note)}</em>` : ''}
      </div>`).join('');
  },

  paintChapters(data) {
    const rows = data.chapters || [];
    document.getElementById('pg-chapters').innerHTML = `
      <thead><tr>
        <th>章节</th><th>知识点</th><th>题目</th><th>错题</th><th>操作</th>
      </tr></thead>
      <tbody>${rows.map((row) => `
        <tr class="${row.highlight ? 'hot' : ''}">
          <td>${row.icon} <b>${Star.esc(row.title)}</b>${row.highlight ? ' <span class="chip violet">主线</span>' : ''}</td>
          <td><div class="cell-bar"><div class="bar"><i style="width:${row.progress}%"></i></div>
              <span>${row.kp_done}/${row.kp_total}</span></div></td>
          <td><div class="cell-bar"><div class="bar"><i style="width:${row.q_total ? Math.round(row.q_solved / row.q_total * 100) : 0}%"></i></div>
              <span>${row.q_solved}/${row.q_total}</span></div></td>
          <td>${row.q_wrong ? `<span style="color:var(--rose)">${row.q_wrong}</span>` : '—'}</td>
          <td>
            <a href="/chapter/${row.id}">讲义</a> ·
            <a href="/training?chapters=${row.id}">刷题</a>
          </td>
        </tr>`).join('')}</tbody>`;
  },

  paintWrong(data) {
    const box = document.getElementById('pg-wrong');
    const rows = (data.chapters || []).filter((row) => row.q_wrong > 0);
    if (!rows.length) {
      box.innerHTML = '<div class="empty"><b>错题本是空的</b>做错的题会自动进来，重做通关后自动消失。</div>';
      return;
    }
    box.innerHTML = rows.map((row) => `
      <div class="pg-wrong-card">
        <h4>${row.icon} ${Star.esc(row.title)}</h4>
        <p>${row.q_wrong} 道题还没重做通关</p>
        <div class="row">
          <a class="btn sm" href="/training?chapters=${row.id}">去订正</a>
          <span class="chip" style="color:var(--rose);border-color:rgba(255,157,179,.4)">待订正</span>
        </div>
      </div>`).join('');
  },

  paintExams(data) {
    const box = document.getElementById('pg-exams');
    const rows = data.exams || [];
    if (!rows.length) {
      box.innerHTML = '<div class="empty"><b>还没组过卷</b>去刷题页点「开始组卷」，限时做完会有 AI 逐题讲评。</div>';
      return;
    }
    box.innerHTML = rows.slice().reverse().map((exam) => `
      <div class="pg-exam">
        <b>${exam.score === null || exam.score === undefined ? '—' : exam.score}</b>
        <div class="meta">
          <strong>${Star.esc(exam.created_at || '')} · ${exam.count} 题 · ${exam.done} 题作答</strong>
          ${exam.status === 'finished' ? '已交卷' : '未交卷'} · 星辉 ${exam.stars_total || 0}
        </div>
        <a class="btn sm ghost" href="/training?tab=exam">去组卷页查看</a>
      </div>`).join('');
  },

  paintLog(data) {
    const rows = data.log || [];
    const box = document.getElementById('pg-log');
    if (!rows.length) {
      box.innerHTML = '<div class="empty">还没有修为记录。完成一个知识点或做对一道题就会开始有。</div>';
      return;
    }
    box.innerHTML = rows.map((row) => `
      <div class="pg-log-row">
        <span class="ts">${Star.esc(row.ts || '')}</span>
        <span class="note">${Star.esc(row.note || row.reason || '')}</span>
        <span class="delta">+${row.delta || 0}</span>
      </div>`).join('');
  },
};

document.addEventListener('DOMContentLoaded', () => ProgressPage.init());
