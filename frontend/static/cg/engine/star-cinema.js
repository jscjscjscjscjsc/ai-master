/* ===========================================================
   StarCinema — 章节开场 CG 引擎
   -----------------------------------------------------------
   这是从原版 AI Master 的 transformer_cg.html 里提炼出来的「导演引擎」：
   画布、星空、发光、渐变标题、时间轴、字幕、公式层、进度条、键盘控制、
   全屏、postMessage 外部控制，全部在这里。**一部 CG = 一份场景表。**

   为什么要抽出来：原版每一部 CG 都把这 700 行引擎复制一遍，于是
   改一个动效要同步改六处，最后只有 transformer 那部是新的。
   提炼之后，新做一部 CG 只需要写 SCENES —— 也就是「第几幕讲什么」。

   场景表接口（与原版完全一致，方便沿用已有 CG 的写法）：
     { id, num, title, sub, caption, duration,
       init(),                    // 进入这一幕时调一次
       update(ctx, p, dt) }       // 每帧调用；p 是 0→1 的幕内进度

   用法：
     StarCinema.start({
       title: 'API ENGINEERING',
       learnUrl: '/chapter/2',
       scenes: SCENES,
     });
   =========================================================== */

window.StarCinema = (function () {
  'use strict';

  // ── 常量与缓动 ─────────────────────────────────────────
  const TAU = Math.PI * 2;
  const C = {
    cyan: '#00d9ff', purple: '#a855f7', pink: '#ec4899',
    green: '#34d399', amber: '#fbbf24', white: '#e6edf6', muted: '#8aa0bd',
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeIn = (t) => t * t * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // ── 画布 ───────────────────────────────────────────────
  let canvas, ctx, W = 0, H = 0, DPR = 1;
  let stars = [], starsFar = [];

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    initStars();
  }

  function initStars() {
    stars = [];
    starsFar = [];
    const near = Math.round(Math.min(W, H) / 5);
    const far = Math.round(Math.min(W, H) / 9);
    for (let i = 0; i < near; i += 1) {
      stars.push({ x: rand(0, W), y: rand(0, H), r: rand(0.5, 1.7), a: rand(0.25, 0.85), ph: rand(0, TAU) });
    }
    for (let i = 0; i < far; i += 1) {
      starsFar.push({ x: rand(0, W), y: rand(0, H), r: rand(0.3, 0.9), a: rand(0.12, 0.4), ph: rand(0, TAU) });
    }
  }

  function drawStars(t) {
    for (const s of starsFar) {
      const a = s.a * (0.6 + 0.4 * Math.sin(t * 0.0007 + s.ph));
      ctx.globalAlpha = a;
      ctx.fillStyle = '#9fd8ff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
    }
    for (const s of stars) {
      const a = s.a * (0.55 + 0.45 * Math.sin(t * 0.0013 + s.ph));
      glowDot(s.x, s.y, s.r, '#dff1ff', a * 0.9);
    }
    ctx.globalAlpha = 1;
  }

  // ── 绘图层辅助 ─────────────────────────────────────────
  // 一个预烘焙的发光贴图：每帧 createRadialGradient 会明显掉帧，
  // 原版就是靠这个把发光点从「几百个每帧」压到「一次贴图」。
  let glowSprite = null;

  function buildGlowSprite() {
    const size = 128;
    const off = document.createElement('canvas');
    off.width = off.height = size;
    const c = off.getContext('2d');
    const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.28, 'rgba(255,255,255,.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, size, size);
    glowSprite = off;
  }

  function glowDot(x, y, r, color, alpha) {
    if (alpha <= 0.002 || !glowSprite) return;
    const size = r * 7;
    ctx.globalAlpha = alpha;
    // 彩色部分靠混合模式染色，白色贴图负责形状
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(glowSprite, x - size / 2, y - size / 2, size, size);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha * 0.9;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.6, r), 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function hexA(hex, a) {
    const h = String(hex).replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function gradText(text, cx, cy, size, alpha, weight) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `${weight || 900} ${size}px Orbitron, 'Noto Sans SC', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const g = ctx.createLinearGradient(cx - size * 2.4, cy, cx + size * 2.4, cy);
    g.addColorStop(0, C.cyan);
    g.addColorStop(0.6, C.purple);
    g.addColorStop(1, C.pink);
    ctx.fillStyle = g;
    ctx.shadowColor = hexA(C.cyan, 0.55 * alpha);
    ctx.shadowBlur = 30;
    ctx.fillText(text, cx, cy);
    ctx.restore();
  }

  function drawLabel(text, x, y, color, alpha, size, align) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `500 ${size || 14}px 'JetBrains Mono', 'Noto Sans SC', monospace`;
    ctx.fillStyle = color || C.muted;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  /** 圆角矩形路径。dashed=true 时画虚线框（表示"将来才有的东西"）。 */
  function roundRect(x, y, w, h, r, opts) {
    const o = opts || {};
    ctx.save();
    if (o.fill) { ctx.fillStyle = o.fill; }
    if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = o.lw || 1.4; }
    if (o.dash) ctx.setLineDash(o.dash);
    if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
    if (o.shadow) { ctx.shadowColor = o.shadow; ctx.shadowBlur = o.blur || 18; }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    if (o.fill) ctx.fill();
    if (o.stroke) ctx.stroke();
    ctx.restore();
  }

  /** 带箭头的连线。用于画数据流、依赖、调用关系。 */
  function arrow(x1, y1, x2, y2, color, alpha, width) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 1.6;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const head = 8 + (width || 1.6) * 1.6;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - Math.cos(ang - 0.4) * head, y2 - Math.sin(ang - 0.4) * head);
    ctx.lineTo(x2 - Math.cos(ang + 0.4) * head, y2 - Math.sin(ang + 0.4) * head);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  /** 沿路径流动的点：表示"数据在动"，比静态箭头更能说明管线。 */
  function flowDot(x1, y1, x2, y2, t, color, alpha) {
    const k = t - Math.floor(t);
    glowDot(lerp(x1, x2, k), lerp(y1, y2, k), 3.4, color, alpha * (1 - Math.abs(k - 0.5) * 1.2));
  }

  /** 打字机效果：按进度 p 显示 text 的一部分。 */
  function typed(text, p, speed) {
    const n = Math.floor(clamp(p * (speed || 1), 0, 1) * text.length);
    return text.slice(0, n);
  }

  /** 简易柱状图，用于「指标对比」类场景。 */
  function bars(originX, baseY, values, opts) {
    const o = opts || {};
    const bw = o.width || 46;
    const gap = o.gap || 22;
    const max = Math.max.apply(null, values.map((v) => v.value)) || 1;
    const hMax = o.height || 200;
    values.forEach((row, i) => {
      const x = originX + i * (bw + gap);
      const h = (row.value / max) * hMax * (o.grow === undefined ? 1 : o.grow);
      const grad = ctx.createLinearGradient(x, baseY - h, x, baseY);
      grad.addColorStop(0, row.color || C.cyan);
      grad.addColorStop(1, hexA(row.color || C.cyan, 0.18));
      roundRect(x, baseY - h, bw, h, 5, { fill: grad, alpha: o.alpha === undefined ? 1 : o.alpha });
      drawLabel(row.label, x + bw / 2, baseY + 18, C.muted, o.alpha === undefined ? 1 : o.alpha,
        11.5, 'center');
      if (o.showValue !== false) {
        drawLabel(String(row.display || row.value), x + bw / 2, baseY - h - 14,
          row.color || C.cyan, o.alpha === undefined ? 1 : o.alpha, 12, 'center');
      }
    });
  }

  // ── 导演 ───────────────────────────────────────────────
  const Director = {
    idx: 0, t: 0, playing: true, last: 0, raf: 0, frames: 0,
    scenes: [], total: 0, uiHidden: false,

    load(scenes) {
      this.scenes = scenes;
      this.total = scenes.reduce((sum, s) => sum + s.duration, 0);
      this.scenes.forEach((s) => { s._done = false; });
    },

    durationOf(i) { return this.scenes[i].duration; },

    goTo(i) {
      this.idx = clamp(i, 0, this.scenes.length - 1);
      this.t = 0;
      const scene = this.scenes[this.idx];
      scene._done = false;
      onSceneEnter(scene, this.idx);
    },

    next() { if (this.idx < this.scenes.length - 1) this.goTo(this.idx + 1); else this.goTo(0); },
    prev() { if (this.idx > 0) this.goTo(this.idx - 1); },

    play() { this.playing = true; document.body.classList.remove('paused'); },
    pause() { this.playing = false; document.body.classList.add('paused'); },
    toggle() { this.playing ? this.pause() : this.play(); },

    /** 跳到第 index 幕，并把幕内进度设为 within（0–1）。 */
    seekScene(index, within) {
      this.goTo(index);
      this.t = clamp(within === undefined ? 0.5 : within, 0, 1) * this.scenes[this.idx].duration;
    },

    /** 暂停并停在某一幕的某个进度上 —— 截图/复核时用，画面稳定可复现。 */
    freezeAt(index, within) {
      this.pause();
      this.seekScene(index, within);
    },

    seek(ratio) {
      const target = clamp(ratio, 0, 1) * this.total;
      let acc = 0;
      for (let i = 0; i < this.scenes.length; i += 1) {
        if (acc + this.scenes[i].duration > target) {
          this.goTo(i);
          this.t = target - acc;
          return;
        }
        acc += this.scenes[i].duration;
      }
      this.goTo(this.scenes.length - 1);
    },

    tick(now) {
      this.raf = requestAnimationFrame((t) => this.tick(t));
      this.frames += 1;
      if (!this.last) this.last = now;
      const dt = Math.min(64, now - this.last);
      this.last = now;
      const scene = this.scenes[this.idx];

      if (this.playing && !document.hidden) this.t += dt;

      ctx.clearRect(0, 0, W, H);
      drawStars(now);

      const p = clamp(this.t / scene.duration, 0, 1);
      if (!scene._done) { scene._done = true; if (scene.init) scene.init(); }
      if (scene.update) scene.update(ctx, p, dt / 16.67);
      if (p >= 1 && this.playing) this.next();

      this.paintChrome(p, now, scene);
    },

    paintChrome(p, now, scene) {
      const elapsed = this.elapsedBefore() + this.t;
      progressFill.style.width = (elapsed / this.total * 100).toFixed(2) + '%';
      timeLabel.textContent = fmt(elapsed) + ' / ' + fmt(this.total);
      marks.forEach((mk, i) => {
        mk.classList.toggle('cur', i === this.idx);
        mk.classList.toggle('passed', i < this.idx);
      });
      captionEl.classList.toggle('show', Boolean(scene.caption) && p > 0.12 && p < 0.92);
      if (scene.caption) captionEl.textContent = scene.caption;
      ctaWrap.classList.toggle('show', this.idx === this.scenes.length - 1 && p > 0.5);
    },

    elapsedBefore() {
      let acc = 0;
      for (let i = 0; i < this.idx; i += 1) acc += this.scenes[i].duration;
      return acc;
    },
  };

  function fmt(ms) {
    const total = Math.round(ms / 1000);
    return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
  }

  // ── 页面 chrome（标题 / 字幕 / 进度 / CTA）──────────────
  let elNum, elTitle, elSub, captionEl, ctaWrap, progressFill, timeLabel, marks = [];

  function onSceneEnter(scene, index) {
    if (elNum) elNum.textContent = scene.num || String(index + 1).padStart(2, '0');
    if (elTitle) elTitle.textContent = scene.title || '';
    if (elSub) elSub.textContent = scene.sub || '';
    if (scene.onEnter) scene.onEnter();
  }

  function buildChrome(config) {
    elNum = document.getElementById('sceneNum');
    elTitle = document.getElementById('sceneTitle');
    elSub = document.getElementById('sceneSub');
    captionEl = document.getElementById('caption');
    ctaWrap = document.getElementById('ctaWrap');
    progressFill = document.getElementById('progressFill');
    timeLabel = document.getElementById('timeLabel');

    const markBox = document.getElementById('chapterMarks');
    markBox.innerHTML = '';
    marks = config.scenes.map((scene, i) => {
      const node = document.createElement('button');
      node.className = 'mk';
      node.title = scene.title || '';
      node.style.left = (Director.scenes.slice(0, i).reduce((s, x) => s + x.duration, 0)
        + scene.duration / 2) / Director.total * 100 + '%';
      node.addEventListener('click', (event) => {
        event.stopPropagation();
        Director.goTo(i);
      });
      markBox.appendChild(node);
      return node;
    });

    const track = document.getElementById('progressTrack');
    track.addEventListener('click', (event) => {
      const rect = track.getBoundingClientRect();
      Director.seek((event.clientX - rect.left) / rect.width);
    });

    const brand = document.getElementById('brand');
    if (brand && config.title) brand.innerHTML = config.title.replace(/(\S+)$/, '<span>$1</span>');

    const cta = document.getElementById('ctaBtn');
    if (cta) {
      cta.href = config.learnUrl || '/';
      const label = document.getElementById('ctaLabel');
      if (label && config.learnLabel) label.textContent = config.learnLabel;
    }
    const ctaSub = document.getElementById('ctaSub');
    if (ctaSub && config.learnSub) ctaSub.textContent = config.learnSub;
  }

  function bindInput() {
    document.getElementById('ctrlPlay').addEventListener('click', () => Director.toggle());
    document.getElementById('ctrlNext').addEventListener('click', () => Director.next());
    document.getElementById('ctrlPrev').addEventListener('click', () => Director.prev());
    document.getElementById('ctrlFull').addEventListener('click', toggleFullscreen);
    document.getElementById('ctrlSkip').addEventListener('click', () => Director.goTo(Director.scenes.length - 1));

    window.addEventListener('keydown', (event) => {
      if ([' ', 'ArrowRight', 'ArrowLeft', 'f', 'F', 'Escape'].includes(event.key)) event.preventDefault();
      if (event.key === ' ') Director.toggle();
      else if (event.key === 'ArrowRight') Director.next();
      else if (event.key === 'ArrowLeft') Director.prev();
      else if (event.key === 'f' || event.key === 'F') toggleFullscreen();
      else if (event.key === 'h' || event.key === 'H') {
        Director.uiHidden = !Director.uiHidden;
        document.body.classList.toggle('ui-hidden', Director.uiHidden);
      }
    });
    // 鼠标静止 3 秒自动收起控件 —— 看 CG 时不该有按钮挡着
    let idle = 0;
    document.addEventListener('mousemove', () => {
      document.body.classList.remove('ui-hidden');
      clearTimeout(idle);
      idle = setTimeout(() => document.body.classList.add('ui-hidden'), 3000);
    });
    window.addEventListener('resize', () => { clearTimeout(idle); resize(); });
    window.addEventListener('message', (event) => {
      const data = event.data || {};
      if (!String(data.type || '').includes('cg')) return;
      if (data.cmd === 'play') Director.play();
      else if (data.cmd === 'pause') Director.pause();
      else if (data.cmd === 'toggle') Director.toggle();
      else if (data.cmd === 'next') Director.next();
      else if (data.cmd === 'prev') Director.prev();
      else if (data.cmd === 'goto') Director.goTo(Number(data.index) || 0);
    });
  }

  function toggleFullscreen() {
    const root = document.documentElement;
    if (!document.fullscreenElement) {
      (root.requestFullscreen || root.webkitRequestFullscreen || function () {}).call(root);
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document);
    }
  }

  function start(config) {
    canvas = document.getElementById('stage');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    buildGlowSprite();
    resize();

    Director.load(config.scenes);
    buildChrome(config);
    bindInput();

    const params = new URLSearchParams(location.search);
    if (params.get('autoplay') === '0') Director.pause();
    const startAt = Number(params.get('start') || 1);
    Director.goTo(clamp(startAt - 1, 0, config.scenes.length - 1));
    if (params.get('loop') === '1') {
      // 循环播放时重头来
      Director.next = function () {
        if (this.idx < this.scenes.length - 1) this.goTo(this.idx + 1);
        else this.goTo(0);
      };
    }
    if (params.get('controls') === '0') document.body.classList.add('ui-hidden');

    // 只读调试探针：供 tools/cgcheck.mjs 判断「引擎是否真的在跑」。
    // 黑屏和正常播放都是黑的背景，只有读到帧计数才能区分。
    window.StarCinemaDebug = {
      get scenes() { return Director.scenes; },
      get idx() { return Director.idx; },
      get frames() { return Director.frames; },
      get progress() { return Director.total ? Director.elapsedBefore() / Director.total : 0; },
      goTo: (i) => Director.goTo(i),
      next: () => Director.next(),
      prev: () => Director.prev(),
      seekScene: (i, w) => Director.seekScene(i, w),
      freezeAt: (i, w) => Director.freezeAt(i, w),
      play: () => Director.play(),
      pause: () => Director.pause(),
    };

    requestAnimationFrame((t) => Director.tick(t));
  }

  return {
    start, C, TAU, lerp, clamp, easeIn, easeOut, easeInOut, rand, pick,
    glowDot, gradText, hexA, drawLabel, roundRect, arrow, flowDot, typed, bars,
    get W() { return W; },
    get H() { return H; },
  };
})();
