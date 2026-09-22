const routes = [
  { title: "划定数据边界", subtitle: "先定义什么不能离开你的星系", description: "梳理数据分级、访问主体与保留周期。私有化不是一台机器，而是一套能被审计的边界。", points: ["数据分级", "网络隔离", "权限模型", "审计留痕"], goal: "明确数据流向图与安全责任人" },
  { title: "选择推理引擎", subtitle: "速度、显存、并发之间的取舍", description: "比较模型尺寸、量化方式与推理框架，让第一版系统在目标硬件上稳定输出。", points: ["模型选型", "显存估算", "量化策略", "吞吐压测"], goal: "完成首个本地模型 API 调用" },
  { title: "整理知识燃料", subtitle: "让文档成为可检索的原料", description: "清洗、切片并保留来源元数据。高质量知识库决定了 RAG 能走多远。", points: ["文档清洗", "分块策略", "元数据", "增量更新"], goal: "建立可追溯的知识入库管道" },
  { title: "搭建检索引擎", subtitle: "从海量碎片中找到正确证据", description: "结合向量召回、关键词匹配与重排序，把相关性从“差不多”推到“可用”。", points: ["Embedding", "混合检索", "Reranker", "过滤条件"], goal: "构造一套可评估的检索集" },
  { title: "约束生成回答", subtitle: "答案必须带着依据抵达", description: "将检索片段、引用规则与拒答策略编排进提示词，让模型知道何时回答、何时停下。", points: ["上下文编排", "引用回链", "拒答机制", "幻觉评测"], goal: "每条答案均可定位原始资料" },
  { title: "观测与持续演化", subtitle: "把上线作为下一轮学习的起点", description: "记录每次检索、延迟与用户反馈，以真实问题反向优化数据、模型和链路。", points: ["链路追踪", "效果评估", "用户反馈", "版本治理"], goal: "建立 RAG 质量看板与迭代节奏" },
];

const architectures = [
  { title: "资料入库", copy: "把 PDF、网页、制度与业务文档统一解析，去掉噪声并留下作者、时间、权限等关键元数据。", tags: ["Parser", "Chunking", "Metadata"], strength: 42, note: "质量基线 / 42%" },
  { title: "向量索引", copy: "将每个知识片段编码成语义坐标，并与原文、版本号、权限标签一起写入可持久化的索引。", tags: ["Embedding", "Milvus", "Versioning"], strength: 59, note: "语义覆盖 / 59%" },
  { title: "混合检索", copy: "向量语义召回解决“意思相近”，关键词检索保证专有名词精准命中，重排模型负责最后判断。", tags: ["Dense", "BM25", "Reranker"], strength: 78, note: "相关性 / 78%" },
  { title: "上下文生成", copy: "仅把得分足够高、权限允许且尚未过期的证据送入模型，同时要求回答引用来源。", tags: ["Prompt", "Guardrail", "Citation"], strength: 87, note: "受控生成 / 87%" },
  { title: "可溯源回答", copy: "用户不只看到结论，还可以回到原始段落；系统也因此能持续发现缺失、冲突或过期的知识。", tags: ["Source", "Feedback", "Eval"], strength: 100, note: "可信回答 / 100%" },
];

