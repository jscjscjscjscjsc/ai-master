/* ===========================================================
   智能体图元渲染器 —— 把工具返回的结构画成 SVG
   -----------------------------------------------------------
   三种图：
     mindmap    思维导图（左根右枝，像 XMind 的结构图）
     flowchart  流程图（上下步骤，带判断分支）
     array      数组示意图（格子 + 高亮 + 指针）

   为什么不引库：项目一直是零 CDN、本地化资源，而且这三个图的布局规则
   很简单（没有交叉连线、没有自动避让），自己画比塞一个几百 KB 的库
   更可控，也能完全贴合深空主题的配色。纯 SVG 输出，缩放不糊，
   截图/打印都清楚。

   坐标全部按测量文本宽度算，所以中英文混排不会挤在一起。
   =========================================================== */

const AgentViz = (() => {
  const C = {
    cyan: '#72f6e4', violet: '#a99bff', gold: '#f0cc74',
    green: '#7de8a8', rose: '#ff9db3', blue: '#7fb4ff',
    ink: '#eef4ff', muted: '#8794b4', bg: '#0a1024',
    line: 'rgba(177,195,255,0.22)', lineStrong: 'rgba(177,195,255,0.42)',
  };

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /* 用 canvas 量一次文本宽度，避免中英文挤在一起。
     只建一次离屏 ctx，重复调用几乎无开销。 */
  let _ctx = null;
  function measure(text, font) {
    if (!_ctx) _ctx = document.createElement('canvas').getContext('2d');
    _ctx.font = font;
    return _ctx.measureText(String(text)).width;
  }
  const FONT = (size, weight) =>
    `${weight || 400} ${size}px "Segoe UI","Microsoft YaHei",system-ui,sans-serif`;

  /* ── 思维导图 ─────────────────────────────────────── */
  function mindmap(data) {
    const branches = Array.isArray(data.branches) ? data.branches : [];
    if (!branches.length) return '';
    const colors = (data.colors && data.colors.length) ? data.colors : [C.cyan];

    const rootW = 132, rootH = 40, gapY = 13, childH = 26, leafH = 22;
    const padX = 18, padY = 20, colGap = 46;

    // 每行一个叶子，纵向排布；分支标题占一行
    const rows = [];
    branches.forEach((br, bi) => {
      const color = colors[bi % colors.length];
      const kids = Array.isArray(br.children) ? br.children : [];
      const startRow = rows.length;
      rows.push({ type: 'branch', text: br.text, color, branch: bi });
      kids.forEach((kid) => {
        rows.push({ type: 'leaf', text: kid.text, color, parent: startRow });
        const grand = Array.isArray(kid.children) ? kid.children : [];
        grand.forEach((g) => {
          if (typeof g === 'string' || (g && g.text)) {
            rows.push({ type: 'grand', text: (g.text || g), color, parent: rows.length - 1 });
          }
        });
      });
      rows[startRow].endRow = rows.length - 1;
    });

    const totalH = rows.reduce((sum, r) =>
      sum + (r.type === 'branch' ? childH : r.type === 'leaf' ? leafH : leafH - 4) + gapY, 0);
    const height = Math.max(totalH + padY * 2, 120);

    // 最宽的叶子决定画布宽度。必须按**实际字号**量宽度再留余量，
    // 否则叶子文字会被 viewBox 裁掉（中文字宽约等于字号）。
    let maxLeaf = 150;
    rows.forEach((r) => {
      if (r.type === 'branch') {
        maxLeaf = Math.max(maxLeaf, measure(r.text, FONT(12, 600)) + 40);
      } else if (r.type === 'leaf') {
        maxLeaf = Math.max(maxLeaf, measure(r.text, FONT(12.5)) + 30);
      } else {
        maxLeaf = Math.max(maxLeaf, measure(r.text, FONT(11.5)) + 40);
      }
    });

    const rootX = padX, rootY = height / 2 - rootH / 2;
    const branchW = 82;
    const branchX = rootX + rootW + colGap;
    const leafX = branchX + branchW + 28;
    const grandX = leafX + 14;
    const width = leafX + Math.min(maxLeaf, 320) + padX;

    let out = `<svg viewBox="0 0 ${width} ${height}" width="100%" style="max-width:${width}px"
      xmlns="http://www.w3.org/2000/svg" class="viz-svg">`;

    // 根节点
    out += `<rect x="${rootX}" y="${rootY}" width="${rootW}" height="${rootH}" rx="9"
      fill="rgba(114,246,228,0.12)" stroke="${C.cyan}" stroke-width="1.2"/>`;
    out += `<text x="${rootX + rootW / 2}" y="${rootY + rootH / 2 + 4.5}" text-anchor="middle"
      font-size="13.5" font-weight="600" fill="${C.ink}">${esc(fit(data.title, 10))}</text>`;

    let y = padY;
    rows.forEach((r) => {
      const h = r.type === 'branch' ? childH : r.type === 'leaf' ? leafH : leafH - 4;
      const cy = y + h / 2;

      if (r.type === 'branch') {
        // 根 → 分支的曲线
        const bx = branchX, by = cy;
        out += `<path d="M${rootX + rootW} ${rootY + rootH / 2} C${rootX + rootW + 22} ${rootY + rootH / 2} ${bx - 22} ${by} ${bx} ${by}"
          fill="none" stroke="${r.color}" stroke-width="1.6" opacity="0.75"/>`;
        out += `<rect x="${bx}" y="${cy - h / 2}" width="${branchW}" height="${h}" rx="7"
          fill="${r.color}22" stroke="${r.color}" stroke-width="1"/>`;
        out += `<text x="${bx + branchW / 2}" y="${cy + 4.5}" text-anchor="middle" font-size="12"
          font-weight="600" fill="${r.color}">${esc(fit(r.text, 7))}</text>`;
      } else {
        const isLeaf = r.type === 'leaf';
        const px = isLeaf ? leafX : grandX;
        const startX = isLeaf ? branchX + branchW : leafX + 2;
        out += `<path d="M${startX} ${cy} L${px - 5} ${cy}" stroke="${r.color}"
          stroke-width="1" opacity="0.45" fill="none"/>`;
        out += `<circle cx="${px - 2}" cy="${cy}" r="2.1" fill="${r.color}" opacity="0.85"/>`;
        out += `<text x="${px + 6}" y="${cy + 4}" font-size="${isLeaf ? 12.5 : 11.5}"
          fill="${isLeaf ? C.ink : C.muted}">${esc(isLeaf ? r.text : '· ' + r.text)}</text>`;
      }
      y += h + gapY;
    });

    out += '</svg>';
    return out;
  }

  /* ── 流程图 ───────────────────────────────────────── */
  function flowchart(data) {
    const steps = Array.isArray(data.steps) ? data.steps : [];
    if (!steps.length) return '';
    const colors = (data.colors && data.colors.length) ? data.colors : [C.cyan];

    // 框宽按最长的一步自适应：模型给的步骤文字长短不一，
    // 写死宽度会把「确定 low=0, high=n-1」这类步骤截断。
    let textW = 150;
    steps.forEach((s) => {
      textW = Math.max(textW, measure(s.text || '', FONT(12.5)) + 34);
      if (s.kind === 'decide' && s.no) {
        textW = Math.max(textW, measure('否：' + s.no, FONT(11)) + 90);
      }
    });
    const boxW = Math.min(textW, 380);

    const gapY = 30, padX = 30, padY = 18;
    let height = padY * 2;
    steps.forEach((s) => { height += (s.kind === 'decide' ? 58 : 44) + gapY; });
    height -= gapY;
    const width = padX * 2 + boxW + 130;

    const cx = padX + boxW / 2;
    let out = `<svg viewBox="0 0 ${width} ${height}" width="100%" style="max-width:${width}px"
      xmlns="http://www.w3.org/2000/svg" class="viz-svg">`;

    let y = padY;
    steps.forEach((s, i) => {
      const color = colors[i % colors.length];
      const isDecide = s.kind === 'decide';
      const h = isDecide ? 58 : 44;
      const cy = y + h / 2;
      const text = s.text || '';

      if (s.kind === 'start' || s.kind === 'end') {
        out += `<rect x="${cx - boxW / 2}" y="${y}" width="${boxW}" height="${h}" rx="${h / 2}"
          fill="${color}1f" stroke="${color}" stroke-width="1.3"/>`;
      } else if (isDecide) {
        const w = boxW * 0.96;
        out += `<polygon points="${cx - w / 2},${cy} ${cx},${y} ${cx + w / 2},${cy} ${cx},${y + h}"
          fill="${C.gold}18" stroke="${C.gold}" stroke-width="1.3"/>`;
      } else {
        out += `<rect x="${cx - boxW / 2}" y="${y}" width="${boxW}" height="${h}" rx="8"
          fill="rgba(255,255,255,0.035)" stroke="${C.lineStrong}" stroke-width="1"/>`;
      }
      const fill = isDecide ? C.gold : (s.kind === 'start' || s.kind === 'end' ? color : C.ink);
      out += `<text x="${cx}" y="${cy + 4.5}" text-anchor="middle" font-size="12.5"
        font-weight="${isDecide || s.kind !== 'step' ? 600 : 400}" fill="${fill}">${esc(text)}</text>`;

      // 序号
      out += `<text x="${padX - 14}" y="${cy + 4}" font-size="11" fill="${C.muted}"
        text-anchor="start">${i + 1}</text>`;

      // 主箭头
      if (i < steps.length - 1) {
        const nextY = cy + h / 2 + gapY + (steps[i + 1].kind === 'decide' ? 29 : 22);
        if (isDecide) {
          out += `<text x="${cx + 9}" y="${cy + h / 2 + 16}" font-size="10.5" fill="${C.green}">是</text>`;
        }
        out += `<path d="M${cx} ${cy + h / 2} L${cx} ${nextY - 4}" stroke="${C.lineStrong}"
          stroke-width="1.2" fill="none" marker-end="url(#vizArrow)"/>`;
      }

      // 判断节点的「否」分支
      if (isDecide && s.no) {
        const label = '否：' + s.no;
        const bw = measure(label, FONT(11)) + 22;
        const rx = cx + boxW / 2 + 14;
        out += `<path d="M${cx + boxW * 0.48} ${cy} L${rx} ${cy}" stroke="${C.rose}"
          stroke-width="1.1" fill="none" opacity="0.8"/>`;
        out += `<rect x="${rx}" y="${cy - 15}" width="${bw}" height="30" rx="6"
          fill="${C.rose}18" stroke="${C.rose}" stroke-width="1"/>`;
        out += `<text x="${rx + bw / 2}" y="${cy + 4.5}" text-anchor="middle" font-size="11"
          fill="${C.rose}">${esc(label)}</text>`;
      }
      y += h + gapY;
    });

    out += `<defs><marker id="vizArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6"
      markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="${C.lineStrong}"/></marker></defs>`;
    out += '</svg>';
    return out;
  }

  /* ── 数组示意图 ───────────────────────────────────── */
  function array(data) {
    const values = Array.isArray(data.values) ? data.values : [];
    if (!values.length) return '';
    const cellW = Math.min(58, Math.max(36, 560 / values.length));
    const cellH = 42, padX = 20, padTop = 34;
    const hi = new Set((data.highlight || []).map(Number));
    const pointers = (data.pointers || []).filter((p) =>
      Number(p.index) >= 0 && Number(p.index) < values.length);

    // 指针标签可能撞在一起（low / mid / high 经常挨着），
    // 所以先算每个标签的占位区间，重叠的就往下推到下一层。
    const lanes = [];
    const placed = pointers.map((p, i) => {
      const idx = Number(p.index);
      const px = padX + idx * cellW + cellW / 2;
      const half = Math.max(measure(p.label, FONT(11, 600)) / 2 + 5, 16);
      let lane = 0;
      for (;;) {
        const row = lanes[lane] || (lanes[lane] = []);
        const clash = row.some(([a, b]) => px - half < b && px + half > a);
        if (!clash) { row.push([px - half, px + half]); break; }
        lane += 1;
      }
      return { label: p.label, idx, px, lane, color: [C.cyan, C.violet, C.rose, C.green, C.blue][i % 5] };
    });

    const laneCount = Math.max(1, lanes.length);
    const ptrTop = padTop + cellH + 6;
    const ptrH = 20 + laneCount * 17;
    const noteH = data.note ? 22 : 0;
    const height = ptrTop + ptrH + noteH + 8;
    const width = padX * 2 + cellW * values.length;

    let out = `<svg viewBox="0 0 ${width} ${height}" width="100%" style="max-width:${width}px"
      xmlns="http://www.w3.org/2000/svg" class="viz-svg">`;

    // 数组名
    out += `<text x="${padX}" y="18" font-size="12" fill="${C.muted}">${esc(data.title || '')}</text>`;

    values.forEach((v, i) => {
      const x = padX + i * cellW;
      const on = hi.has(i);
      out += `<rect x="${x}" y="${padTop}" width="${cellW}" height="${cellH}" rx="6"
        fill="${on ? C.gold + '26' : 'rgba(255,255,255,0.035)'}"
        stroke="${on ? C.gold : C.lineStrong}" stroke-width="${on ? 1.5 : 1}"/>`;
      out += `<text x="${x + cellW / 2}" y="${padTop + cellH / 2 + 5}" text-anchor="middle"
        font-size="13" font-weight="${on ? 700 : 400}"
        fill="${on ? C.gold : C.ink}">${esc(v)}</text>`;
      out += `<text x="${x + cellW / 2}" y="${padTop + cellH + 15}" text-anchor="middle"
        font-size="10" fill="${C.muted}">${i}</text>`;
    });

    // 指针：标签按 lane 分层，竖线从各自那层拉到数组下沿
    placed.forEach((p) => {
      const ty = ptrTop + 20 + p.lane * 17;
      out += `<path d="M${p.px} ${ptrTop - 2} L${p.px} ${ty - 8}" stroke="${p.color}"
        stroke-width="1.1" fill="none" opacity="0.9"/>`;
      out += `<text x="${p.px}" y="${ty + 3}" text-anchor="middle" font-size="11"
        font-weight="600" fill="${p.color}">${esc(p.label)}</text>`;
    });

    if (data.note) {
      out += `<text x="${padX}" y="${height - 8}" font-size="11.5"
        fill="${C.muted}">${esc(data.note)}</text>`;
    }

    out += '</svg>';
    return out;
  }

  function fit(text, max) {
    text = String(text == null ? '' : text);
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
  }

  /* ── 对外接口 ─────────────────────────────────────── */
  const RENDERERS = { mindmap, flowchart, array };

  return {
    /** 把工具返回的 render 数据画成 SVG 字符串；不认识的结构返回空串 */
    render(data) {
      if (!data || typeof data !== 'object') return '';
      const fn = RENDERERS[data.kind];
      if (!fn) return '';
      try { return fn(data); } catch (error) { return ''; }
    },
    kinds: Object.keys(RENDERERS),
  };
})();
