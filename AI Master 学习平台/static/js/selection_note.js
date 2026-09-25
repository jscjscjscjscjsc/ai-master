/* A temporary note tied to the current lesson selection. No conversation window. */
(() => {
  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'selection-action';
  action.textContent = '解释选段';
  const note = document.createElement('aside');
  note.className = 'selection-note';
  note.setAttribute('aria-label', '选段解释');
  note.innerHTML = '<header><strong>选段解释</strong><button type="button" aria-label="关闭">×</button></header><div class="selected"></div><div class="answer" aria-live="polite"></div><div class="status"></div>';
  document.body.append(action, note);
  let current = null;
  let controller = null;
  const place = (element, rect, lower = false) => {
    element.style.left = `${Math.max(12, Math.min(innerWidth - (lower ? 392 : 110), rect.left))}px`;
    element.style.top = `${Math.max(12, Math.min(innerHeight - (lower ? 275 : 44), lower ? rect.bottom + 8 : rect.top - 42))}px`;
  };
  const hide = () => { action.classList.remove('visible'); note.classList.remove('visible'); if (controller) controller.abort(); };
  note.querySelector('header button').addEventListener('click', hide);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  document.addEventListener('pointerup', event => {
    if (action.contains(event.target) || note.contains(event.target)) return;
    const selection = window.getSelection();
    const selected = selection && selection.toString().trim();
    const anchor = selection && selection.anchorNode && selection.anchorNode.parentElement;
    const lesson = anchor && anchor.closest('.kp .lesson');
    if (!lesson || !selected || selected.length < 2 || selected.length > 1800 || !selection.rangeCount) {
      action.classList.remove('visible');
      return;
    }
    const kp = lesson.closest('.kp');
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    current = { selection: selected, chapter_id: Number(document.body.dataset.chapterId), kp_index: Number(kp.dataset.kpIndex), rect };
    place(action, rect);
    action.classList.add('visible');
  });
  action.addEventListener('click', async () => {
    if (!current) return;
    action.classList.remove('visible');
    if (controller) controller.abort();
    controller = new AbortController();
    const selectedBox = note.querySelector('.selected');
    const answer = note.querySelector('.answer');
    const status = note.querySelector('.status');
    selectedBox.textContent = current.selection;
    answer.textContent = '';
    status.textContent = '正在解释…';
    place(note, current.rect, true);
    note.classList.add('visible');
    try {
      const response = await fetch('/api/selection/explain', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selection: current.selection, chapter_id: current.chapter_id, kp_index: current.kp_index }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error((await response.json()).message || '解释失败');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop();
        for (const frame of frames) {
          const line = frame.split('\n').find(part => part.startsWith('data: '));
          if (!line) continue;
          const event = JSON.parse(line.slice(6));
          if (event.type === 'delta') answer.textContent += event.text;
          if (event.type === 'error') throw new Error(event.message);
          if (event.type === 'done') status.textContent = event.cached ? '已从缓存读取' : '';
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') status.textContent = error.message;
    }
  });
})();