const scenarios = [
  { label: "SCENARIO / 01", title: "单卡验证站", copy: "适合个人或小团队完成首个私有化闭环：一台 GPU 主机、一个模型服务与轻量知识库。", stats: [["GPU", "24GB VRAM"], ["模型", "7B / 14B 量化"], ["并发", "1–5 请求"], ["适用", "PoC 验证"]], code: "services:\n  llm:\n    image: vllm/vllm-openai\n    model: Qwen2.5-7B-Instruct\n    gpu_memory_utilization: 0.85\n  vectordb:\n    image: qdrant/qdrant\n  rag-api:\n    depends_on: [llm, vectordb]" },
  { label: "SCENARIO / 02", title: "团队知识站", copy: "面向部门资料库与多角色协作，分离模型、向量库和业务 API，并开始接入权限与监控。", stats: [["GPU", "2 × 48GB VRAM"], ["模型", "32B 量化 / 多模型"], ["并发", "10–30 请求"], ["适用", "部门内测"]], code: "cluster:\n  inference:\n    replicas: 2\n    model: Qwen2.5-32B-AWQ\n  retrieval:\n    hybrid_search: true\n    reranker: bge-reranker-v2\n  observability:\n    traces: enabled" },
  { label: "SCENARIO / 03", title: "生产智能体站", copy: "为业务系统提供稳定能力：高可用推理、权限网关、版本治理和持续质量评估缺一不可。", stats: [["GPU", "按 SLA 弹性扩容"], ["模型", "70B / 路由策略"], ["并发", "100+ 请求"], ["适用", "生产业务"]], code: "gateway:\n  auth: oidc\n  rate_limit: enabled\nrag_pipeline:\n  retrieval: hybrid + rerank\n  citations: required\n  evaluation: daily\nserving:\n  autoscaling: enabled\n  canary_release: true" },
];

const checks = ["数据、模型与向量库均位于受控网络", "已完成目标模型的显存与并发压测", "知识分块保留来源、时间与权限元数据", "回答展示引用，缺少证据时会拒答", "记录检索链路并建立周期性评估" ];

const routeList = document.querySelector(".route-list");
const routeDetail = document.querySelector(".route-detail");
const scenarioTabs = document.querySelector(".scenario-tabs");
const scenarioContent = document.querySelector(".scenario-content");
const architectureDetail = document.querySelector(".architecture-detail");
const checkItems = document.querySelector("#checkItems");
const toast = document.querySelector("#toast");

function renderRoute(index) {
  const route = routes[index];
  document.querySelectorAll(".route-item").forEach((item, itemIndex) => item.classList.toggle("active", itemIndex === index));
  routeDetail.querySelector(".detail-kicker").textContent = `MISSION ${String(index + 1).padStart(2, "0")}`;
  routeDetail.querySelector(".detail-orb span").textContent = String(index + 1).padStart(2, "0");
  routeDetail.querySelector("h3").textContent = route.title;
  routeDetail.querySelector(".detail-copy").textContent = route.description;
  routeDetail.querySelector(".detail-list").innerHTML = route.points.map((point) => `<li>${point}</li>`).join("");
  routeDetail.querySelector(".detail-footer strong").textContent = route.goal;
}

function initRoutes() {
  routeList.innerHTML = routes.map((route, index) => `<button class="route-item ${index === 0 ? "active" : ""}" type="button" role="tab" aria-selected="${index === 0}" data-route="${index}"><b>${String(index + 1).padStart(2, "0")}</b><span><strong>${route.title}</strong><small>${route.subtitle}</small></span><i>↗</i></button>`).join("");
  routeList.addEventListener("click", (event) => {
    const item = event.target.closest("[data-route]");
    if (item) renderRoute(Number(item.dataset.route));
  });
  renderRoute(0);
}

function renderArchitecture(index) {
  const item = architectures[index];
  document.querySelectorAll(".architecture-node").forEach((node, nodeIndex) => node.classList.toggle("active", nodeIndex === index));
  architectureDetail.querySelector("p span").textContent = String(index + 1).padStart(2, "0");
  architectureDetail.querySelector("h3").textContent = item.title;
  architectureDetail.querySelector(".architecture-copy").textContent = item.copy;
  architectureDetail.querySelector(".architecture-tags").innerHTML = item.tags.map((tag) => `<span>${tag}</span>`).join("");
  architectureDetail.querySelector(".signal-meter b").style.width = `${item.strength}%`;
  architectureDetail.querySelector(".signal-meter em").textContent = item.note;
}

function initArchitecture() {
  document.querySelector(".architecture-map").addEventListener("click", (event) => {
    const node = event.target.closest("[data-architecture]");
    if (node) renderArchitecture(Number(node.dataset.architecture));
  });
  renderArchitecture(0);
}

