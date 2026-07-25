const ideaInput = document.querySelector('#idea');
const counter = document.querySelector('#counter');
const launchButton = document.querySelector('#launch');
const flight = document.querySelector('#flight');
const result = document.querySelector('#result');
const modelModal = document.querySelector('#model-modal');
const modelForm = document.querySelector('#model-form');
const modelNameInput = document.querySelector('#model-name');
const apiKeyInput = document.querySelector('#api-key');
const modelError = document.querySelector('#model-error');
const modelButton = document.querySelector('#open-model');
const MODEL_STORAGE_KEY = 'vibe-starlab-model-connection';
let modelConfig = null;
try { modelConfig = JSON.parse(sessionStorage.getItem(MODEL_STORAGE_KEY) || 'null'); } catch { sessionStorage.removeItem(MODEL_STORAGE_KEY); }
let resumeLaunchAfterConnection = false;

function escapeHTML(value) { const holder = document.createElement('div'); holder.textContent = value ?? ''; return holder.innerHTML; }
function listItems(values, ordered = false) { return `<${ordered ? 'ol' : 'ul'}>${(values || []).map(value => `<li>${escapeHTML(value)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`; }

function renderProjects(projects) {
  if (!projects.length) return '<p class="project-desc">本次未取到 GitHub 候选项目；实施路径仍由智能体根据产品诊断生成。部署环境可配置 GITHUB_TOKEN 提高检索稳定性。</p>';
  const template = document.querySelector('#project-template'); const container = document.createElement('div'); container.className = 'project-list';
  projects.forEach(project => {
    const node = template.content.firstElementChild.cloneNode(true);
    node.href = project.url; node.querySelector('.project-name').textContent = project.name;
    node.querySelector('.project-desc').textContent = project.description;
    node.querySelector('.project-stars').textContent = `★ ${Number(project.stars).toLocaleString()}`;
    node.querySelector('.project-lang').textContent = project.language; container.append(node);
  });
  return container.outerHTML;
}

function renderDiscovery(discovery) {
  const decisions = (discovery.key_decisions || []).map(item => `<div class="decision"><b>${escapeHTML(item.decision)}</b><p>${escapeHTML(item.reason)}</p><small>取舍：${escapeHTML(item.tradeoff)}</small></div>`).join('');
  return `<article class="mission"><small>PRODUCT MANAGER DIAGNOSIS</small><h2>${escapeHTML(discovery.product_name)}</h2><p>${escapeHTML(discovery.core_promise)}</p><div class="mission-metrics"><span>目标用户：${escapeHTML(discovery.target_user)}</span><span>触发场景：${escapeHTML(discovery.trigger_scenario)}</span><span>验证信号：${escapeHTML(discovery.success_signal)}</span></div></article>
  <article class="card wide"><h3>✦ 先做这些关键取舍</h3><div class="decision-grid">${decisions}</div><p class="muted-label">本次不做：${(discovery.non_goals || []).map(escapeHTML).join(' · ')}</p></article>`;
}

function renderPath(path) {
  return `<div class="path">${(path || []).map((stage, index) => `<article class="stage"><div class="stage-number"><span>${index + 1}</span></div><div class="stage-body"><div class="stage-head"><small>${escapeHTML(stage.estimated_time)}</small><h4>${escapeHTML(stage.stage)}</h4></div><p class="stage-purpose">${escapeHTML(stage.purpose)}</p><div class="deliverable">完成标志：${escapeHTML(stage.deliverable)}</div><div class="task-list">${(stage.tasks || []).map((task, taskIndex) => `<label class="task"><input class="build-task" type="checkbox" data-stage="${index}" data-task="${taskIndex}"><span><b>${escapeHTML(task.action)}</b><p>${escapeHTML(task.why)}</p><small>你将得到：${escapeHTML(task.artifact)}</small></span></label>`).join('')}</div><div class="stage-foot"><span>自己验证：${escapeHTML(stage.validation)}</span><span>提前注意：${escapeHTML(stage.risk)}</span></div></div></article>`).join('')}</div>`;
}

function renderRoadmap(roadmap, projects) {
  const layers = (roadmap.architecture || []).map(layer => `<div class="feature"><b>${escapeHTML(layer.layer)} · ${escapeHTML(layer.choice)}</b><p>${escapeHTML(layer.why)}</p></div>`).join('');
  const journey = (roadmap.user_journey || []).map(step => `<div class="feature"><b>${escapeHTML(step.step)}：${escapeHTML(step.user_action)}</b><p>产品响应：${escapeHTML(step.product_response)}</p></div>`).join('');
  const notes = (roadmap.open_source_notes || []).map(note => `<div class="feature"><b>${escapeHTML(note.project)}</b><p>借鉴：${escapeHTML(note.use_for)}</p><small>注意：${escapeHTML(note.caution)}</small></div>`).join('');
  return `<article class="card route-intro"><h3>✦ 你的自主建造路线</h3><h2>${escapeHTML(roadmap.route_title)}</h2><p>${escapeHTML(roadmap.summary)}</p><div class="first-session"><b>第一次打开编辑器时，只完成这一件事：</b>${escapeHTML(roadmap.first_session_goal)}</div></article>
  <article class="card wide"><div class="path-title"><div><h3>✦ 从想法到可运行网页的实施路径</h3><p>不要一次做完。完成一项就勾选一项；每一阶段都有自己的交付物与验证方法。</p></div><div class="build-progress"><b id="progress-count">0 / 0</b><span>已完成行动</span></div></div>${renderPath(roadmap.build_path)}</article>
  <div class="grid"><article class="card"><h3>✦ 最小技术架构</h3><div class="list">${layers}</div></article><article class="card"><h3>✦ 用户会经历什么</h3><div class="list">${journey}</div></article><article class="card"><h3>✦ 借鉴，而非照搬</h3><div class="list">${notes}</div></article><article class="card"><h3>✦ GitHub 候选项目</h3>${renderProjects(projects)}</article></div>
  ${(roadmap.next_questions || []).length ? `<article class="card wide"><h3>✦ 开工前，智能体还需要你确认</h3>${listItems(roadmap.next_questions, true)}</article>` : ''}`;
}

function progressStorageKey(idea) {
  let hash = 0;
  for (let index = 0; index < idea.length; index += 1) hash = ((hash << 5) - hash) + idea.charCodeAt(index) | 0;
  return `vibe-starlab-build:${hash}`;
}

function bindBuildProgress(idea) {
  const storageKey = progressStorageKey(idea);
  const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
  const tasks = [...document.querySelectorAll('.build-task')];
  const update = () => {
    const done = tasks.filter(task => task.checked).length;
    document.querySelector('#progress-count').textContent = `${done} / ${tasks.length}`;
  };
  tasks.forEach(task => {
    const key = `${task.dataset.stage}-${task.dataset.task}`;
    task.checked = Boolean(saved[key]);
    task.addEventListener('change', () => { saved[key] = task.checked; localStorage.setItem(storageKey, JSON.stringify(saved)); update(); });
  });
  update();
}

function render(data) {
  result.innerHTML = renderDiscovery(data.discovery) + renderRoadmap(data.roadmap, data.projects);
  bindBuildProgress(data.idea);
  result.classList.remove('hidden'); result.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function launch() {
  const idea = ideaInput.value.trim();
  if (idea.length < 8) { ideaInput.focus(); ideaInput.placeholder = '再具体一点：谁会在什么场景下使用它？'; return; }
  if (!modelConfig?.apiKey) { resumeLaunchAfterConnection = true; openModelModal(); return; }
  launchButton.disabled = true; flight.classList.remove('hidden'); result.classList.add('hidden');
  try {
    const response = await fetch('/api/discover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idea, model_config: { api_key: modelConfig.apiKey, model: modelConfig.model } }) });
    const data = await response.json(); if (!response.ok || !data.success) throw new Error(data.message || '星际通信暂时失败'); render(data);
  } catch (error) {
    result.innerHTML = `<article class="card"><h3>智能体暂时没有完成推演</h3><p class="project-desc">${escapeHTML(error.message)}</p><button class="retry-model" type="button">检查模型连接</button></article>`;
    result.classList.remove('hidden');
    result.querySelector('.retry-model')?.addEventListener('click', openModelModal);
  } finally { launchButton.disabled = false; flight.classList.add('hidden'); }
}

function updateModelStatus() {
  const label = modelButton.querySelector('span');
  label.textContent = modelConfig?.apiKey ? `已连接 · ${modelConfig.model}` : '连接模型';
  modelButton.classList.toggle('connected', Boolean(modelConfig?.apiKey));
}

function openModelModal() {
  modelNameInput.value = modelConfig?.model || 'deepseek-chat';
  apiKeyInput.value = modelConfig?.apiKey || '';
  modelError.classList.add('hidden'); modelError.textContent = '';
  modelModal.classList.remove('hidden');
  setTimeout(() => apiKeyInput.focus(), 0);
}

function closeModelModal() { modelModal.classList.add('hidden'); resumeLaunchAfterConnection = false; }

modelForm.addEventListener('submit', event => {
  event.preventDefault();
  const apiKey = apiKeyInput.value.trim(); const model = modelNameInput.value.trim();
  if (!apiKey || !model) { modelError.textContent = '请填写模型名称和 API Key。'; modelError.classList.remove('hidden'); return; }
  modelConfig = { apiKey, model };
  sessionStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(modelConfig));
  const shouldLaunch = resumeLaunchAfterConnection;
  modelModal.classList.add('hidden'); resumeLaunchAfterConnection = false; updateModelStatus();
  if (shouldLaunch) launch();
});
document.querySelector('#close-model').addEventListener('click', closeModelModal);
document.querySelector('#cancel-model').addEventListener('click', closeModelModal);
modelButton.addEventListener('click', openModelModal);
modelModal.addEventListener('click', event => { if (event.target === modelModal) closeModelModal(); });

ideaInput.addEventListener('input', () => { counter.textContent = `${ideaInput.value.length} / 1200`; }); launchButton.addEventListener('click', launch);
document.querySelectorAll('[data-idea]').forEach(button => button.addEventListener('click', () => { ideaInput.value = button.dataset.idea; ideaInput.dispatchEvent(new Event('input')); ideaInput.focus(); }));
updateModelStatus();

const sky = document.querySelector('#sky'); const context = sky.getContext('2d'); let stars = [];
function resize() { sky.width = innerWidth * devicePixelRatio; sky.height = innerHeight * devicePixelRatio; context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); stars = Array.from({ length: Math.min(150, Math.floor(innerWidth / 7)) }, () => ({ x: Math.random() * innerWidth, y: Math.random() * innerHeight, r: Math.random() * 1.4 + .25, a: Math.random() })); }
function draw(time) { context.clearRect(0, 0, innerWidth, innerHeight); stars.forEach((star, index) => { context.globalAlpha = .25 + .65 * Math.abs(Math.sin(time / 1300 + index)); context.fillStyle = index % 9 === 0 ? '#bba2ff' : '#d8efff'; context.beginPath(); context.arc(star.x, star.y, star.r, 0, Math.PI * 2); context.fill(); }); requestAnimationFrame(draw); }
addEventListener('resize', resize); resize(); requestAnimationFrame(draw);
