// capture.js
// Reuses the saved session, loads the app, and captures the FULL request
// (URL, query, headers) and JSON response for the key tgm-api endpoints, so
// we learn the exact API shape. Read-only.
//
// The sensitive auth token is written only to out/capture-full.json (gitignored)
// and is NOT printed to the console.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const PROFILE_DIR = path.join(__dirname, 'tabit-profile');
const APP_URL = 'https://tgm-app.tabit.cloud/';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    viewport: { width: 1600, height: 950 },
  });
  const page = context.pages()[0] || (await context.newPage());

  const captured = {};

  page.on('response', async (resp) => {
    const url = resp.url();
    if (!url.includes('tgm-api.tabit.cloud')) return;
    try {
      const u = new URL(url);
      const req = resp.request();
      const ct = resp.headers()['content-type'] || '';
      let body = null;
      if (ct.includes('json')) body = await resp.json().catch(() => null);
      captured[url] = {
        method: req.method(),
        status: resp.status(),
        pathname: u.pathname,
        query: u.search,
        requestHeaders: req.headers(), // includes auth; stays in gitignored file only
        body,
      };
    } catch (_) {}
  });

  await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(8000);

  fs.writeFileSync(path.join(OUT, 'capture-full.json'), JSON.stringify(captured, null, 2));

  // Redacted, safe-to-log summary
  for (const [url, info] of Object.entries(captured)) {
    console.log('====', info.method, info.pathname, info.query || '');
    console.log('   status:', info.status);
    const hasAuth = !!info.requestHeaders['authorization'];
    console.log('   reqHeaderNames:', Object.keys(info.requestHeaders).join(','), '| hasAuth:', hasAuth);
    if (info.body && Array.isArray(info.body)) {
      console.log('   body: array of', info.body.length);
      if (info.body[0]) {
        console.log('   item keys:', Object.keys(info.body[0]).join(','));
        console.log('   item sample:', JSON.stringify(info.body[0]).slice(0, 1000));
      }
    } else if (info.body && typeof info.body === 'object') {
      console.log('   body keys:', Object.keys(info.body).join(','));
    }
  }

  await context.close();
  process.exit(0);
})();