function renderScenario(index) {
  const scenario = scenarios[index];
  document.querySelectorAll(".scenario-tab").forEach((tab, tabIndex) => tab.classList.toggle("active", tabIndex === index));
  scenarioContent.querySelector(".scenario-label").textContent = scenario.label;
  scenarioContent.querySelector("h3").textContent = scenario.title;
  scenarioContent.querySelector(".scenario-copy > p:not(.scenario-label)").textContent = scenario.copy;
  scenarioContent.querySelector("dl").innerHTML = scenario.stats.map(([key, value]) => `<div><dt>${key}</dt><dd>${value}</dd></div>`).join("");
  scenarioContent.querySelector("code").textContent = scenario.code;
}

function initScenarios() {
  scenarioTabs.innerHTML = scenarios.map((scenario, index) => `<button class="scenario-tab ${index === 0 ? "active" : ""}" type="button" role="tab" data-scenario="${index}">${scenario.title}</button>`).join("");
  scenarioTabs.addEventListener("click", (event) => { const tab = event.target.closest("[data-scenario]"); if (tab) renderScenario(Number(tab.dataset.scenario)); });
  renderScenario(0);
}

function showToast(message) { toast.textContent = message; toast.classList.add("show"); window.clearTimeout(showToast.timer); showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2600); }

function updateChecklist() {
  const selected = [...document.querySelectorAll(".check-item input:checked")].map((input) => input.value);
  localStorage.setItem("aimaster-rag-checklist", JSON.stringify(selected));
  document.querySelector("#checkProgress").textContent = `${selected.length} / ${checks.length}`;
  document.querySelector(".checklist-progress b").style.width = `${(selected.length / checks.length) * 100}%`;
  document.querySelector("#readyState").classList.toggle("show", selected.length === checks.length);
}

function initChecklist() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem("aimaster-rag-checklist")) || []; } catch { saved = []; }
  checkItems.innerHTML = checks.map((item, index) => `<label class="check-item"><input type="checkbox" value="${index}" ${saved.includes(String(index)) || saved.includes(index) ? "checked" : ""}/><i>✓</i><span>${item}</span><em>0${index + 1}</em></label>`).join("");
  checkItems.addEventListener("change", updateChecklist); updateChecklist();
}

function runLab() {
  const question = document.querySelector("#rag-query").value.trim() || "如何让 RAG 的回答可追溯，并避免引用过期知识？";
  const rows = [...document.querySelectorAll(".trace-list li")];
  const status = document.querySelector("#lab-status");
  const answer = document.querySelector("#answer-text");
  const citations = document.querySelector("#citations");
  rows.forEach((row) => row.classList.remove("active")); citations.innerHTML = ""; answer.textContent = "正在等待检索证据…"; status.textContent = "QUERYING";
  rows[0].classList.add("active"); rows[0].querySelector("strong").textContent = "解析问题与权限范围"; rows[0].querySelector("small").textContent = `查询：${question.slice(0, 28)}${question.length > 28 ? "…" : ""}`;
  window.setTimeout(() => { rows[1].classList.add("active"); rows[1].querySelector("strong").textContent = "召回 12 段候选资料，重排至 3 段"; rows[1].querySelector("small").textContent = "向量召回 + 关键词命中 + reranker"; status.textContent = "RERANKING"; }, 680);
  window.setTimeout(() => { rows[2].classList.add("active"); rows[2].querySelector("strong").textContent = "将高置信度片段写入受控上下文"; rows[2].querySelector("small").textContent = "要求引用来源；超出证据范围则明确拒答"; status.textContent = "GROUNDED"; }, 1300);
  window.setTimeout(() => { answer.textContent = "将每个分块写入来源、版本日期与权限标签；检索时先按权限和有效期过滤，再用混合检索与重排确定证据。生成阶段强制返回引用，并在没有足够证据时拒绝扩写。这样每个结论都能回到原始资料，也能在文档更新后主动失效旧索引。"; citations.innerHTML = ["《RAG 质量规范》 §3.2", "《知识库版本策略》 2026.07", "检索评测集 / case-08"].map((citation) => `<span>${citation}</span>`).join(""); status.textContent = "COMPLETE"; showToast("实验完成：回答已附带可验证的证据链。"); }, 1960);
}

