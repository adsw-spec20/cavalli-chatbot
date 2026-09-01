// login.js
// Opens a REAL Chrome window using a persistent profile folder.
// You log in by hand (email, password, pick user, access code).
// The login is saved to disk automatically (./tabit-profile), so later
// scripts reuse it without ever seeing your password.
//
// Just close the browser window when you are fully logged in and can see
// the reservations screen. That's it.

const { chromium } = require('playwright');
const path = require('path');

const PROFILE_DIR = path.join(__dirname, 'tabit-profile');
const URL = 'https://tgm-app.tabit.cloud/';

(async () => {
  console.log('Opening Chrome with a persistent profile at:', PROFILE_DIR);
  console.log('URL:', URL);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: null, // use the real window size
    args: [
      '--window-position=80,60',
      '--window-size=1280,880',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto(URL, { waitUntil: 'domcontentloaded' }).catch(() => {});

  // Aggressively pull the window to the foreground for the first 12 seconds
  // so it is not lost behind other Chrome windows.
  for (let i = 0; i < 6; i++) {
    try { await page.bringToFront(); } catch (_) {}
    await page.waitForTimeout(2000);
  }

  console.log('\n==================================================');
  console.log('  A Chrome window just opened.');
  console.log('  1) Log in: email + password');
  console.log('  2) Pick your user');
  console.log('  3) Enter the access code');
  console.log('  4) Wait until you see the reservations screen');
  console.log('  5) CLOSE the window. Your login is now saved.');
  console.log('==================================================\n');

  // Stay alive until the user closes the browser window (or 20 min timeout).
  await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    context.on('close', finish);
    page.on('close', finish);
    setTimeout(finish, 20 * 60 * 1000);
  });

  console.log('Login saved to profile. You can run the read script now.');
  try { await context.close(); } catch (_) {}
  process.exit(0);
})();
