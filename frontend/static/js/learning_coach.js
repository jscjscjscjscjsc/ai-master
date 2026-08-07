(() => {
  "use strict";
  const $ = selector => document.querySelector(selector);
  const state = { coach: null, selectedId: null, drawing: null };
  const routeView = $("#routeView");
  const onboarding = $("#onboardingPanel");
  const intro = $("#coachIntro");
  const loading = $("#loadingOverlay");
  const loadingText = $("#loadingText");

  function toast(message) {
    const node = $("#toast");
    node.textContent = message;
    node.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove("show"), 3600);
  }
  function setLoading(on, message = "正在校准星图") { loading.style.display = on ? "grid" : "none"; loadingText.textContent = message; }
  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.message || "星图服务暂时不可用");
    return data;
  }
  function currentMilestone() {
    const list = state.coach?.milestones || [];
    return list.find(item => item.id === state.selectedId) || list.find(item => item.status === "current") || list[0];
  }
  function displayRoute(coach) {
    state.coach = coach;
    state.selectedId = currentMilestone()?.id || null;
    intro.style.display = "none"; onboarding.style.display = "none"; routeView.style.display = "grid";
    $("#missionTitle").textContent = coach.mission_title;
    $("#coachIntroText").textContent = coach.coach_intro;
    $("#profileSummary").textContent = coach.profile_summary;
    const completed = coach.milestones.filter(item => item.status === "completed").length;
    $("#routeProgress").textContent = `${completed} / ${coach.milestones.length} 已抵达`;
    renderConstellation(); renderMission();
  }
  function renderConstellation() {
    const root = $("#constellation"); root.textContent = "";
    const colors = ["#72f6e4", "#a99bff", "#ff9dcc", "#ffc978", "#78b8ff", "#86e6ae"];
    state.coach.milestones.forEach((item, index) => {
      const node = document.createElement("button");
      node.type = "button"; node.className = `milestone ${item.status}${item.id === state.selectedId ? " selected" : ""}`;
      node.style.setProperty("--node-color", colors[index % colors.length]);
      node.disabled = item.status === "locked";
      node.innerHTML = `<span class="node">${String(index + 1).padStart(2, "0")}</span><span class="milestone-copy"><p>${item.status === "completed" ? "MISSION COMPLETE" : item.status === "current" ? "CURRENT MISSION" : "LOCKED ROUTE"}</p><h3>${item.title}</h3><span>${item.knowledge_point || item.objective}</span></span>`;
      node.addEventListener("click", () => { state.selectedId = item.id; renderConstellation(); renderMission(); });
      root.appendChild(node);
    });
  }
  function renderMission() {
    const mission = currentMilestone(); if (!mission) return;
    const isCurrent = mission.status === "current";
    $("#missionCode").textContent = mission.status === "completed" ? "MISSION COMPLETE" : isCurrent ? "CURRENT MILESTONE" : "ROUTE LOCKED";
    $("#missionTime").textContent = `${mission.estimated_minutes} MIN`;
    $("#missionName").textContent = mission.title;
    $("#missionObjective").textContent = mission.objective;
    const link = $("#learnLink"); link.href = mission.target_url || "#"; link.classList.toggle("disabled", !mission.target_url || !isCurrent);
    link.querySelector("span").textContent = mission.target_url ? "进入对应知识星球" : "此任务无需跳转章节";
    $("#feynmanPrompt").textContent = mission.feynman_prompt;
    $("#completionCriteria").textContent = `通行标准：${mission.completion_criteria}`;
    $("#explanationInput").value = ""; $("#explanationInput").disabled = !isCurrent;
    $("#checkExplanation").disabled = !isCurrent;
    $("#checkExplanation span").textContent = isCurrent ? "交给教练检验讲解" : mission.status === "completed" ? "该里程碑已完成" : "完成前序任务后解锁";
    const attempts = mission.attempts || [];
    if (attempts.length) renderFeedback(attempts[attempts.length - 1], mission); else $("#coachFeedback").hidden = true;
  }
  function renderFeedback(feedback, mission) {
    const root = $("#coachFeedback"); root.hidden = false;
    const gaps = (feedback.gaps || []).map(gap => `<span>${escapeHtml(gap)}</span>`).join("");
    root.innerHTML = `<div class="feedback-head"><p>COACH DIAGNOSIS</p><span class="score-pill">理解度 ${feedback.score} / 10</span></div><p>${escapeHtml(feedback.feedback)}</p>${gaps ? `<div class="gaps">${gaps}</div>` : ""}${feedback.micro_lesson ? `<div class="micro-lesson">${escapeHtml(feedback.micro_lesson)}</div>` : ""}<p><strong>下一次思考：</strong>${escapeHtml(feedback.socratic_question || "请再用一个真实案例说明。")}</p>${feedback.ready_to_advance && mission.status === "current" ? `<button class="advance-button" type="button">点亮下一颗星球 →</button>` : ""}`;
    const advance = root.querySelector(".advance-button");
    if (advance) advance.addEventListener("click", () => advanceMission(mission.id));
  }
  function escapeHtml(value) { const node = document.createElement("span"); node.textContent = value || ""; return node.innerHTML; }
  async function createPlan(event) {
    event.preventDefault();
    const form = $("#intakeForm"); if (!form.reportValidity()) return;
    const deadline = $("#deadline").value;
    setLoading(true, "正在为你推演专属学习路线");
    try {
      const result = await request("/api/learning-coach/plan", { method: "POST", body: JSON.stringify({
        goal: $("#goal").value, current_level: $("#currentLevel").value, daily_minutes: Number($("#dailyMinutes").value),
        deadline, learning_preference: $("#preference").value, challenge: $("#challenge").value
      }) });
      displayRoute(result.coach);
    } catch (error) { toast(error.message); } finally { setLoading(false); }
  }
  async function checkExplanation() {
    const explanation = $("#explanationInput").value.trim(); const mission = currentMilestone();
    if (explanation.length < 12) { toast("请先完成一段真正属于你自己的讲解。至少写两三句话。 "); return; }
    setLoading(true, "教练正在诊断你的理解链条");
    try {
      const result = await request("/api/learning-coach/feynman", { method: "POST", body: JSON.stringify({ milestone_id: mission.id, explanation }) });
      state.coach = result.coach; renderConstellation(); renderMission();
    } catch (error) { toast(error.message); } finally { setLoading(false); }
  }
  async function advanceMission(id) {
    setLoading(true, "正在点亮下一颗知识星球");
    try {
      const result = await request("/api/learning-coach/advance", { method: "POST", body: JSON.stringify({ milestone_id: id }) });
      state.coach = result.coach; state.selectedId = state.coach.milestones.find(item => item.status === "current")?.id || state.coach.milestones.at(-1)?.id; renderConstellation(); renderMission();
      toast(result.completed_all ? "整条个人路线已完成，下一段远征等待你定义。" : "航线已推进，下一颗星球正在苏醒。");
    } catch (error) { toast(error.message); } finally { setLoading(false); }
  }
  function showOnboarding() { routeView.style.display = "none"; onboarding.style.display = "block"; intro.style.display = "block"; window.scrollTo({ top: 0, behavior: "smooth" }); }
  async function init() {
    setLoading(true, "正在读取你的学习星图");
    try { const result = await request("/api/learning-coach/state"); if (result.coach?.milestones?.length) displayRoute(result.coach); }
    catch (error) { toast(error.message); } finally { setLoading(false); }
  }
  routeView.style.display = "none"; loading.style.display = "none";
  $("#intakeForm").addEventListener("submit", createPlan); $("#checkExplanation").addEventListener("click", checkExplanation); $("#replanButton").addEventListener("click", showOnboarding);

  const canvas = $("#coach-space"), ctx = canvas.getContext("2d"); let stars = [];
  function resize() { canvas.width = innerWidth * Math.min(devicePixelRatio, 1.5); canvas.height = innerHeight * Math.min(devicePixelRatio, 1.5); canvas.style.width = `${innerWidth}px`; canvas.style.height = `${innerHeight}px`; ctx.setTransform(Math.min(devicePixelRatio, 1.5), 0, 0, Math.min(devicePixelRatio, 1.5), 0, 0); stars = Array.from({ length: innerWidth < 700 ? 180 : 420 }, () => ({ x: Math.random() * innerWidth, y: Math.random() * innerHeight, z: .18 + Math.random(), phase: Math.random() * 6.28 })); }
  function draw(time) { ctx.clearRect(0, 0, innerWidth, innerHeight); stars.forEach(star => { const glow = .18 + (Math.sin(time * .001 + star.phase) + 1) * .17; ctx.beginPath(); ctx.arc(star.x, star.y, star.z * 1.25, 0, Math.PI * 2); ctx.fillStyle = `rgba(200,225,255,${glow})`; ctx.fill(); }); requestAnimationFrame(draw); }
  addEventListener("resize", resize, { passive: true }); resize(); requestAnimationFrame(draw); init();
})();
