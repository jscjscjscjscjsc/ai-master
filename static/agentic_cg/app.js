const CONFIG = {
  learningUrl: "../../chapter/4",
  sceneDuration: 6000,
  autoplay: true,
};

const labels = ["序章", "协作", "自主", "编排", "启程"];
const scenes = [...document.querySelectorAll(".scene")];
const timeline = document.querySelector("#timeline");
const playToggle = document.querySelector("#playToggle");
const startButton = document.querySelector("#startButton");
const currentTime = document.querySelector("#currentTime");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let sceneIndex = 0;
let playing = CONFIG.autoplay && !reducedMotion;
let elapsed = 0;
let lastFrame = performance.now();

function resolveLearningUrl() {
  const params = new URLSearchParams(location.search);
  const target = params.get("target") || document.documentElement.dataset.target || CONFIG.learningUrl;
  startButton.href = target;
}

function renderTimeline() {
  timeline.innerHTML = labels.map((label, index) => `<button class="timeline-step" type="button" role="tab" aria-label="播放${label}" data-scene="${index}"><span>0${index + 1} ${label}</span><i></i></button>`).join("");
}

function setScene(index, reset = true) {
  sceneIndex = Math.max(0, Math.min(scenes.length - 1, index));
  document.body.dataset.scene = String(sceneIndex);
  scenes.forEach((scene, itemIndex) => {
    const active = itemIndex === sceneIndex;
    scene.classList.toggle("active", active);
    scene.setAttribute("aria-hidden", String(!active));
  });
  document.querySelectorAll(".timeline-step").forEach((step, itemIndex) => {
    step.classList.toggle("active", itemIndex === sceneIndex);
    step.classList.toggle("complete", itemIndex < sceneIndex);
    step.style.setProperty("--progress", itemIndex < sceneIndex ? "100%" : "0%");
  });
  if (reset) elapsed = 0;
  if (sceneIndex === scenes.length - 1) playing = false;
  updatePlayState();
}

function updatePlayState() {
  document.body.classList.toggle("paused", !playing);
  playToggle.setAttribute("aria-label", playing ? "暂停自动播放" : "继续自动播放");
}

function togglePlayback() {
  if (!playing && sceneIndex === scenes.length - 1) setScene(0);
  playing = !playing;
  updatePlayState();
}

function formatTime(milliseconds) {
  const seconds = Math.min(30, Math.floor((sceneIndex * CONFIG.sceneDuration + milliseconds) / 1000));
  return `00:${String(seconds).padStart(2, "0")}`;
}

function animate(now) {
  const delta = Math.min(now - lastFrame, 50);
  lastFrame = now;
  if (playing) {
    elapsed += delta;
    const activeStep = document.querySelector(".timeline-step.active");
    if (activeStep) activeStep.style.setProperty("--progress", `${Math.min(100, elapsed / CONFIG.sceneDuration * 100)}%`);
    currentTime.textContent = formatTime(elapsed);
    if (elapsed >= CONFIG.sceneDuration) setScene(sceneIndex + 1);
  }
  requestAnimationFrame(animate);
}

function initControls() {
  timeline.addEventListener("click", (event) => {
    const step = event.target.closest("[data-scene]");
    if (!step) return;
    playing = Number(step.dataset.scene) !== scenes.length - 1;
    setScene(Number(step.dataset.scene));
  });
  playToggle.addEventListener("click", togglePlayback);
  document.querySelector("#skipButton").addEventListener("click", () => setScene(scenes.length - 1));
  document.querySelector(".brand").addEventListener("click", (event) => { event.preventDefault(); playing = !reducedMotion; setScene(0); });
  window.addEventListener("keydown", (event) => {
    if (event.code === "Space") { event.preventDefault(); togglePlayback(); }
    if (event.code === "ArrowRight") { playing = sceneIndex + 1 < scenes.length - 1; setScene(sceneIndex + 1); }
    if (event.code === "ArrowLeft") { playing = false; setScene(sceneIndex - 1); }
  });
}

function initCosmos() {
  const canvas = document.querySelector("#cosmos");
  const context = canvas.getContext("2d", { alpha: false });
  let width = 0;
  let height = 0;
  let stars = [];
  let comets = [];
  let pointer = { x: 0, y: 0 };

  function makeStar() { return { x: Math.random() * width, y: Math.random() * height, z: Math.random() * .9 + .1, phase: Math.random() * Math.PI * 2, hue: Math.random() > .8 ? 169 : Math.random() > .5 ? 225 : 255 }; }
  function makeComet() { return { x: Math.random() * width * .5, y: -100 - Math.random() * height, speed: .7 + Math.random() * .7, length: 70 + Math.random() * 130, life: Math.random() }; }
  function resize() {
    const ratio = Math.min(devicePixelRatio || 1, 1.75);
    width = innerWidth; height = innerHeight;
    canvas.width = Math.floor(width * ratio); canvas.height = Math.floor(height * ratio);
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    stars = Array.from({ length: Math.min(240, Math.floor(width * height / 6500)) }, makeStar);
    comets = Array.from({ length: 3 }, makeComet);
    pointer = { x: width / 2, y: height / 2 };
  }
  function draw(now) {
    context.fillStyle = "#030611"; context.fillRect(0, 0, width, height);
    const shiftX = (pointer.x / width - .5) * 10; const shiftY = (pointer.y / height - .5) * 8;
    stars.forEach((star) => {
      const alpha = .22 + star.z * .58 + Math.sin(now * .0012 + star.phase) * .12;
      const x = star.x + shiftX * star.z; const y = star.y + shiftY * star.z;
      context.beginPath(); context.fillStyle = `hsla(${star.hue},90%,85%,${alpha})`; context.arc(x, y, Math.max(.45, star.z * 1.45), 0, Math.PI * 2); context.fill();
    });
    if (!reducedMotion) comets.forEach((comet) => {
      if (playing) { comet.x += comet.speed * .35; comet.y += comet.speed; comet.life += .001; }
      if (comet.y > height + 200) Object.assign(comet, makeComet());
      const gradient = context.createLinearGradient(comet.x, comet.y, comet.x - comet.length * .45, comet.y - comet.length);
      gradient.addColorStop(0, "rgba(121,246,229,.65)"); gradient.addColorStop(1, "rgba(121,246,229,0)");
      context.beginPath(); context.strokeStyle = gradient; context.lineWidth = .8; context.moveTo(comet.x, comet.y); context.lineTo(comet.x - comet.length * .45, comet.y - comet.length); context.stroke();
    });
    requestAnimationFrame(draw);
  }
  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("pointermove", (event) => { pointer = { x: event.clientX, y: event.clientY }; }, { passive: true });
  resize(); requestAnimationFrame(draw);
}

resolveLearningUrl();
renderTimeline();
initControls();
initCosmos();
setScene(0);
requestAnimationFrame(animate);
