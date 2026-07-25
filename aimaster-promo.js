const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

const toast = $("#toast");
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2800);
}

function initIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function initRevealsAndRail() {
  const reveals = $$(".reveal");
  const chapters = $$(".chapter");
  const railSteps = $$(".rail-step");
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) entry.target.classList.add("visible");
    });
  }, { threshold: 0.13 });
  reveals.forEach((element) => revealObserver.observe(element));

  const chapterObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      railSteps.forEach((step) => step.classList.toggle("active", step.dataset.section === entry.target.id));
    });
  }, { rootMargin: "-42% 0px -42% 0px", threshold: 0 });
  chapters.forEach((chapter) => chapterObserver.observe(chapter));
}

function initProgress() {
  const meter = $("#scrollMeter");
  const updateProgress = () => {
    const total = document.documentElement.scrollHeight - window.innerHeight;
    meter.style.width = `${total > 0 ? (window.scrollY / total) * 100 : 0}%`;
  };
  window.addEventListener("scroll", updateProgress, { passive: true });
  updateProgress();
}

function initMotionControl() {
  const control = $("#muteMotion");
  let paused = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const render = () => {
    document.body.classList.toggle("motion-paused", paused);
    control.setAttribute("aria-label", paused ? "恢复背景动态" : "暂停背景动态");
    control.dataset.tooltip = paused ? "恢复背景动态" : "暂停背景动态";
    control.innerHTML = paused ? '<i data-lucide="play"></i>' : '<i data-lucide="pause"></i>';
    initIcons();
  };

  control.addEventListener("click", () => {
    paused = !paused;
    render();
    showToast(paused ? "背景动态已暂停，口播节奏不受影响。" : "背景动态已恢复。");
  });
  render();
}

function initLabInteraction() {
  const profile = {
    问题: { value: 63, status: "关联度 63%" },
    模型: { value: 74, status: "关联度 74%" },
    理解: { value: 87, status: "关联度 87%" },
    语境: { value: 79, status: "关联度 79%" },
  };
  const selected = $("#selectedToken");
  const status = $("#simStatus");
  const bar = $("#simBar");
  const core = $(".attention-core b");

  $$(".token").forEach((token) => token.addEventListener("click", () => {
    const name = token.dataset.token;
    const data = profile[name];
    $$(".token").forEach((item) => item.classList.toggle("active", item === token));
    selected.textContent = name;
    status.textContent = data.status;
    bar.style.width = `${data.value}%`;
    core.textContent = `0.${data.value}`;
  }));
}

function initMentorInteraction() {
  const replies = [
    "好，我们从你上次的检索结果开始。先观察：被召回但最终没有帮助回答的片段，它们有什么共同点？",
    "我把你的路线更新成了：检索质量判断 → 重排实验 → 受控生成。先完成一个 10 分钟的小实验就够了。",
    "本章启示：模型不是因为“知道得多”就可靠，而是因为它能在正确的证据、边界与反馈里行动。",
  ];
  const reply = $("#jjReply");
  $$("[data-reply]").forEach((button) => button.addEventListener("click", () => {
    reply.textContent = replies[Number(button.dataset.reply)];
    $$("[data-reply]").forEach((item) => item.classList.toggle("active", item === button));
  }));
}

