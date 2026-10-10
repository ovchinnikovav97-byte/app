// Перерисовать превью ссылки (из корня репозитория):
//   PLAYWRIGHT_PATH=/opt/node-tools/node_modules/playwright \
//   node halloween/tools/render-og.mjs "$PWD/halloween/tools/og.html" halloween/og.jpg
// Нужен Playwright с Chromium (есть в облачной сессии Claude Code).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto('file://' + process.argv[2]);
await page.waitForLoadState('networkidle');
await page.evaluate(() => document.fonts.ready);
// JPEG: WhatsApp silently drops link previews with heavy images (keep it well under 300 KB).
const jpeg = /\.jpe?g$/i.test(process.argv[3]);
await page.screenshot({ path: process.argv[3], type: jpeg ? 'jpeg' : 'png', ...(jpeg ? { quality: 82 } : {}) });
await browser.close();
