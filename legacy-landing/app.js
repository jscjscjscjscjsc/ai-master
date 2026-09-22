// ===== Skip intro if already watched in this session =====
// 避免每次回退都重新播放 20 秒开场动画
try {
  if (sessionStorage.getItem("aimaster_intro_watched") === "1") {
    window.location.replace("./login.html");
  }
} catch (e) {}

const scenes = [
  {
    kicker: "关卡 01 / 唤醒",
    title: "把大模型装进一场可闯关的学习冒险",
    text: "AIMaster 让每一次提问、实验、创作和复盘都变成一次升级。你不是旁观 AI 的人，而是亲手驾驭模型能力的探索者。",
    mission: "新手觉醒",
  },
  {
    kicker: "关卡 02 / 对话",
    title: "智能体问答，把问题拆成可抵达的路径",
    text: "遇到概念、案例、代码、作业，直接问。智能体会追问背景、拆解步骤、给出下一步行动，让学习从卡住变成推进。",
    mission: "智能问答",
  },
  {
    kicker: "关卡 03 / 实验",
    title: "进入模型实验室，看见参数背后的推理火花",
    text: "调温度、换提示词、对比模型输出。AIMaster 把抽象的大模型能力变成可观察、可复盘、可迭代的实验现场。",
    mission: "模型实验室",
  },
  {
    kicker: "关卡 04 / 创作",
    title: "PPT、思维导图、LLM 代码模拟，一路带练到升华",
    text: "把知识整理成演示，把思路展开成导图，把代码逻辑拆成可模拟的训练关卡。最后，真正感受大模型的魅力。",
    mission: "作品升华",
  },
];

const canvas = document.querySelector("#starfield");
const ctx = canvas.getContext("2d");
const body = document.body;
const sceneKicker = document.querySelector("#sceneKicker");
const sceneTitle = document.querySelector("#sceneTitle");
const sceneText = document.querySelector("#sceneText");
const missionName = document.querySelector("#missionName");
const progressFill = document.querySelector("#progressFill");
const featureDeck = document.querySelector("#featureDeck");
const finalGate = document.querySelector("#finalGate");
const startButton = document.querySelector("#startButton");
const playToggle = document.querySelector("#playToggle");
const prevScene = document.querySelector("#prevScene");
const nextScene = document.querySelector("#nextScene");

let sceneIndex = 0;
let playing = true;
let lastStep = performance.now();
let sceneElapsed = 0;
let width = 0;
let height = 0;
let particles = [];

const sceneDuration = 5200;
const particleCount = 140;

function resizeCanvas() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  particles = Array.from({ length: particleCount }, createParticle);
}

function createParticle() {
  return {
    x: Math.random() * width,
    y: Math.random() * height,
    z: Math.random() * 0.9 + 0.1,
    speed: Math.random() * 0.8 + 0.25,
    hue: Math.random() > 0.55 ? "18, 231, 255" : Math.random() > 0.45 ? "96, 255, 176" : "255, 209, 102",
  };
}

function drawParticles(delta) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(2, 5, 12, 0.22)";
  ctx.fillRect(0, 0, width, height);

  const vanishingX = width * 0.5;
  const vanishingY = height * 0.48;

  particles.forEach((particle) => {
    if (playing) {
      const dx = particle.x - vanishingX;
      const dy = particle.y - vanishingY;
      particle.x += dx * 0.0009 * particle.speed * delta;
      particle.y += dy * 0.0009 * particle.speed * delta;
      particle.z += 0.00042 * particle.speed * delta;
    }

    if (particle.x < -80 || particle.x > width + 80 || particle.y < -80 || particle.y > height + 80 || particle.z > 1.8) {
      Object.assign(particle, createParticle(), {
        x: vanishingX + (Math.random() - 0.5) * 120,
        y: vanishingY + (Math.random() - 0.5) * 120,
        z: 0.1,
      });
    }

    const size = Math.max(1, particle.z * 2.6);
    const tail = 16 * particle.z;
    ctx.beginPath();
    ctx.strokeStyle = `rgba(${particle.hue}, ${0.18 + particle.z * 0.35})`;
    ctx.lineWidth = size;
    ctx.moveTo(particle.x, particle.y);
    ctx.lineTo(particle.x - (particle.x - vanishingX) * 0.02 * tail, particle.y - (particle.y - vanishingY) * 0.02 * tail);
    ctx.stroke();
  });
}

