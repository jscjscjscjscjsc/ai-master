(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const esc = (value) => { const node = document.createElement("span"); node.textContent = value || ""; return node.innerHTML; };
  const questions = [
    { id: "qa-01", category: "模型基础", type: "qa", difficulty: "初级", question: "为什么 Transformer 需要位置编码？", answer: "自注意力本身不感知顺序，位置编码把 token 的位置信息注入表示，使模型能区分顺序和距离。" },
    { id: "qa-02", category: "RAG", type: "qa", difficulty: "中级", question: "RAG 为什么要把检索和生成拆成两个阶段？", answer: "检索负责找证据，生成负责组织答案。拆开后可以单独评估召回率、替换向量库，并降低模型幻觉。" },
    { id: "qa-03", category: "提示词工程", type: "qa_scenario", difficulty: "初级", question: "如何让模型稳定输出 JSON？", answer: "明确字段 schema、给出正反例，并要求只输出 JSON；生产环境还要用解析器和重试校验兜底。" },
    { id: "qa-04", category: "智能体", type: "qa_scenario", difficulty: "高级", question: "Agent 调用工具失败时应该如何设计？", answer: "记录工具输入输出，区分可重试和不可重试错误，限制重试次数，并让模型回退到澄清或人工确认。" },
    { id: "code-01", category: "Python 实践", type: "code", difficulty: "初级", question: "写一个函数，返回列表中所有偶数的平方。", answer: "使用列表推导式：return [x * x for x in values if x % 2 == 0]。" },
    { id: "code-02", category: "RAG", type: "code", difficulty: "中级", question: "实现一个最小的文档切片函数，并保留重叠窗口。", answer: "按 chunk_size 步进，下一块起点减去 overlap，直到覆盖全文。" },
    { id: "code-03", category: "模型基础", type: "code", difficulty: "高级", question: "实现 softmax，并处理数值溢出。", answer: "先减去 logits 最大值，再计算 exp 和归一化，避免指数溢出。" }
  ];
  const categories = [...new Set(questions.map((item) => item.category))];
  const state = { current: null, answered: JSON.parse(localStorage.getItem("aimaster_static_answers") || "{}"), favorites: JSON.parse(localStorage.getItem("aimaster_static_favorites") || "[]"), wrong: JSON.parse(localStorage.getItem("aimaster_static_wrong") || "[]") };
  function save() { localStorage.setItem("aimaster_static_answers", JSON.stringify(state.answered)); localStorage.setItem("aimaster_static_favorites", JSON.stringify(state.favorites)); localStorage.setItem("aimaster_static_wrong", JSON.stringify(state.wrong)); }
  function switchView(name) { document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === name)); document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === name)); if (name === "practice") renderQuestions(); if (name === "review") renderReview(); }
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  function renderDashboard() {
    const answered = Object.keys(state.answered).length;
    $("#answered").textContent = `${answered} / ${questions.length}`;
    $("#qaProgress").textContent = `理解 ${questions.filter((q) => q.type !== "code" && state.answered[q.id]).length} / ${questions.filter((q) => q.type !== "code").length}`;
    $("#codeProgress").textContent = `${questions.filter((q) => q.type === "code" && state.answered[q.id]).length} / ${questions.filter((q) => q.type === "code").length}`;
    $("#wrong").textContent = state.wrong.length; $("#favorite").textContent = `收藏重点 ${state.favorites.length}`;
    $("#progress").textContent = `${Math.round(answered / questions.length * 100)}%`;
    $("#categoryGrid").innerHTML = categories.map((category) => { const total = questions.filter((q) => q.category === category).length; const done = questions.filter((q) => q.category === category && state.answered[q.id]).length; return `<article class="category-card"><p class="eyebrow">${esc(category)}</p><strong>${done} / ${total}</strong><span>知识节点已同步</span><i><b style="width:${total ? done / total * 100 : 0}%"></b></i></article>`; }).join("");
    $("#badges").innerHTML = ["初级探索者", "RAG 架构师", "Agent 远征者"].map((name, index) => `<span class="badge ${answered >= (index + 1) * 2 ? "earned" : "locked"}">${answered >= (index + 1) * 2 ? "✦" : "○"}<b>${name}</b></span>`).join("");
  }
  function renderQuestions() {
    const category = $("#categoryFilter").value, type = $("#typeFilter").value, difficulty = $("#difficultyFilter").value;
    const list = questions.filter((q) => (!category || q.category === category) && (!type || q.type === type) && (!difficulty || q.difficulty === difficulty));
    $("#questionList").innerHTML = list.map((q) => `<button class="question-item ${state.current === q.id ? "active" : ""}" data-question="${q.id}"><small>${esc(q.category)} / ${esc(q.difficulty)}</small><strong>${esc(q.question)}</strong><span>${state.answered[q.id] ? "已完成" : "待探索"}</span></button>`).join("") || "<p class='sub'>没有匹配题目。</p>";
    document.querySelectorAll("[data-question]").forEach((button) => button.addEventListener("click", () => showQuestion(button.dataset.question)));
  }
  function showQuestion(id) {
    state.current = id; const q = questions.find((item) => item.id === id); if (!q) return; renderQuestions();
    const saved = state.answered[id]; const favorite = state.favorites.includes(id);
    $("#questionCard").innerHTML = `<p class="eyebrow">${esc(q.category)} / ${esc(q.difficulty)} / ${q.type === "code" ? "代码实践" : "问答理解"}</p><h2>${esc(q.question)}</h2>${q.type === "code" ? `<section class="code-task"><p>这是独立代码题，静态演示版会在当前页面模拟运行并记录结果。</p><button id="openCodeLab" class="primary">在当前页面开始代码实践</button></section>` : `<textarea id="answerInput" placeholder="写下你的理解，提交后会立即得到快速反馈。">${saved?.answer || ""}</textarea><button id="submitAnswer" class="primary">提交并评分</button>`}<button id="favoriteQuestion" class="text-button">${favorite ? "★ 已收藏" : "☆ 收藏题目"}</button><div id="answerFeedback" class="feedback">${saved ? `<strong>${saved.score} / 10</strong><p>${esc(saved.feedback)}</p>` : ""}</div>`;
    $("#favoriteQuestion").addEventListener("click", () => { state.favorites = favorite ? state.favorites.filter((item) => item !== id) : [...state.favorites, id]; save(); renderDashboard(); showQuestion(id); });
    if (q.type === "code") $("#openCodeLab").addEventListener("click", openCodeLab); else $("#submitAnswer").addEventListener("click", () => submitAnswer(q));
  }
  function submitAnswer(q) { const answer = $("#answerInput").value.trim(); if (answer.length < 8) return; const score = Math.min(10, Math.max(4, Math.round(answer.length / 22))); state.answered[q.id] = { answer, score, feedback: score >= 7 ? "核心方向正确，可以继续补充一个真实工程取舍。" : "先说明核心机制，再补充原因、例子和边界条件。" }; if (score < 7 && !state.wrong.includes(q.id)) state.wrong.push(q.id); save(); renderDashboard(); showQuestion(q.id); }
  function renderReview() { const groups = [["wrongList", state.wrong], ["favoriteList", state.favorites]]; groups.forEach(([target, ids]) => { $("#" + target).innerHTML = ids.length ? ids.map((id) => { const q = questions.find((item) => item.id === id); return q ? `<button class="review-item" data-question="${q.id}"><strong>${esc(q.question)}</strong><small>${esc(q.category)}</small></button>` : ""; }).join("") : "<p class='sub'>暂时没有记录。</p>"; }); document.querySelectorAll(".review-item").forEach((button) => button.addEventListener("click", () => { switchView("practice"); showQuestion(button.dataset.question); })); }
  function openCodeLab() { const q = questions.find((item) => item.id === state.current); $("#codeModal").hidden = false; $("#codeModalTitle").textContent = q.question; $("#codeModalPrompt").textContent = "在下方写出你的实现，点击运行查看模拟输出。"; $("#codeEditor").value = "def solve(values):\n    return [x * x for x in values if x % 2 == 0]\n\nprint(solve([1, 2, 3, 4]))"; $("#codeOutput").textContent = "等待运行结果。"; }
  document.addEventListener("click", (event) => { if (event.target.matches("[data-close-code]")) $("#codeModal").hidden = true; if (event.target.id === "runCode") $("#codeOutput").textContent = "模拟运行成功\n[4, 16]\n\n静态演示版：未连接服务器，输出由浏览器本地模拟。"; if (event.target.id === "submitCode") { state.answered[state.current] = { answer: $("#codeEditor").value, score: 8, feedback: "代码结构清晰，已完成本题的核心目标。" }; save(); $("#codeModal").hidden = true; renderDashboard(); showQuestion(state.current); } });
  $("#loadQuestions")?.addEventListener("click", renderQuestions); $("#refreshReview")?.addEventListener("click", renderReview); $("#categoryFilter").innerHTML += categories.map((category) => `<option>${esc(category)}</option>`).join("");
  $("#sendCoach")?.addEventListener("click", () => { const input = $("#coachInput"), text = input.value.trim(); if (!text) return; $("#coachMessages").innerHTML += `<div class="message user">${esc(text)}</div><div class="message coach">我会把这个问题拆成概念、例子和一次小练习。先从 ${esc(text.slice(0, 24))} 的核心机制开始。</div>`; input.value = ""; });
  document.querySelectorAll("[data-difficulty]").forEach((button) => button.addEventListener("click", () => { $("#interviewSetup").hidden = true; $("#interviewRun").hidden = false; $("#interviewQuestions").innerHTML = questions.slice(0, 5).map((q, i) => `<article class="interview-q"><p class="eyebrow">QUESTION ${String(i + 1).padStart(2, "0")} / ${esc(q.category)}</p><h3>${esc(q.question)}</h3><textarea placeholder="正式作答：请说明核心机制、关键取舍与工程实践。"></textarea></article>`).join(""); }));
  $("#finishInterview")?.addEventListener("click", () => { $("#interviewRun").innerHTML = `<div class="interview-setup"><p class="eyebrow">INTERVIEW RESULT</p><h2>76 / 100</h2><p>静态演示已完成。回到错题与收藏继续补足薄弱模块。</p></div>`; });
  renderDashboard(); renderQuestions();
})();
