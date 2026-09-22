/* ===========================================================
   星空修为
   -----------------------------------------------------------
   这一页不产生任何新的状态：所有数字都由服务端的
   /api/game/state（纯推导）算出来。所以这里只做渲染，
   没有任何"本地记一份"的逻辑 —— 那样迟早会和后端不一致。

   视觉上遵循一条：**未到达的境界要看得见、要灰**。
   看得见的目标才叫目标；全部藏起来只会让人以为游戏只有开头。
   =========================================================== */

const Constellation = {
  data: null,

  async init() {
    try {
      const data = await Star.api('/api/game/state');
      this.data = data;
      this.paintHero(data);
      this.paintRealms(data);
      this.paintEquipment(data);
      this.paintTrials(data);
      this.paintLevels(data);
      if (data.granted_trials && data.granted_trials.length && window.Cultivation) {
        data.granted_trials.forEach((row) => {
          Star.toast(`${row.realm} · 试炼全通，修为 +${row.reward}`, 'good');
        });
      }
    } catch (error) {
      document.getElementById('cx-name').textContent = '拿不到修为数据';
      Star.toast(error.message, 'bad');
    }
  },

  paintHero(data) {
    const profile = data.profile || {};
    const art = data.art || {};
    document.getElementById('cx-name').textContent = profile.name || '未启程';
    document.getElementById('cx-whisper').textContent = art.whisper || '';
    document.getElementById('cx-bar').style.width = `${profile.progress || 0}%`;
    document.getElementById('cx-points').textContent = `${profile.points || 0} 修为`;

    const box = document.getElementById('cx-portrait');
    if (window.Portrait) {
      box.innerHTML = window.Portrait.render({
        seed: data.user, art: art, level: profile.level || 0, width: '100%',
      });
    }

    document.getElementById('cx-next').innerHTML = profile.is_max
      ? '<span class="chip gold">已至巅峰 —— 全站内容已封顶</span>'
      : `<span class="chip">下一境：${Star.esc(profile.next_name || '')}</span>
         <span class="chip">还差 ${profile.to_next} 点</span>
         <a class="btn sm" href="/training">去刷题</a>`;

    const power = data.power || { total: 0, parts: [] };
    document.getElementById('cx-power').textContent = power.total;
    document.getElementById('cx-power-parts').innerHTML = power.parts.map((part) =>
      `<div class="cx-power-part"><span>${Star.esc(part.label)} ${part.note ? `· ${Star.esc(part.note)}` : ''}</span>
       <b>${part.value}</b></div>`).join('');
  },

  paintRealms(data) {
    const box = document.getElementById('cx-realms');
    box.innerHTML = (data.realms || []).map((row) => {
      const art = row.art || {};
      let sigil = '';
      if (window.Portrait && art.glyph) {
        sigil = `<span style="color:${art.primary}">${window.Portrait.sigil(art.glyph, { size: 34, seed: row.realm })}</span>`;
      }
      const state = row.current ? '<span class="state now">当前境界</span>'
        : row.reached ? '<span class="state on">已到达</span>' : '';
      const instrument = row.instrument_start || {};
      return `
        <div class="cx-realm ${row.reached ? 'reached' : ''} ${row.current ? 'current' : ''}"
             style="--pm-primary:${art.primary || 'var(--cyan)'}">
          <div class="cx-realm-sigil">${sigil}</div>
          <div class="cx-realm-main">
            <h3>${Star.esc(row.realm)}<em>TIER ${String(row.tier).padStart(2, '0')}</em></h3>
            <p>${Star.esc(art.whisper || '')}</p>
            <div class="cx-realm-instr">本境星仪：<b>${Star.esc(instrument.name || '—')}</b>
              ${instrument.term ? `<span style="color:var(--muted)"> · ${Star.esc(instrument.term)}</span>` : ''}</div>
          </div>
          <div class="cx-realm-side">
            <span class="need">需 ${Levels_need(row)} 修为</span>
            ${state}
          </div>
        </div>`;
    }).join('');
  },

  paintEquipment(data) {
    const rows = data.equipment || [];
    const on = rows.filter((row) => row.unlocked).length;
    document.getElementById('cx-equip-sub').textContent =
      `${on} / ${rows.length} 件已解锁 · 条件全是累计统计，做够就自动到手`;
    document.getElementById('cx-equipment').innerHTML = rows.map((row) => `
      <div class="cx-equip ${row.unlocked ? 'on' : ''}">
        <div class="cx-equip-top">
          <b>${Star.esc(row.name)}</b>
          <em>${Star.esc(row.slot)}${row.unlocked ? ' ✓' : ''}</em>
        </div>
        <p>${Star.esc(row.hint)}</p>
        <p class="cx-equip-why">${Star.esc(row.why)}</p>
        <div class="cx-equip-bar">
          <div class="bar"><i style="width:${Math.round((row.ratio || 0) * 100)}%"></i></div>
          <span>${row.have}/${row.target}</span>
        </div>
      </div>`).join('');
  },

  paintTrials(data) {
    document.getElementById('cx-trials').innerHTML = (data.trials || []).map((trial) => `
      <div class="cx-trial ${trial.done ? 'done' : ''}">
        <div class="cx-trial-head">
          <b>${Star.esc(trial.realm)}</b>
          <span>${trial.claimed ? '已领取' : `+${trial.reward} 修为`}</span>
        </div>
        ${trial.objectives.map((obj) => `
          <div class="cx-obj ${obj.done ? 'done' : ''}">
            <i>${obj.done ? '✓' : '○'}</i>
            <span>${Star.esc(obj.text)}</span>
            <b>${obj.have}/${obj.target}</b>
          </div>`).join('')}
      </div>`).join('');
  },

  paintLevels(data) {
    const current = (data.profile || {}).level || 0;
    // 33 件仪器一屏铺完会让这一节长达 1100px 且大部分是灰的。
    // 改成默认只展开当前等级附近，其余收成一行摘要，点开看说明。
    document.getElementById('cx-levels').innerHTML = (data.levels || []).map((row) => {
      const near = Math.abs(row.level - current) <= 2;
      const instrument = row.instrument || {};
      return `
      <div class="cx-level ${row.reached ? 'reached' : ''} ${row.level === current ? 'current' : ''}"
           data-level="${row.level}">
        <div class="cx-level-top">
          <b>${Star.esc(instrument.name || '')}</b>
          <em>LV${row.level}</em>
        </div>
        <span class="lv-name">${Star.esc(row.name)}</span>
        <p ${near ? '' : 'hidden'}>${Star.esc(instrument.desc || '')}
          ${instrument.term ? `<span style="color:var(--cyan)"> · ${Star.esc(instrument.term)}</span>` : ''}</p>
      </div>`;
    }).join('');
    document.querySelectorAll('.cx-level').forEach((node) => {
      node.addEventListener('click', () => {
        const note = node.querySelector('p');
        if (note) note.hidden = !note.hidden;
      });
    });
  },
};

/* 境界解锁需要的修为：取该境界第一级的门槛 */
function Levels_need(row) {
  const levels = (Constellation.data && Constellation.data.levels) || [];
  const hit = levels.find((lv) => lv.level === (row.range || {}).start);
  return hit ? hit.need : 0;
}

document.addEventListener('DOMContentLoaded', () => Constellation.init());
