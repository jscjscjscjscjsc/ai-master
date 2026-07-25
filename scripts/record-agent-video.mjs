import { chromium } from 'playwright';

const pageUrl = process.env.PAGE_URL || 'file:///C:/Users/Administrator/Documents/New%20project/agent-video.html';
const seconds = Number(process.env.DURATION_SECONDS || 360);
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: 'recordings', size: { width: 1920, height: 1080 } } });
const page = await context.newPage();
await page.goto(pageUrl, { waitUntil: 'networkidle' });
await page.evaluate(async (duration) => {
  const max = document.documentElement.scrollHeight - innerHeight;
  const start = performance.now();
  await new Promise((resolve) => {
    function tick(now) {
      const progress = Math.min((now - start) / (duration * 1000), 1);
      window.scrollTo(0, max * progress);
      progress < 1 ? requestAnimationFrame(tick) : resolve();
    }
    requestAnimationFrame(tick);
  });
}, seconds);
await page.waitForTimeout(1500);
await context.close();
await browser.close();
console.log(`录制完成。视频在 recordings 目录；设定时长：${seconds}s。`);