function setScene(index, resetTimer = true) {
  sceneIndex = (index + scenes.length) % scenes.length;
  const scene = scenes[sceneIndex];
  sceneKicker.textContent = scene.kicker;
  sceneTitle.textContent = scene.title;
  sceneText.textContent = scene.text;
  missionName.textContent = scene.mission;
  progressFill.style.width = `${((sceneIndex + 1) / scenes.length) * 100}%`;
  finalGate.classList.toggle("show", sceneIndex === scenes.length - 1);
  finalGate.setAttribute("aria-hidden", sceneIndex === scenes.length - 1 ? "false" : "true");

  document.querySelectorAll(".feature-card").forEach((card, cardIndex) => {
    card.classList.toggle("active", cardIndex === sceneIndex);
  });

  if (resetTimer) sceneElapsed = 0;
}

function togglePlaying() {
  playing = !playing;
  body.classList.toggle("paused", !playing);
  playToggle.innerHTML = playing ? '<i data-lucide="pause"></i>' : '<i data-lucide="play"></i>';
  createIcons();
}

function animate(now) {
  const delta = Math.min(now - lastStep, 48);
  lastStep = now;

  if (playing) {
    sceneElapsed += delta;
    if (sceneElapsed >= sceneDuration) {
      setScene(sceneIndex + 1);
    }
  }

  drawParticles(delta);
  requestAnimationFrame(animate);
}

function createIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

featureDeck.addEventListener("click", (event) => {
  const card = event.target.closest("[data-scene]");
  if (!card) return;
  setScene(Number(card.dataset.scene));
});

prevScene.addEventListener("click", () => setScene(sceneIndex - 1));
nextScene.addEventListener("click", () => setScene(sceneIndex + 1));
playToggle.addEventListener("click", togglePlaying);

// 点击"开始"按钮：标记已观看并跳转登录页
startButton.addEventListener("click", () => {
  try { sessionStorage.setItem("aimaster_intro_watched", "1"); } catch (e) {}
  window.location.href = "./login.html";
});

// 按 Esc 或空格跳过开场动画，直接进入登录页
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" || e.key === " ") {
    e.preventDefault();
    try { sessionStorage.setItem("aimaster_intro_watched", "1"); } catch (e2) {}
    window.location.href = "./login.html";
  }
});

window.addEventListener("resize", resizeCanvas);

// 动态注入"跳过动画"按钮（右上角，始终可见）
const skipButton = document.createElement("button");
skipButton.type = "button";
skipButton.textContent = "跳过动画 →";
skipButton.setAttribute("aria-label", "跳过开场动画");
skipButton.style.cssText = [
  "position:fixed",
  "top:16px",
  "right:16px",
  "z-index:9999",
  "padding:8px 18px",
  "border:1px solid rgba(18,231,255,0.5)",
  "border-radius:999px",
  "background:rgba(5,12,24,0.7)",
  "color:#12e7ff",
  "font:inherit",
  "font-size:13px",
  "font-weight:700",
  "cursor:pointer",
  "backdrop-filter:blur(8px)",
  "transition:all .2s",
].join(";");
skipButton.addEventListener("mouseenter", () => {
  skipButton.style.background = "rgba(18,231,255,0.15)";
  skipButton.style.transform = "translateY(-1px)";
});
skipButton.addEventListener("mouseleave", () => {
  skipButton.style.background = "rgba(5,12,24,0.7)";
  skipButton.style.transform = "translateY(0)";
});
skipButton.addEventListener("click", () => {
  try { sessionStorage.setItem("aimaster_intro_watched", "1"); } catch (e) {}
  window.location.href = "./login.html";
});
document.body.appendChild(skipButton);

resizeCanvas();
setScene(0);
createIcons();
requestAnimationFrame(animate);
