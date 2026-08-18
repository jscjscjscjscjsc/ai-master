/* ============================================================
   AI Master — Transition Animation
   Master Yi meditation silhouette + typewriter quote
   ============================================================ */

(function() {
  'use strict';

  const canvas = document.getElementById('yi-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const W = canvas.width;   // 300
  const H = canvas.height;  // 400

  let time = 0;
  let rafId = null;

  /* ==================== Drawing ==================== */

  function drawYi(t) {
    ctx.clearRect(0, 0, W, H);

    // Breathing: subtle scale pulse
    const breath = 1 + Math.sin(t * 0.02) * 0.006;
    const glowAlpha = 0.3 + Math.sin(t * 0.025) * 0.1;

    ctx.save();
    ctx.translate(W / 2, H / 2 + 20);
    ctx.scale(breath, breath);
    ctx.translate(-W / 2, -(H / 2 + 20));

    const cx = W / 2;     // center x
    const baseY = 380;    // bottom

    // ── Meditating silhouette ──

    // Head (circle)
    const headR = 24;
    const headY = 100;
    drawGlowCircle(ctx, cx, headY, headR, glowAlpha);

    // Topknot / ponytail (small circle above head)
    drawGlowCircle(ctx, cx, headY - headR - 6, 8, glowAlpha);

    // Shoulders and upper body (trapezoid)
    ctx.beginPath();
    ctx.moveTo(cx - 48, headY + headR + 5);   // left neck
    ctx.lineTo(cx + 48, headY + headR + 5);    // right neck
    ctx.lineTo(cx + 62, headY + 85);           // right shoulder/waist
    ctx.lineTo(cx - 62, headY + 85);           // left shoulder/waist
    ctx.closePath();
    fillGlow(ctx, glowAlpha);

    // Lower body — crossed legs (lotus position)
    ctx.beginPath();
    // Left leg folds in
    ctx.moveTo(cx - 62, headY + 85);
    ctx.quadraticCurveTo(cx - 75, headY + 120, cx - 40, headY + 165);
    // Right leg folds in
    ctx.lineTo(cx + 40, headY + 165);
    ctx.quadraticCurveTo(cx + 75, headY + 120, cx + 62, headY + 85);
    ctx.closePath();
    fillGlow(ctx, glowAlpha);

    // Feet visible on top of crossed legs
    ctx.beginPath();
    ctx.ellipse(cx - 22, headY + 138, 14, 7, -0.3, 0, Math.PI * 2);
    fillGlow(ctx, glowAlpha);
    ctx.beginPath();
    ctx.ellipse(cx + 22, headY + 138, 14, 7, 0.3, 0, Math.PI * 2);
    fillGlow(ctx, glowAlpha);

    // Arms resting on legs
    // Left arm
    ctx.beginPath();
    ctx.moveTo(cx - 48, headY + 30);
    ctx.quadraticCurveTo(cx - 68, headY + 70, cx - 50, headY + 110);
    ctx.lineTo(cx - 38, headY + 106);
    ctx.quadraticCurveTo(cx - 54, headY + 70, cx - 38, headY + 34);
    ctx.closePath();
    fillGlow(ctx, glowAlpha);

    // Right arm
    ctx.beginPath();
    ctx.moveTo(cx + 48, headY + 30);
    ctx.quadraticCurveTo(cx + 68, headY + 70, cx + 50, headY + 110);
    ctx.lineTo(cx + 38, headY + 106);
    ctx.quadraticCurveTo(cx + 54, headY + 70, cx + 38, headY + 34);
    ctx.closePath();
    fillGlow(ctx, glowAlpha);

    // Hands resting on knees (palms up)
    ctx.beginPath();
    ctx.ellipse(cx - 44, headY + 108, 10, 5, -0.2, 0, Math.PI * 2);
    fillGlow(ctx, glowAlpha * 1.2);
    ctx.beginPath();
    ctx.ellipse(cx + 44, headY + 108, 10, 5, 0.2, 0, Math.PI * 2);
    fillGlow(ctx, glowAlpha * 1.2);

    // ── Sword resting horizontally across lap ──
    const swordY = headY + 95;
    const swordLen = 130;
    const swordGlow = 0.5 + Math.sin(t * 0.03) * 0.15;

    // Sword scabbard / blade
    ctx.save();
    ctx.shadowColor = 'rgba(0, 212, 255, 0.6)';
    ctx.shadowBlur = 12 * swordGlow;

    ctx.beginPath();
    ctx.moveTo(cx - swordLen / 2, swordY);
    ctx.lineTo(cx + swordLen / 2, swordY);
    ctx.strokeStyle = `rgba(0, 212, 255, ${0.4 + swordGlow * 0.4})`;
    ctx.lineWidth = 4;
    ctx.stroke();

    // Sword guard (tsuba)
    ctx.beginPath();
    ctx.moveTo(cx - 6, swordY - 7);
    ctx.lineTo(cx + 6, swordY - 7);
    ctx.lineTo(cx + 6, swordY + 7);
    ctx.lineTo(cx - 6, swordY + 7);
    ctx.closePath();
    ctx.fillStyle = `rgba(163, 113, 247, ${0.5 + swordGlow * 0.3})`;
    ctx.fill();

    // Sword handle wrapping
    ctx.strokeStyle = `rgba(200, 180, 140, ${0.3 + swordGlow * 0.2})`;
    ctx.lineWidth = 3;
    for (let i = 0; i < 5; i++) {
      const sx = cx - swordLen / 2 + 12 + i * 10;
      ctx.beginPath();
      ctx.moveTo(sx, swordY - 2);
      ctx.lineTo(sx + 3, swordY + 2);
      ctx.stroke();
    }

    ctx.restore();

    // ── Meditation glow around body ──
    const grad = ctx.createRadialGradient(cx, headY + 60, 10, cx, headY + 60, 140);
    grad.addColorStop(0, `rgba(0, 212, 255, ${0.04 * glowAlpha * 2})`);
    grad.addColorStop(0.5, `rgba(163, 113, 247, ${0.03 * glowAlpha * 2})`);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - 140, headY - 60, 280, 200);

    ctx.restore();
  }

  function drawGlowCircle(ctx, x, y, r, alpha) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    fillGlow(ctx, alpha);
  }

  function fillGlow(ctx, alpha) {
    ctx.fillStyle = `rgba(200, 215, 235, ${0.15 + alpha * 0.35})`;
    ctx.shadowColor = 'rgba(0, 212, 255, 0.3)';
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  /* ==================== Animation Loop ==================== */

  function animate() {
    drawYi(time);
    time++;
    rafId = requestAnimationFrame(animate);
  }

  /* ==================== Typewriter ==================== */

  const QUOTE = '真正的大师永远怀着一颗学徒的心';
  const CHAR_INTERVAL = 130; // ms per character
  const quoteEl = document.getElementById('quote-text');
  const cursorEl = document.getElementById('quote-cursor');

  function startTypewriter() {
    let i = 0;
    quoteEl.innerHTML = '';

    function typeNext() {
      if (i < QUOTE.length) {
        const span = document.createElement('span');
        span.className = 'char';
        span.textContent = QUOTE[i];
        quoteEl.appendChild(span);
        i++;
        setTimeout(typeNext, CHAR_INTERVAL);
      } else {
        // All characters done — cursor keeps blinking until fade-out
      }
    }

    // Small delay before starting
    setTimeout(typeNext, 500);
  }

  /* ==================== Redirect Timer ==================== */

  function startRedirectTimer() {
    // Total: ~5.2s from page load
    // Typewriter finishes at 500ms + 17*130ms = 2710ms
    // Redirect at ~5s
    setTimeout(() => {
      // Fade out the transition overlay
      const overlay = document.querySelector('.transition-overlay');
      if (overlay) {
        overlay.classList.add('fade-out');
      }
    }, 4300);

    setTimeout(() => {
      if (rafId) cancelAnimationFrame(rafId);
      window.location.href = '../../dashboard';
    }, 5000);
  }

  /* ==================== Init ==================== */

  function init() {
    animate();
    startTypewriter();
    startRedirectTimer();
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
