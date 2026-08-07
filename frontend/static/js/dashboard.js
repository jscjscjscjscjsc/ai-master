(() => {
  "use strict";
  const nav = document.querySelector(".top-nav");
  const orbital = document.querySelector(".mission-orbital");
  const route = document.querySelector(".route-track");
  const userCommand = document.querySelector("#userCommand");
  const userMenu = document.querySelector("#userMenu");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function updateScrollState() {
    nav?.classList.toggle("scrolled", window.scrollY > 18);
    if (route) {
      const rect = route.getBoundingClientRect();
      const viewportPoint = window.innerHeight * .62;
      const progress = Math.max(0, Math.min(1, (viewportPoint - rect.top) / Math.max(1, rect.height)));
      route.style.setProperty("--route-progress", `${progress * 100}%`);
    }
  }

  document.querySelectorAll(".mission-sector[data-target]").forEach((sector) => {
    const navigate = () => { window.location.href = sector.dataset.target; };
    sector.addEventListener("click", (event) => {
      if (event.target.closest("a")) return;
      navigate();
    });
    sector.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); navigate(); }
    });
  });

  userCommand?.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = userMenu.classList.toggle("show");
    userCommand.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (event) => {
    if (!userMenu?.contains(event.target)) { userMenu?.classList.remove("show"); userCommand?.setAttribute("aria-expanded", "false"); }
  });

  if (orbital && !reducedMotion) {
    orbital.addEventListener("pointermove", (event) => {
      const rect = orbital.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - .5;
      const y = (event.clientY - rect.top) / rect.height - .5;
      orbital.style.transform = `rotateX(${-y * 7}deg) rotateY(${x * 9}deg)`;
    });
    orbital.addEventListener("pointerleave", () => { orbital.style.transform = ""; });
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.classList.add("visible"); observer.unobserve(entry.target); }
    });
  }, { threshold: .08 });
  document.querySelectorAll(".dashboard-reveal").forEach((element) => observer.observe(element));
  const sectorObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => entry.target.classList.toggle("visible", entry.isIntersecting));
  }, { rootMargin: "180px 0px", threshold: 0 });
  document.querySelectorAll(".mission-sector").forEach((sector) => sectorObserver.observe(sector));
  window.addEventListener("scroll", updateScrollState, { passive: true });
  window.addEventListener("resize", updateScrollState, { passive: true });
  updateScrollState();
})();