function initKnowledgeGalaxy() {
  const mount = $("#knowledgeGalaxy");
  const name = $("#planetName");
  const meta = $("#planetMeta");
  const description = $("#planetDescription");
  const focusButton = $("#focusPlanet");
  const askButton = $("#askPlanet");

  const planets = [
    { label: "Transformer", meta: "模型基础星系 / 核心知识点", description: "从注意力机制出发，理解模型如何让每一个词看见与自己相关的上下文。", color: 0x43e3ff, x: -1.55, y: 0.3, z: 0.2, size: 0.14 },
    { label: "Prompt", meta: "模型基础星系 / 路径节点", description: "把模糊意图组织成模型可以执行的上下文，是高质量对话的第一颗星球。", color: 0x88f5c5, x: -0.8, y: 0.93, z: 0.15, size: 0.11 },
    { label: "RAG", meta: "可信 AI 星系 / 核心知识点", description: "让每个结论都能回到检索证据，建立可追溯、可评估的回答链路。", color: 0xf4cf75, x: 0.95, y: 0.4, z: -0.12, size: 0.17 },
    { label: "Embedding", meta: "可信 AI 星系 / 知识节点", description: "把文本放进可比较的语义坐标系，为检索和关联提供基础。", color: 0xa99aff, x: 1.55, y: -0.48, z: 0.05, size: 0.11 },
    { label: "Agent", meta: "智能体工程星系 / 核心知识点", description: "从一次回答，走向感知、规划、行动、反思持续循环的任务系统。", color: 0xff8c78, x: -0.18, y: -0.95, z: 0.18, size: 0.16 },
    { label: "Tools", meta: "智能体工程星系 / 能力节点", description: "工具调用让模型不只会说，还能在明确边界里完成可验证的行动。", color: 0x88f5c5, x: 0.85, y: -0.92, z: -0.04, size: 0.1 },
    { label: "Fine-tune", meta: "模型进阶星系 / 进阶节点", description: "以任务目标和质量标准为前提，理解何时值得为模型增加专属能力。", color: 0x43e3ff, x: -1.84, y: -0.75, z: -0.16, size: 0.1 },
  ];

  if (!window.THREE) {
    mount.textContent = "知识星图正在加载。";
    return;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const targetRotation = { x: 0.22, y: -0.14 };
  const currentRotation = { x: 0.22, y: -0.14 };
  let focusIndex = 0;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let dragDistance = 0;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.setSize(mount.clientWidth, mount.clientHeight);
  renderer.setClearColor(0x000000, 0);
  mount.append(renderer.domElement);
  camera.position.set(0, 0, 5.5);

  const galaxyGroup = new THREE.Group();
  scene.add(galaxyGroup);
  const stars = new THREE.BufferGeometry();
  const starPoints = [];
  for (let index = 0; index < 340; index += 1) {
    const radius = 2.8 * Math.cbrt(Math.random());
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    starPoints.push(radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta));
  }
  stars.setAttribute("position", new THREE.Float32BufferAttribute(starPoints, 3));
  const starCloud = new THREE.Points(stars, new THREE.PointsMaterial({ color: 0x7dceeb, size: 0.019, transparent: true, opacity: 0.62 }));
  galaxyGroup.add(starCloud);

  const planetGroup = new THREE.Group();
  galaxyGroup.add(planetGroup);
  const meshToPlanet = new Map();
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = 128;
  textureCanvas.height = 128;
  const textureContext = textureCanvas.getContext("2d");
  const gradient = textureContext.createRadialGradient(64, 64, 3, 64, 64, 63);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(.25, "rgba(255,255,255,.9)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  textureContext.fillStyle = gradient;
  textureContext.fillRect(0, 0, 128, 128);
  const glowTexture = new THREE.CanvasTexture(textureCanvas);

  planets.forEach((planet, index) => {
    const material = new THREE.MeshBasicMaterial({ color: planet.color });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(planet.size, 18, 18), material);
    mesh.position.set(planet.x, planet.y, planet.z);
    mesh.userData = { index };
    planetGroup.add(mesh);
    meshToPlanet.set(mesh, planet);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: planet.color, transparent: true, opacity: .5, depthWrite: false }));
    glow.scale.set(planet.size * 5, planet.size * 5, 1);
    mesh.add(glow);
  });

  const routePairs = [[0,1],[0,2],[2,3],[0,4],[4,5],[1,6]];
  routePairs.forEach(([from, to]) => {
    const source = planets[from];
    const destination = planets[to];
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(source.x, source.y, source.z),
      new THREE.Vector3(destination.x, destination.y, destination.z),
    ]);
    planetGroup.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x5ec4dd, transparent: true, opacity: .27 })));
  });

  function updateDetail(index) {
    const planet = planets[index];
    focusIndex = index;
    name.textContent = planet.label;
    meta.textContent = planet.meta;
    description.textContent = planet.description;
    planets.forEach((item, itemIndex) => {
      const targetMesh = [...meshToPlanet.entries()].find(([, value]) => value === item)?.[0];
      if (targetMesh) targetMesh.scale.setScalar(itemIndex === index ? 1.52 : 1);
    });
  }

  function selectFromPointer(event) {
    const bounds = mount.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const intersections = raycaster.intersectObjects([...meshToPlanet.keys()]);
    if (intersections.length) updateDetail(intersections[0].object.userData.index);
  }

  mount.addEventListener("pointerdown", (event) => {
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    dragDistance = 0;
    mount.setPointerCapture(event.pointerId);
  });
  mount.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    targetRotation.y += deltaX * .006;
    targetRotation.x += deltaY * .004;
    dragDistance += Math.hypot(deltaX, deltaY);
    startX = event.clientX;
    startY = event.clientY;
  });
  mount.addEventListener("pointerup", (event) => {
    dragging = false;
    try { mount.releasePointerCapture(event.pointerId); } catch { /* No capture to release. */ }
    if (dragDistance < 6) selectFromPointer(event);
  });
  mount.addEventListener("pointerleave", () => { dragging = false; });

  focusButton.addEventListener("click", () => {
    const focused = planets[focusIndex];
    targetRotation.y = -focused.x * .22;
    targetRotation.x = focused.y * .16;
    showToast(`已聚焦「${focused.label}」知识星球。`);
  });
  askButton.addEventListener("click", () => showToast(`JJ 老师已准备好围绕「${planets[focusIndex].label}」继续解惑。`));

  function resize() {
    const width = mount.clientWidth;
    const height = mount.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(mount);

  function render(time) {
    currentRotation.x += (targetRotation.x - currentRotation.x) * .045;
    currentRotation.y += (targetRotation.y - currentRotation.y) * .045;
    galaxyGroup.rotation.x = currentRotation.x;
    galaxyGroup.rotation.y = currentRotation.y + (document.body.classList.contains("motion-paused") ? 0 : time * .000045);
    starCloud.rotation.y = -time * .00002;
    renderer.render(scene, camera);
    window.requestAnimationFrame(render);
  }
  updateDetail(0);
  render(0);
}

