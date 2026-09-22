(() => {
  "use strict";

  const canvas = document.querySelector("#odyssey-canvas");
  const hero = document.querySelector(".odyssey-hero");
  const heroObject = document.querySelector(".hero-object");
  const chapters = document.querySelectorAll(".odyssey-chapter");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  chapters.forEach((chapter, index) => {
    const button = chapter.querySelector("button");
    chapter.style.transitionDelay = `${index * 60}ms`;
    button.addEventListener("click", () => { window.location.href = chapter.dataset.target; });
    chapter.addEventListener("pointermove", event => {
      if (reducedMotion) return;
      const bounds = chapter.getBoundingClientRect();
      const visual = chapter.querySelector(".chapter-card");
      const field = chapter.querySelector(".chapter-field");
      const horizontal = (event.clientX - bounds.left) / bounds.width - .5;
      const vertical = (event.clientY - bounds.top) / bounds.height - .5;
      visual.style.transform = `rotate(${horizontal * 5}deg) translateY(-6px)`;
      field.style.transform = `translate(${horizontal * 18}px, ${vertical * 12}px)`;
    });
  });

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => entry.target.classList.toggle("active", entry.isIntersecting));
    }, { threshold: .35 });
    chapters.forEach(chapter => observer.observe(chapter));
  } else {
    chapters.forEach(chapter => chapter.classList.add("active"));
  }

  if (!canvas || !hero || !window.THREE) {
    if (canvas) canvas.style.display = "none";
    return;
  }

  try {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(57, innerWidth / innerHeight, .1, 180);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setSize(innerWidth, innerHeight);
    renderer.setClearColor(0x02030b, 1);
    renderer.outputEncoding = THREE.sRGBEncoding;

    const universe = new THREE.Group();
    const sky = new THREE.Group();
    const route = new THREE.Group();
    scene.add(universe);
    universe.add(sky, route);

    function createStars(count, radius, size, opacity) {
      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      const palette = [[.32, .95, .89], [.64, .5, 1], [1, .55, .77], [1, .78, .38], [.75, .84, 1]];
      for (let index = 0; index < count; index += 1) {
        const depth = Math.pow(Math.random(), .55) * radius + 4;
        const angle = Math.random() * Math.PI * 2;
        positions[index * 3] = Math.cos(angle) * depth * (0.45 + Math.random());
        positions[index * 3 + 1] = (Math.random() - .5) * depth * .78;
        positions[index * 3 + 2] = -Math.random() * radius + 10;
        const color = palette[index % palette.length];
        colors[index * 3] = color[0];
        colors[index * 3 + 1] = color[1];
        colors[index * 3 + 2] = color[2];
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      return new THREE.Points(geometry, new THREE.PointsMaterial({
        size, vertexColors: true, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending
      }));
    }

    sky.add(createStars(innerWidth < 760 ? 1000 : 2300, 90, .085, .78));
    const farStars = createStars(innerWidth < 760 ? 500 : 1100, 150, .045, .38);
    farStars.position.z = -45;
    sky.add(farStars);

    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x6575d4, transparent: true, opacity: .18, blending: THREE.AdditiveBlending });
    for (let index = 0; index < 28; index += 1) {
      const lateral = (Math.random() - .5) * 46;
      const rise = (Math.random() - .5) * 25;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(lateral * .18, rise * .15, 8),
        new THREE.Vector3(lateral * .45, rise * .65, -13),
        new THREE.Vector3(lateral, rise, -54)
      ]);
      route.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(26)), lineMaterial));
    }

    const tunnelMaterial = new THREE.LineBasicMaterial({ color: 0x72f6e4, transparent: true, opacity: .14, blending: THREE.AdditiveBlending });
    for (let index = 0; index < 11; index += 1) {
      const ellipse = new THREE.EllipseCurve(0, 0, 4 + index * 1.7, 1.5 + index * .72, 0, Math.PI * 2, false, 0);
      const points = ellipse.getPoints(72).map(point => new THREE.Vector3(point.x, point.y, -5 - index * 8));
      route.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), tunnelMaterial));
    }

    const planetGroup = new THREE.Group();
    planetGroup.position.set(4.6, .15, -5.5);
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(2.32, 48, 48),
      new THREE.MeshStandardMaterial({ color: 0x3f3d92, roughness: .72, metalness: .28, emissive: 0x18124b, emissiveIntensity: .75 })
    );
    planetGroup.add(planet);
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(2.52, 42, 42),
      new THREE.MeshBasicMaterial({ color: 0x8e77ff, transparent: true, opacity: .13, blending: THREE.AdditiveBlending, side: THREE.BackSide })
    );
    planetGroup.add(atmosphere);
    const planetLight = new THREE.PointLight(0x79f6ef, 16, 23, 2);
    planetLight.position.set(-3.4, 2.8, 4.2);
    planetGroup.add(planetLight);
    const rimLight = new THREE.PointLight(0xb69aff, 8, 18, 2);
    rimLight.position.set(3, -2, 2);
    planetGroup.add(rimLight);
    const ambient = new THREE.AmbientLight(0x6e78d3, 1.1);
    planetGroup.add(ambient);

    const orbitMaterial = new THREE.LineBasicMaterial({ color: 0xb9abff, transparent: true, opacity: .34, blending: THREE.AdditiveBlending });
    [3.25, 3.78, 4.42].forEach((radius, index) => {
      const points = new THREE.EllipseCurve(0, 0, radius, radius * (.27 + index * .06), 0, Math.PI * 2).getPoints(96);
      const orbit = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points.map(point => new THREE.Vector3(point.x, point.y, 0))), orbitMaterial);
      orbit.rotation.x = 1.03 + index * .18;
      orbit.rotation.z = -.45 + index * .63;
      planetGroup.add(orbit);
    });
    route.add(planetGroup);

    const start = { x: 0, y: 0 };
    const rotation = { x: -.06, y: -.1, targetX: -.06, targetY: -.1, velocityX: 0, velocityY: 0 };
    let dragging = false;

    function isHeroGesture(target) {
      return target instanceof Element && !target.closest("a, button") && hero.contains(target);
    }
    hero.addEventListener("pointerdown", event => {
      if (!isHeroGesture(event.target) || reducedMotion) return;
      dragging = true;
      start.x = event.clientX;
      start.y = event.clientY;
      rotation.velocityX = 0;
      rotation.velocityY = 0;
      hero.classList.add("is-dragging");
      hero.setPointerCapture(event.pointerId);
    });
    hero.addEventListener("pointermove", event => {
      if (!dragging) return;
      const dx = (event.clientX - start.x) / innerWidth;
      const dy = (event.clientY - start.y) / innerHeight;
      rotation.velocityY = dx * .12;
      rotation.velocityX = dy * .09;
      rotation.targetY += rotation.velocityY;
      rotation.targetX = THREE.MathUtils.clamp(rotation.targetX + rotation.velocityX, -.45, .3);
      start.x = event.clientX;
      start.y = event.clientY;
    });
    function endDrag(event) {
      if (!dragging) return;
      dragging = false;
      hero.classList.remove("is-dragging");
      if (hero.hasPointerCapture(event.pointerId)) hero.releasePointerCapture(event.pointerId);
    }
    hero.addEventListener("pointerup", endDrag);
    hero.addEventListener("pointercancel", endDrag);

    addEventListener("pointermove", event => {
      if (dragging || reducedMotion) return;
      const x = event.clientX / innerWidth - .5;
      const y = event.clientY / innerHeight - .5;
      rotation.targetY += (x * .11 - rotation.targetY) * .05;
      rotation.targetX += (y * .06 - rotation.targetX) * .05;
    }, { passive: true });

    addEventListener("resize", () => {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    }, { passive: true });

    function render(time) {
      const scrollProgress = Math.min(scrollY / Math.max(innerHeight, 1), 1.5);
      rotation.velocityY *= .94;
      rotation.velocityX *= .94;
      if (!dragging) {
        rotation.targetY += rotation.velocityY;
        rotation.targetX = THREE.MathUtils.clamp(rotation.targetX + rotation.velocityX, -.45, .3);
      }
      rotation.x += (rotation.targetX - rotation.x) * .055;
      rotation.y += (rotation.targetY - rotation.y) * .055;
      universe.rotation.x = rotation.x;
      universe.rotation.y = rotation.y + time * .000012;
      sky.rotation.z = time * .000006;
      route.rotation.z = time * .000018;
      planet.rotation.y = time * .00009;
      planetGroup.rotation.y = time * .000043;
      camera.position.z = 10.8 - scrollProgress * 2.8;
      camera.position.x += ((rotation.y * .95) - camera.position.x) * .035;
      camera.position.y += ((-rotation.x * .65) - camera.position.y) * .035;
      if (heroObject) {
        heroObject.style.transform = `translate3d(${rotation.y * 95}px, ${-rotation.x * 70}px, 0) rotate(${rotation.y * 4}deg)`;
      }
      renderer.render(scene, camera);
      if (!reducedMotion) requestAnimationFrame(render);
    }
    render(0);
  } catch (error) {
    console.warn("AI Odyssey is running without the WebGL star field.", error);
    canvas.style.display = "none";
  }
})();
