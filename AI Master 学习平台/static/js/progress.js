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
      const graph = await Star.api('/api/learning-graph');
      this.paintGraph(graph);
      this.paintWeak(graph.weak_spots || []);
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

  paintGraph(data) {
    const box = document.getElementById('pg-graph');
    const nodes = data.nodes || [];
    const edges = data.edges || [];
    const chapters = [...new Set(nodes.map(node => node.chapter_id))];
    const positions = new Map();
    const counts = new Map();
    nodes.forEach(node => {
      const col = chapters.indexOf(node.chapter_id);
      const row = counts.get(node.chapter_id) || 0;
      counts.set(node.chapter_id, row + 1);
      positions.set(node.id, { x: 30 + col * 205, y: 52 + row * 74 });
    });
    const height = Math.max(470, ...[...counts.values()].map(n => 65 + n * 74));
    const width = 60 + chapters.length * 205;
    const lines = edges.map(edge => {
      const a = positions.get(edge.from), b = positions.get(edge.to);
      if (!a || !b) return '';
      const sameColumn = a.x === b.x;
      const x1 = sameColumn ? a.x + 82 : a.x + 165;
      const y1 = sameColumn ? a.y + 47 : a.y + 23;
      const x2 = sameColumn ? b.x + 82 : b.x;
      const y2 = sameColumn ? b.y : b.y + 23;
      return `<path d="M ${x1} ${y1} C ${sameColumn ? x1 : x1 + 19} ${sameColumn ? y1 + 13 : y1}, ${sameColumn ? x2 : x2 - 19} ${sameColumn ? y2 - 13 : y2}, ${x2} ${y2}" />`;
    }).join('');
    const blocks = nodes.map(node => {
      const { x, y } = positions.get(node.id);
      const label = Star.esc(node.title.length > 13 ? node.title.slice(0, 12) + '…' : node.title);
      return `<a href="${node.url}" class="pg-graph-node ${node.status}" aria-label="${Star.esc(node.title)} 掌握度 ${node.score} 分">
        <title>${Star.esc(node.title)} · 掌握度 ${node.score}/100 · 证据 ${node.evidence} 条</title>
        <rect x="${x}" y="${y}" width="165" height="47" rx="7" />
        <text x="${x + 11}" y="${y + 20}">${label}</text>
        <text class="sub" x="${x + 11}" y="${y + 37}">${node.evidence ? `掌握度 ${node.score} / 100` : '尚未学习'}</text>
      </a>`;
    }).join('');
    const headers = chapters.map((id, index) => `<text class="pg-graph-heading" x="${30 + index * 205}" y="29">第 ${id} 章</text>`).join('');
    box.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="个人知识图谱">
      <defs><marker id="graph-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 8 4 L 0 8 Z" fill="#719ca0" /></marker></defs>
      <g class="pg-graph-edges">${lines}</g>${headers}${blocks}</svg>`;
  },

  /* 该补哪里：把"图上的红黄点"变成可执行的清单。
     学生看图能知道"我哪里弱"，但下一步该点哪里往往还是懵的 ——
     这里直接给可点的链接，并标出它依赖的前一个知识点
     （补的时候从那个点往回看，通常比硬啃当前这个更有效）。 */
  paintWeak(spots) {
    const section = document.getElementById('pg-weak-section');
    const box = document.getElementById('pg-weak');
    if (!section || !box) return;
    if (!spots.length) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    box.innerHTML = spots.map((spot) => {
      const needs = spot.needs
        ? `<span class="pg-weak-needs ${spot.needs.status}">依赖：${Star.esc(spot.needs.title)}（${spot.needs.score} 分）</span>`
        : '';
      return `<div class="pg-weak-row ${spot.status}">
        <span class="pg-weak-dot" aria-hidden="true"></span>
        <div class="pg-weak-body">
          <a href="${spot.url}">${Star.esc(spot.title)}</a>
          <div class="pg-weak-meta">${Star.esc(spot.chapter)}${needs}</div>
        </div>
        <span class="pg-weak-score">${spot.score} / 100</span>
      </div>`;
    }).join('');
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
