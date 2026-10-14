import { chromium } from '../packages/runner/node_modules/playwright/index.mjs';
const endpoint = process.argv[2];
if (!endpoint) throw new Error('Cần CDP endpoint của profile test do bạn vừa mở');
const url = new URL(endpoint);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('CDP phải loopback');
const browser = await chromium.connectOverCDP(endpoint);
try {
  const context = browser.contexts()[0];
  if (!context) throw new Error('Không có context sẵn có');
  const originalPages = context.pages().length;
  const page = await context.newPage(); await page.close();
  console.log(JSON.stringify({ existingContext: true, originalPages, pagesAfter: context.pages().length }));
} finally { await browser.close(); }