function initLab() {
  document.querySelector("#runLab").addEventListener("click", runLab);
  document.querySelectorAll("[data-example]").forEach((button) => button.addEventListener("click", () => { document.querySelector("#rag-query").value = button.dataset.example; document.querySelector("#rag-query").focus(); }));
}

function initOrbit() {
  const orbit = document.querySelector("#heroOrbit");
  orbit.addEventListener("pointermove", (event) => { const bounds = orbit.getBoundingClientRect(); const x = (event.clientX - bounds.left) / bounds.width - .5; const y = (event.clientY - bounds.top) / bounds.height - .5; orbit.style.transform = `rotateX(${7 - y * 10}deg) rotateY(${-7 + x * 13}deg)`; });
  orbit.addEventListener("pointerleave", () => { orbit.style.transform = "rotateX(7deg) rotateY(-7deg)"; });
  document.querySelectorAll(".orbit-point").forEach((point) => point.addEventListener("click", () => showToast(point.dataset.tip)));
}

function initCanvas() {
  const canvas = document.querySelector("#starfield"); const context = canvas.getContext("2d"); let width = 0; let height = 0; let stars = []; let pointer = { x: -999, y: -999 };
  const createStar = () => ({ x: Math.random() * width, y: Math.random() * height, z: Math.random() * .9 + .15, drift: (Math.random() - .5) * .08, hue: Math.random() > .75 ? 169 : Math.random() > .55 ? 236 : 260 });
  const resize = () => { const ratio = Math.min(window.devicePixelRatio || 1, 2); width = innerWidth; height = innerHeight; canvas.width = width * ratio; canvas.height = height * ratio; canvas.style.width = `${width}px`; canvas.style.height = `${height}px`; context.setTransform(ratio, 0, 0, ratio, 0, 0); stars = Array.from({ length: Math.min(180, Math.floor(width * height / 9000)) }, createStar); };
  const draw = () => { context.clearRect(0, 0, width, height); stars.forEach((star) => { star.y += star.z * .1; star.x += star.drift; if (star.y > height + 4 || star.x < -4 || star.x > width + 4) Object.assign(star, createStar(), { y: -3 }); const size = star.z * 1.35; context.beginPath(); context.fillStyle = `hsla(${star.hue}, 90%, 83%, ${.18 + star.z * .55})`; context.arc(star.x, star.y, size, 0, Math.PI * 2); context.fill(); }); for (let index = 0; index < stars.length; index += 1) { const star = stars[index]; const distance = Math.hypot(star.x - pointer.x, star.y - pointer.y); if (distance < 150) { context.beginPath(); context.strokeStyle = `rgba(120, 190, 255, ${(1 - distance / 150) * .16})`; context.moveTo(star.x, star.y); context.lineTo(pointer.x, pointer.y); context.stroke(); } } requestAnimationFrame(draw); };
  window.addEventListener("resize", resize); window.addEventListener("pointermove", (event) => { pointer = { x: event.clientX, y: event.clientY }; document.documentElement.style.setProperty("--cursor-x", `${event.clientX}px`); document.documentElement.style.setProperty("--cursor-y", `${event.clientY}px`); }); resize(); draw();
}

function initInterface() {
  const header = document.querySelector(".site-header"); const nav = document.querySelector(".nav-links"); const menu = document.querySelector(".menu-toggle");
  window.addEventListener("scroll", () => header.classList.toggle("scrolled", scrollY > 20), { passive: true });
  menu.addEventListener("click", () => { const open = nav.classList.toggle("open"); menu.setAttribute("aria-expanded", String(open)); });
  nav.addEventListener("click", () => { nav.classList.remove("open"); menu.setAttribute("aria-expanded", "false"); });
  document.querySelectorAll("[data-scroll]").forEach((button) => button.addEventListener("click", () => document.querySelector(button.dataset.scroll).scrollIntoView({ behavior: "smooth" })));
  const observer = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add("visible"); observer.unobserve(entry.target); } }), { threshold: .12 }); document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));
}

initRoutes(); initArchitecture(); initScenarios(); initChecklist(); initLab(); initOrbit(); initCanvas(); initInterface();
