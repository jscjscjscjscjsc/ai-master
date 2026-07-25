# 国产 Agent 长网页视频

打开 `agent-video.html` 即可播放网页。页面使用 1920 x 1080 的横向录制视口，并会随着屏幕尺寸自适应。

页面已内置三类产品能力示意界面，明确标为“非官方界面”，因此无需准备截图。录制到这些段落后，可暂停录制并切换到真实产品网页操作，再剪辑回长网页视频。

## 简易录制

1. 用 Chrome 打开 `agent-video.html`，全屏或将窗口设为 1920 x 1080。
2. 打开系统录屏，选择录制窗口，帧率设为 30fps。
3. 从页面顶部开始，以每秒约一个鼠标滚轮刻度的速度匀速下滑；在表格和成果截图处各停 3 至 5 秒。
4. 总时长目标为 6 分钟。开场、三款产品和结尾可各停留稍久，口播会更从容。

## Playwright 自动录制

先安装 Playwright：`npm i -D playwright`，再执行 `npx playwright install chromium`。

运行：`node scripts/record-agent-video.mjs`。它会以 1920 x 1080 打开页面、按 360 秒匀速滚到底部，并把 WebM 写入 `recordings` 目录。可用 `DURATION_SECONDS=420` 延长至 7 分钟。

## Remotion

将 `remotion/AgentScroll.tsx` 放入已有 Remotion 项目，在 `Root.tsx` 注册合成：

```tsx
<Composition id="AgentScroll" component={AgentScroll} width={1920} height={1080} fps={30} durationInFrames={10800} />
```

`10800` 帧等于 6 分钟。组件中的视觉是讲解用的非官方示意页，可直接渲染；在产品实操段落再插入你的真实录屏。渲染命令：`npx remotion render AgentScroll out/agent-review.mp4`。
