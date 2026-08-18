(() => {
  "use strict";

  const PALETTES = [
    [0x6ee7f5, 0x2f75c9], [0xba9aff, 0x7148bf], [0xffce7b, 0xc96a39],
    [0x75efbd, 0x239b77], [0xff92bf, 0xb44c83], [0x94aeff, 0x4b55bc],
    [0xf2b0ff, 0x9954b8], [0x84d9ff, 0x357fb8], [0xffaa72, 0xb45158],
    [0x96f4d5, 0x368f9b],
  ];
  const STATUS = {
    completed: { color: 0x72f6e4, label: "已抵达" },
    available: { color: 0xa790ff, label: "可探索" },
    locked: { color: 0x49526e, label: "尚未解锁" },
  };
  const QUALITY = { auto: 1.35, high: 1.8, calm: 0.85 };

  const canvas = document.querySelector("#space");
  const loading = document.querySelector("#loading");
  const errorCard = document.querySelector("#errorCard");
  const errorMessage = document.querySelector("#errorMessage");
  const panel = document.querySelector("#knowledgePanel");
  const atlasPanel = document.querySelector("#atlasPanel");
  const galaxyTitle = document.querySelector("#galaxyTitle");
  const backButton = document.querySelector("#backButton");
  const orbitHint = document.querySelector("#orbitHint");
  const planetPreview = document.querySelector("#planetPreview");
  const label = document.createElement("div");
  label.className = "star-label";
  document.body.appendChild(label);

  let renderer, scene, camera, raycaster, clock, glowTexture;
  let universeGroup, galaxyGroup, skyGroup;
  let universeMap = [], planets = [], relationshipLines = [], activeGalaxy = null;
  let selectedPlanet = null, hoveredPlanet = null, mapData = null;
  let pointer = new THREE.Vector2(3, 3);
  let pointerClient = { x: -1000, y: -1000 };
  let targetRotation = { x: -0.16, y: 0.14, zoom: 118 };
  let cameraState = { x: -0.16, y: 0.14, zoom: 118 };
  let drag = null, raf = 0, quality = "auto", ambientAudio = false;
  let paused = false, selectedPulse = 0;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const orbitGeo = new THREE.RingGeometry(0.99, 1, 80);
  const sphereGeo = new THREE.SphereGeometry(1, 36, 28);
  const starGeo = new THREE.SphereGeometry(1, 18, 14);

  const planetVertex = `
    varying vec3 vNormal; varying vec3 vPosition;
    void main(){ vNormal = normalize(normalMatrix * normal); vPosition = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `;
  const planetFragment = `
    uniform vec3 colorA; uniform vec3 colorB; uniform float time; uniform float energy;
    varying vec3 vNormal; varying vec3 vPosition;
    float hash(vec3 p){ return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453); }
    void main(){
      float bands = sin(vPosition.y*6.0 + vPosition.x*4.0 + time*.42)*.5+.5;
      float grain = hash(floor(vPosition*7.0));
      float mixValue = clamp(bands*.66+grain*.3,0.,1.);
      vec3 base = mix(colorA,colorB,mixValue);
      float edge = pow(1.0-abs(dot(normalize(vNormal),vec3(0.,0.,1.))),2.6);
      gl_FragColor = vec4(base + edge*energy*.45, 1.0);
    }
  `;
  const atmosphereVertex = `varying vec3 vNormal; void main(){vNormal=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
  const atmosphereFragment = `uniform vec3 glow; uniform float pulse; varying vec3 vNormal; void main(){float rim=pow(1.0-abs(dot(vNormal,vec3(0.,0.,1.))),2.4);gl_FragColor=vec4(glow, rim*(.15+pulse*.18));}`;

  function showToast(message) {
    const toast = document.querySelector("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2800);
  }

  function createRenderer() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setClearColor(0x030510, 1);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[quality]));
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, .1, 1000);
    raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 1.2;
    clock = new THREE.Clock();
    glowTexture = createGlowTexture();
    skyGroup = new THREE.Group(); universeGroup = new THREE.Group(); galaxyGroup = new THREE.Group();
    scene.add(skyGroup, universeGroup, galaxyGroup);
    buildSky();
  }

  function createGlowTexture() {
    const textureCanvas = document.createElement("canvas");
    textureCanvas.width = textureCanvas.height = 128;
    const context = textureCanvas.getContext("2d");
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(.12, "rgba(210,238,255,.9)");
    gradient.addColorStop(.42, "rgba(125,163,255,.28)");
    gradient.addColorStop(1, "rgba(72,107,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.minFilter = THREE.LinearFilter;
    return texture;
  }

  function buildSky() {
    const count = reducedMotion ? 900 : 1800;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const radius = 230 + Math.random() * 320;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.cos(phi);
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
      const c = new THREE.Color().setHSL(.58 + Math.random() * .16, .6, .52 + Math.random() * .35);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    skyGroup.add(new THREE.Points(geometry, new THREE.PointsMaterial({ size: .66, vertexColors: true, transparent: true, opacity: .74, depthWrite: false })));
  }

  function disposeObject(root) {
    root.traverse((object) => {
      if (object.geometry && object.geometry !== sphereGeo && object.geometry !== starGeo && object.geometry !== orbitGeo) object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.filter(Boolean).forEach((material) => material.dispose());
    });
    root.clear();
  }

  function resetGroups() {
    disposeObject(universeGroup); disposeObject(galaxyGroup);
    universeMap = []; planets = []; relationshipLines = [];
  }

  function makeParticleCloud(count, color, radius, flat = false) {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const arm = i % 3;
      const t = Math.random();
      const r = Math.pow(t, .65) * radius;
      const angle = r * .65 + arm * Math.PI * 2 / 3 + (Math.random() - .5) * .52;
      pos[i * 3] = Math.cos(angle) * r;
      pos[i * 3 + 1] = flat ? (Math.random() - .5) * radius * .09 : (Math.random() - .5) * radius * .5;
      pos[i * 3 + 2] = Math.sin(angle) * r * (flat ? .52 : 1);
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return new THREE.Points(geometry, new THREE.PointsMaterial({ color, size: .3, transparent: true, opacity: .68, blending: THREE.AdditiveBlending, depthWrite: false }));
  }

  function galaxyPosition(index, total) {
    const columns = 5;
    const col = index % columns;
    const row = Math.floor(index / columns);
    return new THREE.Vector3((col - 2) * 35 + (row ? 15 : 0), (row ? -18 : 14) + (index % 2 ? 2 : -2), row ? -8 : 4);
  }

  function buildUniverse() {
    resetGroups();
    mapData.galaxies.forEach((galaxy, index) => {
      const palette = PALETTES[index % PALETTES.length];
      const group = new THREE.Group();
      const position = galaxyPosition(index, mapData.galaxies.length);
      group.position.copy(position);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color: palette[0], transparent: true, opacity: .36, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.scale.set(24, 24, 1); group.add(halo);
      const cloud = makeParticleCloud(reducedMotion ? 190 : 430, palette[0], 9 + galaxy.stars.length * .22, index % 2 === 0);
      group.add(cloud);
      const core = new THREE.Mesh(new THREE.SphereGeometry(1.1, 22, 18), new THREE.MeshBasicMaterial({ color: palette[0], transparent: true, opacity: .88 }));
      group.add(core);
      const hit = new THREE.Mesh(new THREE.SphereGeometry(11, 12, 9), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
      hit.userData = { galaxy, index, hitType: "galaxy", core, cloud, halo };
      group.add(hit);
      universeGroup.add(group);
      universeMap.push(hit);
    });
    targetRotation = { x: -.18, y: .15, zoom: 118 }; cameraState = { ...targetRotation };
  }

  function layoutPosition(index, count, radius) {
    const angle = index * 2.399963229728653 + .25;
    const ring = Math.sqrt((index + .45) / count);
    const r = ring * radius;
    return new THREE.Vector3(Math.cos(angle) * r, Math.sin(angle * 1.7) * r * .56, Math.sin(angle) * r * .36);
  }

  function createPlanet(star, index, count, palette) {
    const group = new THREE.Group();
    const position = layoutPosition(index, count, 21);
    group.position.copy(position);
    const state = STATUS[star.status] || STATUS.locked;
    const primary = new THREE.Color(star.status === "locked" ? 0x3c4560 : palette[0]);
    const secondary = new THREE.Color(star.status === "locked" ? 0x151b31 : palette[1]);
    const size = .82 + (index === 0 ? .34 : 0) + Math.min(1.1, count / 15) * .12;
    const uniforms = { colorA: { value: primary }, colorB: { value: secondary }, time: { value: Math.random() * 7 }, energy: { value: star.status === "completed" ? 1 : .48 } };
    const core = new THREE.Mesh(sphereGeo, new THREE.ShaderMaterial({ uniforms, vertexShader: planetVertex, fragmentShader: planetFragment }));
    core.scale.setScalar(size); group.add(core);
    const atmosphere = new THREE.Mesh(sphereGeo, new THREE.ShaderMaterial({ uniforms: { glow: { value: new THREE.Color(state.color) }, pulse: { value: star.status === "completed" ? 1 : .25 } }, vertexShader: atmosphereVertex, fragmentShader: atmosphereFragment, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide }));
    atmosphere.scale.setScalar(size * 1.15); group.add(atmosphere);
    const orbit = new THREE.Mesh(orbitGeo, new THREE.MeshBasicMaterial({ color: state.color, transparent: true, opacity: star.status === "locked" ? .08 : .32, side: THREE.DoubleSide, depthWrite: false }));
    orbit.scale.set(size * (1.55 + Math.random() * .5), size * (.42 + Math.random() * .15), 1); orbit.rotation.x = Math.PI * .5; orbit.rotation.z = Math.random() * .6; group.add(orbit);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(size * 1.9, 12, 10), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hit.userData = { hitType: "planet", star, core, atmosphere, orbit, uniforms, state, index, position: position.clone(), group };
    group.add(hit); planets.push(hit);
    return group;
  }

  function buildRelationshipLines(galaxy, positions, color) {
    const segments = []; const kinds = [];
    galaxy.connections.forEach(([a, b, kind]) => {
      if (!positions[a] || !positions[b]) return;
      segments.push(positions[a].x, positions[a].y, positions[a].z, positions[b].x, positions[b].y, positions[b].z);
      kinds.push({ a, b, kind });
    });
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(segments, 3));
    const base = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: .15, depthWrite: false }));
    galaxyGroup.add(base);
    relationshipLines.push({ line: base, links: kinds });
  }

  function buildGalaxy(galaxy) {
    resetGroups(); activeGalaxy = galaxy;
    document.body.dataset.view = "galaxy";
    atlasPanel.classList.add("hidden"); backButton.classList.add("show"); galaxyTitle.classList.add("show"); orbitHint.classList.add("galaxy");
    document.querySelector("#galaxyTitle p").textContent = galaxy.name_en;
    document.querySelector("#galaxyTitle h2").textContent = galaxy.name;
    document.querySelector("#galaxyTitle span").textContent = `${galaxy.progress}% EXPLORED`;
    const palette = PALETTES[(galaxy.chapter - 1) % PALETTES.length];
    const color = new THREE.Color(palette[0]);
    const atmosphere = makeParticleCloud(reducedMotion ? 230 : 620, color, 29, false);
    atmosphere.material.opacity = .14; galaxyGroup.add(atmosphere);
    const coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, color, transparent: true, opacity: .44, depthWrite: false, blending: THREE.AdditiveBlending })); coreGlow.scale.set(25, 25, 1); galaxyGroup.add(coreGlow);
    const positions = [];
    galaxy.stars.forEach((star, index) => { const planet = createPlanet(star, index, galaxy.stars.length, palette); positions.push(planet.position); galaxyGroup.add(planet); });
    buildRelationshipLines(galaxy, positions, color);
    const dust = makeParticleCloud(reducedMotion ? 90 : 250, color, 35, true); dust.material.opacity = .22; galaxyGroup.add(dust);
    targetRotation = { x: -.14, y: .15, zoom: 48 }; cameraState = { ...targetRotation };
  }

  function backToUniverse() {
    activeGalaxy = null; selectedPlanet = null; hoveredPlanet = null; panel.classList.remove("show"); label.classList.remove("show");
    document.body.dataset.view = "universe"; atlasPanel.classList.remove("hidden"); backButton.classList.remove("show"); galaxyTitle.classList.remove("show"); orbitHint.classList.remove("galaxy");
    buildUniverse();
  }

  function setPanel(hit) {
    selectedPlanet = hit; selectedPulse = 0;
    const { star, state } = hit.userData;
    panel.classList.add("show");
    document.querySelector("#panelCode").textContent = `CHAPTER ${String(star.chapter).padStart(2, "0")} / STAR ${String(star.index + 1).padStart(2, "0")}`;
    document.querySelector("#panelTitle").textContent = star.title;
    document.querySelector("#panelDesc").textContent = star.desc || "这颗星球正在等待你的探索。";
    planetPreview.style.setProperty("--planet-color", `#${new THREE.Color(state.color).getHexString()}`);
    planetPreview.style.background = `radial-gradient(circle at 35% 30%,#fff,#${new THREE.Color(state.color).getHexString()} 12%,#353478 48%,#10142f 73%)`;
    const relation = relatedPlanets(hit).slice(0, 4);
    document.querySelector("#relationList").innerHTML = relation.length ? relation.map((item) => `<span>${item.userData.star.title}</span>`).join("") : "<span>知识网络建立中</span>";
    const learn = document.querySelector("#learnButton");
    learn.href = star.url;
    learn.classList.toggle("locked", star.status === "locked");
    learn.innerHTML = star.status === "locked" ? "等待前置星球解锁" : "进入知识学习 <span>→</span>";
  }

  function relatedPlanets(hit) {
    const related = new Set();
    relationshipLines.forEach(({ links }) => links.forEach((link) => {
      if (link.a === hit.userData.index) related.add(link.b);
      if (link.b === hit.userData.index) related.add(link.a);
    }));
    return [...related].map((index) => planets.find((planet) => planet.userData.index === index)).filter(Boolean);
  }

  function updateFocus() {
    if (!activeGalaxy) return;
    const neighbors = selectedPlanet ? new Set(relatedPlanets(selectedPlanet)) : null;
    planets.forEach((planet) => {
      const isSelected = planet === selectedPlanet;
      const isNeighbor = neighbors && neighbors.has(planet);
      const isFaded = selectedPlanet && !isSelected && !isNeighbor;
      planet.userData.core.material.uniforms.energy.value = isSelected ? 1.5 : isNeighbor ? .86 : isFaded ? .15 : planet.userData.star.status === "completed" ? 1 : .46;
      planet.userData.atmosphere.material.uniforms.pulse.value = isSelected ? 1.1 : isNeighbor ? .58 : isFaded ? .04 : .24;
      planet.userData.orbit.material.opacity = isSelected ? .78 : isNeighbor ? .44 : isFaded ? .025 : planet.userData.star.status === "locked" ? .08 : .32;
    });
    relationshipLines.forEach(({ line, links }) => {
      const related = selectedPlanet && links.some((link) => link.a === selectedPlanet.userData.index || link.b === selectedPlanet.userData.index);
      line.material.opacity = selectedPlanet ? (related ? .62 : .025) : .15;
    });
  }

  function pick(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    pointerClient = { x: event.clientX, y: event.clientY };
    raycaster.setFromCamera(pointer, camera);
    return activeGalaxy ? raycaster.intersectObjects(planets, false)[0] : raycaster.intersectObjects(universeMap, false)[0];
  }

  function updateHover(event) {
    if (drag) return;
    const result = pick(event); const next = result?.object || null;
    if (hoveredPlanet === next) return;
    hoveredPlanet = next;
    if (activeGalaxy && next?.userData?.hitType === "planet") {
      label.textContent = next.userData.star.title; label.style.left = `${Math.min(event.clientX + 13, innerWidth - 210)}px`; label.style.top = `${Math.max(18, event.clientY)}px`; label.classList.add("show"); canvas.style.cursor = "pointer";
    } else if (!activeGalaxy && next?.userData?.hitType === "galaxy") {
      label.textContent = next.userData.galaxy.name; label.style.left = `${Math.min(event.clientX + 13, innerWidth - 180)}px`; label.style.top = `${Math.max(18, event.clientY)}px`; label.classList.add("show"); canvas.style.cursor = "pointer";
    } else { label.classList.remove("show"); canvas.style.cursor = drag ? "grabbing" : "grab"; }
  }

  function onPointerDown(event) { drag = { x: event.clientX, y: event.clientY, rotationX: targetRotation.x, rotationY: targetRotation.y, moved: false }; canvas.setPointerCapture?.(event.pointerId); canvas.style.cursor = "grabbing"; }
  function onPointerMove(event) {
    if (drag) {
      const dx = event.clientX - drag.x; const dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) > 5) drag.moved = true;
      targetRotation.y = drag.rotationY + dx * .006; targetRotation.x = Math.max(-.85, Math.min(.85, drag.rotationX + dy * .004));
    } else updateHover(event);
  }
  function onPointerUp(event) {
    const wasDrag = drag?.moved; drag = null; canvas.style.cursor = "grab";
    if (wasDrag) return;
    const result = pick(event); if (!result) { if (activeGalaxy) { selectedPlanet = null; panel.classList.remove("show"); updateFocus(); } return; }
    const hit = result.object;
    if (hit.userData.hitType === "galaxy") buildGalaxy(hit.userData.galaxy);
    if (hit.userData.hitType === "planet") { setPanel(hit); updateFocus(); }
  }
  function onWheel(event) { event.preventDefault(); targetRotation.zoom = Math.max(activeGalaxy ? 28 : 74, Math.min(activeGalaxy ? 78 : 168, targetRotation.zoom + event.deltaY * .035)); }

  function resize() {
    if (!renderer) return; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio || 1, QUALITY[quality]));
  }

  function updateCamera() {
    cameraState.x += (targetRotation.x - cameraState.x) * .065;
    cameraState.y += (targetRotation.y - cameraState.y) * .065;
    cameraState.zoom += (targetRotation.zoom - cameraState.zoom) * .075;
    const z = cameraState.zoom; const x = z * Math.sin(cameraState.y) * Math.cos(cameraState.x); const y = z * Math.sin(cameraState.x); const zz = z * Math.cos(cameraState.y) * Math.cos(cameraState.x);
    camera.position.set(x, y, zz); camera.lookAt(0, 0, 0);
  }

  function animate() {
    raf = requestAnimationFrame(animate);
    if (!renderer || document.hidden || paused) return;
    const time = clock.getElapsedTime();
    updateCamera();
    skyGroup.rotation.y += reducedMotion ? .00001 : .00009;
    if (!activeGalaxy) {
      universeMap.forEach((hit, index) => { const { core, cloud, halo } = hit.userData; cloud.rotation.y += .0012; core.scale.setScalar(.9 + Math.sin(time * .8 + index) * .12); halo.material.opacity = .11 + Math.sin(time * .65 + index) * .035; });
      universeGroup.rotation.y += reducedMotion ? 0 : .00014;
    } else {
      galaxyGroup.rotation.y += reducedMotion ? 0 : .00035;
      planets.forEach((planet, index) => {
        const { core, atmosphere, orbit, uniforms } = planet.userData;
        uniforms.time.value = time + index * .2; core.rotation.y += .003; atmosphere.rotation.y -= .0014; orbit.rotation.z += .002;
        if (planet === selectedPlanet) { const scale = 1 + Math.sin(time * 2.4) * .075; planet.scale.setScalar(scale); } else planet.scale.lerp(new THREE.Vector3(1, 1, 1), .12);
      });
      if (selectedPlanet) { selectedPulse += .05; selectedPlanet.userData.orbit.rotation.z += .009; }
    }
    renderer.render(scene, camera);
  }

  async function loadUniverse() {
    loading.classList.remove("hide"); errorCard.classList.remove("show");
    try {
      const response = await fetch("../data/knowledge-universe.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`服务器返回 ${response.status}`);
      const payload = await response.json(); if (!payload.success || !Array.isArray(payload.galaxies)) throw new Error("星图数据格式无效");
      mapData = payload; document.querySelector("#galaxyCount").textContent = payload.summary.galaxies; document.querySelector("#starCount").textContent = payload.summary.stars; document.querySelector("#completedCount").textContent = payload.summary.completed;
      buildUniverse(); loading.classList.add("hide");
    } catch (error) {
      console.error("Knowledge universe failed to load", error); errorMessage.textContent = error.message || "本地星图服务未响应。"; errorCard.classList.add("show"); loading.classList.add("hide");
    }
  }

  function initControls() {
    canvas.addEventListener("pointerdown", onPointerDown); canvas.addEventListener("pointermove", onPointerMove); canvas.addEventListener("pointerup", onPointerUp); canvas.addEventListener("pointercancel", () => { drag = null; }); canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", resize, { passive: true }); document.addEventListener("visibilitychange", () => { paused = document.hidden; });
    backButton.addEventListener("click", backToUniverse); document.querySelector("#homeButton").addEventListener("click", backToUniverse); document.querySelector("#dashboardButton").addEventListener("click", () => location.assign("../../dashboard")); document.querySelector("#panelClose").addEventListener("click", () => { selectedPlanet = null; panel.classList.remove("show"); updateFocus(); }); document.querySelector("#retryButton").addEventListener("click", () => { errorCard.classList.remove("show"); paused = false; loadUniverse(); });
    document.querySelector("#qualityButton").addEventListener("click", (event) => { quality = quality === "auto" ? "high" : quality === "high" ? "calm" : "auto"; event.currentTarget.textContent = `画质 / ${quality.toUpperCase()}`; resize(); showToast(quality === "calm" ? "已切换至轻量星图" : "星图画质已更新"); });
    document.querySelector("#musicButton").addEventListener("click", async (event) => { const audio = document.querySelector("#bgm"); try { if (ambientAudio) { audio.pause(); ambientAudio = false; } else { await audio.play(); ambientAudio = true; } event.currentTarget.textContent = `声音 / ${ambientAudio ? "ON" : "OFF"}`; } catch { showToast("浏览器需要一次点击后才能播放声音"); } });
    document.querySelector("#listenButton").addEventListener("click", () => { if (!selectedPlanet) return; if (!("speechSynthesis" in window)) { showToast("当前浏览器不支持语音朗读"); return; } speechSynthesis.cancel(); const text = `${selectedPlanet.userData.star.title}。${selectedPlanet.userData.star.desc}`; const utterance = new SpeechSynthesisUtterance(text); utterance.lang = "zh-CN"; utterance.rate = .92; speechSynthesis.speak(utterance); });
    window.addEventListener("keydown", (event) => { if (event.key === "Escape") { if (panel.classList.contains("show")) { selectedPlanet = null; panel.classList.remove("show"); updateFocus(); } else if (activeGalaxy) backToUniverse(); } });
    canvas.addEventListener("webglcontextlost", (event) => { event.preventDefault(); paused = true; errorMessage.textContent = "星图图形上下文被系统暂停。点击重新连接即可恢复。"; errorCard.classList.add("show"); });
    canvas.addEventListener("webglcontextrestored", () => { paused = false; errorCard.classList.remove("show"); createRenderer(); loadUniverse(); });
  }

  if (!window.THREE) { errorMessage.textContent = "本地 Three.js 资源缺失，无法绘制星图。"; errorCard.classList.add("show"); loading.classList.add("hide"); return; }
  try { createRenderer(); initControls(); loadUniverse(); animate(); } catch (error) { console.error(error); errorMessage.textContent = "浏览器未能初始化 WebGL 星图。"; errorCard.classList.add("show"); loading.classList.add("hide"); }
})();
