/* 逐日学习路线 */

const Roadmap = {
  daily: 60,
  data: null,

  icons: { kp: '✦', practice: '✎', review: '↻', exam: '◈', interview: '◐' },

  async init() {
    this.bindPicks();
    await this.load(this.daily);
  },

  bindPicks() {
    document.querySelectorAll('.rm-pick').forEach((node) => {
      node.addEventListener('click', () => {
        this.daily = Number(node.dataset.min);
        this.load(this.daily);
      });
    });
  },

  async load(minutes) {
    const days = document.getElementById('rm-days');
    days.innerHTML = '<div class="empty"><b>正在排路线</b>按你的时间算每一天要学什么…</div>';
    try {
      const data = await Star.api('/api/roadmap?daily=' + minutes);
      this.data = data;
      this.daily = data.daily_minutes;
      document.querySelectorAll('.rm-pick').forEach((node) => {
        node.classList.toggle('on', Number(node.dataset.min) === this.daily);
      });
      this.paintSummary(data);
      this.paintDays(data);
    } catch (error) {
      days.innerHTML = `<div class="empty"><b>排不出路线</b>${Star.esc(error.message)}</div>`;
    }
  },

  paintSummary(data) {
    const s = data.summary || {};
    document.getElementById('rm-summary').innerHTML = `
      <div class="rm-kpi"><span>整条路线</span><b class="hl">${s.total_days || 0} 天</b></div>
      <div class="rm-kpi"><span>约 ${s.weeks || 0} 周</span><b>${s.total_hours || 0} 小时</b></div>
      <div class="rm-kpi"><span>已完成</span><b>${s.done_days || 0} 天</b></div>
      <div class="rm-kpi"><span>每天投入</span><b>${data.daily_minutes} 分钟</b></div>
      <div class="rm-now">
        <p>你现在在 <b>第 ${s.current_day || 1} 天</b>${s.current_title ? `：${Star.esc(s.current_title)}` : ''}。
           ${s.done_days ? `已经走完 ${s.done_days} 天。` : '今天是第一天，从第一个知识点开始。'}</p>
      </div>`;
  },

  paintDays(data) {
    const box = document.getElementById('rm-days');
    const summary = data.summary || {};
    document.getElementById('rm-count').textContent =
      `共 ${data.days.length} 天 · 每天约 ${data.daily_minutes} 分钟 · 点日期展开当天内容`;
    box.innerHTML = data.days.map((day) => {
      const isCurrent = day.day === summary.current_day && !day.done;
      const items = day.items.map((item) => this.paintItem(item)).join('');
      // 只有「今天」和已完成的默认展开。全部展开会让页面高达 3700px，
      // 学生扫不到重点，也看不出自己走到哪了。
      const open = isCurrent || day.done;
      const titles = day.items.slice(0, 2).map((item) => item.title).join(' · ');
      return `
        <article class="rm-day" ${day.done ? 'data-done="1"' : ''} ${isCurrent ? 'data-current="1"' : ''}>
          <div class="rm-day-head" data-act="toggle">
            <span class="rm-day-no">DAY ${String(day.day).padStart(2, '0')}</span>
            <span class="rm-day-date">${Star.dateLabel(day.date)} 周${day.weekday}</span>
            <span class="rm-day-stage">${Star.esc(day.stage || '')}</span>
            <span class="rm-day-peek">${Star.esc(titles)}${day.items.length > 2 ? ' …' : ''}</span>
            <span class="rm-day-min">${day.minutes} 分钟</span>
            <span class="rm-day-mark">${day.done ? '✓' : isCurrent ? '▶' : ''}</span>
          </div>
          <div class="rm-items" ${open ? '' : 'hidden'}>${items}</div>
        </article>`;
    }).join('');
    box.querySelectorAll('[data-act="toggle"]').forEach((head) => {
      head.addEventListener('click', () => {
        const items = head.parentElement.querySelector('.rm-items');
        items.hidden = !items.hidden;
      });
    });
    // 首次进入时把「今天」滚进视野 —— 学生打开这一页就是想知道今天干什么
    const today = box.querySelector('[data-current]');
    if (today) setTimeout(() => today.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
  },

  paintItem(item) {
    const icon = this.icons[item.type] || '✦';
    const classes = ['rm-item', item.type];
    if (item.done) classes.push('done');
    if (item.highlight) classes.push('hot');
    const label = item.type === 'kp'
      ? `第 ${item.chapter_id} 章 · ${Star.esc(item.chapter_title)}`
      : (item.chapter_title ? Star.esc(item.chapter_title) : '');
    return `
      <a class="${classes.join(' ')}" href="${Star.esc(item.url || '/')}">
        <span class="ri-icon">${icon}</span>
        <span class="ri-main">
          <b>${Star.esc(item.title)}</b>
          ${label ? `<em>${label}</em>` : ''}
        </span>
        <span class="ri-min">${item.minutes}m</span>
        ${item.done ? '<span class="ri-done">✓</span>' : ''}
      </a>`;
  },
};

document.addEventListener('DOMContentLoaded', () => Roadmap.init());