function initStarfield() {
  const canvas = $("#starfield");
  const context = canvas.getContext("2d");
  let width = 0;
  let height = 0;
  let stars = [];
  let pointer = { x: -1000, y: -1000 };

  function makeStar() {
    return { x: Math.random() * width, y: Math.random() * height, depth: Math.random() * .92 + .08, drift: (Math.random() - .5) * .08, hue: Math.random() > .84 ? 164 : Math.random() > .58 ? 195 : 230 };
  }
  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    stars = Array.from({ length: Math.min(190, Math.floor(width * height / 9500)) }, makeStar);
  }
  function draw() {
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#05080a";
    context.fillRect(0, 0, width, height);
    const paused = document.body.classList.contains("motion-paused");
    stars.forEach((star) => {
      if (!paused) {
        star.y += star.depth * .08;
        star.x += star.drift;
      }
      if (star.y > height + 4 || star.x < -4 || star.x > width + 4) Object.assign(star, makeStar(), { y: -2 });
      const distance = Math.hypot(star.x - pointer.x, star.y - pointer.y);
      const alpha = .16 + star.depth * .52;
      context.beginPath();
      context.fillStyle = `hsla(${star.hue}, 88%, 85%, ${alpha})`;
      context.arc(star.x, star.y, Math.max(.35, star.depth * 1.5), 0, Math.PI * 2);
      context.fill();
      if (distance < 125) {
        context.beginPath();
        context.strokeStyle = `rgba(83, 218, 255, ${(1 - distance / 125) * .13})`;
        context.moveTo(star.x, star.y);
        context.lineTo(pointer.x, pointer.y);
        context.stroke();
      }
    });
    window.requestAnimationFrame(draw);
  }
  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("pointermove", (event) => { pointer = { x: event.clientX, y: event.clientY }; }, { passive: true });
  resize();
  draw();
}

initIcons();
initRevealsAndRail();
initProgress();
initMotionControl();
initLabInteraction();
initMentorInteraction();
initKnowledgeGalaxy();
initStarfield();
