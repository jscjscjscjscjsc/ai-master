# AIMaster · Private RAG Starlab

独立的「私有化部署大模型与 RAG」教学章节，可直接作为 AIMaster 的一个静态页面接入。

## 使用

- 在浏览器中打开 `index.html`，或通过任意静态服务器托管本目录。
- 页面只依赖 `index.html`、`styles.css` 与 `app.js`，不加载外部图片、视频、字体或前端库，适合内网环境。
- 把这三个文件复制到 AIMaster 的章节目录后，将章节入口指向 `index.html` 即可。

## 页面交互

- 可点击切换六步学习航线、RAG 处理节点与三种部署拓扑。
- RAG 实验区演示问题解析、混合检索、重排、受控回答与来源引用。
- 上线清单使用浏览器 `localStorage` 保存进度，键名为 `aimaster-rag-checklist`。

## 设计 Token

- 背景：`#060817`
- 主强调：`#9486ff`
- 信号色：`#68f1df`
- 卡片边界：`rgba(181,197,255,.17)`

动效仅使用 Canvas 绘制以及 CSS 的 `transform`、`opacity`，并为“减少动态效果”系统设置提供了降级支持。
