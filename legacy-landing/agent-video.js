const scenes = [...document.querySelectorAll('.scene')];
const progress = document.querySelector('.progress span');
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => { if (entry.isIntersecting) entry.target.classList.add('active'); });
}, { threshold: 0.35 });
scenes.forEach((scene) => observer.observe(scene));

const demos = {
  trae: ['Trae Work · 任务工作台', '生成产品介绍页', '正在规划组件、页面与样式'],
  buddy: ['WorkBuddy · 文件协作', '读取项目资料', '已找到 3 份待处理文件'],
  zcode: ['ZCode · 开发任务', '实现产品落地页', '正在更新 components / page.tsx'],
  'trae-result': ['Trae · 前端成果', '产品落地页', '结构与样式已生成'],
  'buddy-result': ['WorkBuddy · 前端成果', '内容型页面', '资料已整理进页面'],
  'zcode-result': ['ZCode · 前端成果', '工程化页面', '组件可继续迭代'],
};
const windowMarkup = ([title, task, status]) => `<div class="demo-window"><header><i class="dot"></i><i class="dot"></i><i class="dot"></i></header><aside><b>工作区</b>任务<br>文件<br>预览<br>终端</aside><div class="demo-content"><span class="demo-tag">能力示意 · 非官方界面</span><h3>${title}</h3><p>${task}</p><div class="task-line"><i>●</i> ${status}</div><div class="code-lines"><span></span><span></span><span></span><span></span></div></div></div>`;
document.querySelectorAll('.demo-screen').forEach((slot) => {
  const key = slot.dataset.demo;
  if (demos[key]) slot.innerHTML = windowMarkup(demos[key]);
  if (key === 'remote') slot.innerHTML = `<div class="phone-layout"><div>${windowMarkup(['Trae Work · 远程执行', '手机继续推进电脑任务', '本地任务运行中'])}</div><div class="phone"><b>Trae Work</b><p>教学视频任务<br>状态：执行中</p><span class="run">继续执行</span></div></div>`;
  if (key === 'document') slot.innerHTML = `<div class="doc-paper"><b>项目资料填写单</b><p>客户名称：<span class="filled">已从文件读取</span></p><p>项目状态：<span class="filled">待确认</span></p><p>保存位置：<span class="filled">协作文件夹</span></p></div>`;
});

function goToScene(index) {
  const target = scenes[(index + scenes.length) % scenes.length];
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
document.querySelectorAll('.advance').forEach((button) => button.addEventListener('click', () => {
  const current = button.closest('.scene');
  goToScene(button.classList.contains('restart') ? 0 : Number(current.dataset.scene) + 1);
}));
window.addEventListener('scroll', () => {
  const total = document.documentElement.scrollHeight - innerHeight;
  progress.style.width = `${total ? (scrollY / total) * 100 : 0}%`;
}, { passive: true });
