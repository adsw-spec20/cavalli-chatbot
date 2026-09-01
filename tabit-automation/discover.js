// discover.js
// Reuses the saved login session, loads the app, and records the internal
// API calls Tabit's own frontend makes. Read-only. No data is changed.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PROFILE_DIR = path.join(__dirname, 'tabit-profile');
const URL = 'https://tgm-app.tabit.cloud/';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    viewport: { width: 1600, height: 950 },
  });
  const page = context.pages()[0] || (await context.newPage());

  const apiCalls = [];
  page.on('response', async (resp) => {
    try {
      const req = resp.request();
      const url = resp.url();
      const ct = resp.headers()['content-type'] || '';
      if (ct.includes('application/json') || /api|reserv|booking|guest|tgm|table|floor/i.test(url)) {
        apiCalls.push({ method: req.method(), status: resp.status(), url, ct });
      }
    } catch (_) {}
  });

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(7000);

  const title = await page.title().catch(() => '');
  const curUrl = page.url();
  await page.screenshot({ path: path.join(OUT, 'state.png') }).catch(() => {});

  fs.writeFileSync(path.join(OUT, 'network.json'), JSON.stringify(apiCalls, null, 2));

  console.log('CURRENT_URL:', curUrl);
  console.log('TITLE:', title);
  console.log('TOTAL_API_CALLS:', apiCalls.length);
  console.log('--- unique endpoints (method + path) ---');
  const uniq = [...new Set(apiCalls.map((c) => `${c.status} ${c.method} ${c.url.split('?')[0]}`))];
  console.log(uniq.join('\n'));

  await context.close();
  process.exit(0);
})();
