# 驾驭工程与智能体的兴起 · 章节 CG

一个完全离线、零依赖的 AIMaster 章节引导页面。

## 接入 AIMaster

主界面的章节卡片跳转到：

```text
/static/agentic-engineering-cg/index.html?target=/你的知识页面地址
```

片尾“开始学习”会读取 `target` 查询参数并跳转。若没有传入参数，则使用 `app.js` 顶部 `CONFIG.learningUrl` 的默认值 `../agentic-engineering.html`。

## 播放控制

- 自动播放五幕，共约 30 秒。
- 空格：暂停/继续。
- 左右方向键：切换上一幕/下一幕。
- “跳过片头”：直接进入最终启程画面。
- 系统开启“减少动态效果”时，页面会停止自动播放并关闭高频动画。

## 文件

- `index.html`：章节叙事结构与稳定跳转入口。
- `styles.css`：星空视觉、五幕场景和响应式设计。
- `responsive.css`：窄屏标题安全区补充，避免小屏裁切。
- `app.js`：播放状态、Canvas 星空、键盘控制和目标 URL 配置。
