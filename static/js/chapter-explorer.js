(() => {
  'use strict';
  const body = document.body;
  const chapter = Number(body.dataset.chapter || 1);
  const canvas = document.getElementById('chapter-deepspace');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('.kp-item').forEach((item, index) => {
    item.dataset.routeIndex = `NAV-${String(index + 1).padStart(2, '0')}`;
    item.style.setProperty('--route-delay', `${index * 70}ms`);
  });

  // Remove emoji presentation from the most frequently seen controls without
  // changing IDs, onclick handlers, API contracts, or accessible text.
  const replacements = [
    ['.kp-ex-title', '本章校验任务'], ['.btn-notes-toggle', '我的探索笔记'],
    ['.btn-comic', '视觉讲解'], ['.code-ex-title', '编程训练舱']
  ];
  replacements.forEach(([selector, text]) => document.querySelectorAll(selector).forEach(el => {
    const suffix = el.querySelector('span');
    el.childNodes.forEach(node => { if (node.nodeType === 3) node.textContent = ''; });
    el.insertAdjacentText('afterbegin', text + ' ');
    if (suffix) el.appendChild(suffix);
  }));

  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: true });
  let stars = [], dust = [], raf = 0, width = 0, height = 0, dpr = 1, pointerX = .5, pointerY = .5;
  const palette = ['114,246,228','157,140,255','255,191,112','128,183,255','141,247,175'];
  const tone = palette[(chapter - 1) % palette.length];
  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 1.6); width = innerWidth; height = innerHeight;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    canvas.style.width = width + 'px'; canvas.style.height = height + 'px'; ctx.setTransform(dpr,0,0,dpr,0,0);
    const count = Math.min(190, Math.floor(width * height / 8500));
    stars = Array.from({length:count}, () => ({x:Math.random()*width,y:Math.random()*height,r:Math.random()*1.3+.15,a:Math.random()*.65+.18,s:Math.random()*.07+.015,p:Math.random()*6.28}));
    dust = Array.from({length:5}, () => ({x:Math.random()*width,y:Math.random()*height,r:80+Math.random()*190,a:.012+Math.random()*.018}));
  }
  function draw(t=0) {
    ctx.clearRect(0,0,width,height);
    dust.forEach(d => { const g=ctx.createRadialGradient(d.x,d.y,0,d.x,d.y,d.r); g.addColorStop(0,`rgba(${tone},${d.a})`); g.addColorStop(1,`rgba(${tone},0)`); ctx.fillStyle=g; ctx.fillRect(d.x-d.r,d.y-d.r,d.r*2,d.r*2); });
    const ox=(pointerX-.5)*10, oy=(pointerY-.5)*7;
    stars.forEach((s,i) => { const twinkle=reduced?1:.72+.28*Math.sin(t*s.s+s.p); ctx.beginPath(); ctx.arc(s.x+ox*(s.r/1.5),s.y+oy*(s.r/1.5),s.r,0,Math.PI*2); ctx.fillStyle=i%13===0?`rgba(${tone},${s.a*twinkle})`:`rgba(224,240,255,${s.a*twinkle})`; ctx.fill(); });
    if (!reduced) raf=requestAnimationFrame(draw);
  }
  addEventListener('resize', resize, {passive:true});
  addEventListener('pointermove', e => { pointerX=e.clientX/Math.max(width,1); pointerY=e.clientY/Math.max(height,1); }, {passive:true});
  document.addEventListener('visibilitychange', () => { if(document.hidden){cancelAnimationFrame(raf);} else if(!reduced){raf=requestAnimationFrame(draw);} });
  resize(); draw();

  const requested = new URLSearchParams(location.search).get('kp');
  if (requested !== null) requestAnimationFrame(() => {
    const target = document.querySelector(`.kp-item[data-kp-index="${Number(requested)}"]`);
    if (target) target.scrollIntoView({behavior: reduced?'auto':'smooth', block:'center'});
  });
})();
