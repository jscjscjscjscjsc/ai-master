(() => {
  "use strict";
  const output = document.getElementById("output-content");
  const esc = (value) => { const node = document.createElement("span"); node.textContent = value || ""; return node.innerHTML; };
  window.runCode = function runCodeStatic() {
    const code = window.editor?.getValue?.() || document.getElementById("code-editor")?.value || "";
    if (!code.trim()) return;
    const button = document.getElementById("btn-run"), dot = document.getElementById("status-dot"), status = document.getElementById("status-text");
    button.disabled = true; button.textContent = "运行中..."; dot.className = "status-dot running"; status.textContent = "正在运行..."; output.className = "output-content"; output.innerHTML = "<div style='color:var(--text-muted)'>正在准备本地 Python 沙盒...</div>";
    setTimeout(() => {
      let result = "[4, 16]";
      if (/range\s*\(/.test(code)) result = "0\n1\n2\n3\n4";
      if (/Hello|hello/i.test(code)) result = "Hello, AI Master!";
      if (/raise\s+|1\s*\/\s*0/.test(code)) { output.className = "output-content error"; output.innerHTML = `<div class='error-header'>运行出错（模拟）</div><pre>${esc("ZeroDivisionError: division by zero")}</pre>`; dot.className = "status-dot error"; status.textContent = "运行出错"; }
      else { output.innerHTML = `<div class='success-header'>运行成功（浏览器模拟）</div><pre style='margin:0;white-space:pre-wrap;'>${esc(result)}\n\n静态版未连接服务器，已使用安全的本地演示执行器。</pre>`; dot.className = "status-dot ready"; status.textContent = "执行完成"; }
      document.getElementById("elapsed").textContent = "0.08s"; button.disabled = false; button.textContent = "▶ 运行";
    }, 360);
  };
  window.openJJChat = function openJJChatStatic() { document.getElementById("jj-chat-overlay")?.classList.add("show"); };
  window.toggleJJChat = function toggleJJChatStatic() { document.getElementById("jj-chat-overlay")?.classList.toggle("show"); };
  window.sendJJMessage = function sendJJMessageStatic() { const input = document.getElementById("jj-input"), text = input?.value.trim(); if (!text) return; const messages = document.getElementById("jj-messages"); messages.insertAdjacentHTML("beforeend", `<div class='msg user'>${esc(text)}</div><div class='msg jj'>这是静态演示版回答：先检查输入、工具调用和输出，再逐步定位问题。</div>`); input.value = ""; messages.scrollTop = messages.scrollHeight; };
})();
