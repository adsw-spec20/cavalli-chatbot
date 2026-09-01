// read-tomorrow.js
// READ-ONLY. Loads the app with the saved session and piggybacks on the
// app's OWN network calls to read reservations + tables, then reports the big
// reservations for a given day (default: tomorrow) with each one's deposit
// status. No API call is forged; we just read what the app already fetches.
//
// Usage:
//   node read-tomorrow.js            -> tomorrow, big = 8+ seats
//   node read-tomorrow.js 6          -> tomorrow, big = 6+ seats
//   node read-tomorrow.js 8 today    -> today,    big = 8+ seats
//   node read-tomorrow.js 8 2026-09-05 -> that date

const { chromium } = require('playwright');
const path = require('path');

const PROFILE_DIR = path.join(__dirname, 'tabit-profile');
const APP_URL = 'https://tgm-app.tabit.cloud/';
const TZ = 'Asia/Jerusalem';

const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});
const timeFmt = new Intl.DateTimeFormat('he-IL', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit',
});

function targetDateStr(which) {
  if (which && /^\d{4}-\d{2}-\d{2}$/.test(which)) return which;
  const now = new Date();
  const offsetDays = which === 'today' ? 0 : 1;
  return dayFmt.format(new Date(now.getTime() + offsetDays * 86400000));
}

function depositStatus(r) {
  if (r.deposit_removed) return 'ללא פיקדון';
  const st = r.cc_deposit_state && r.cc_deposit_state.state;
  const dead = ['refunded', 'canceled', 'cancelled', 'voided', 'removed', 'expired'];
  const secured = !!r.cc_deposit && !(st && dead.includes(st));
  if (secured) return 'מובטח ✓';
  const required = !!(r.links && r.links.deposit);
  return required ? 'חסר פיקדון ✗' : 'ללא פיקדון';
}

function waitForJson(page, matcher, timeoutMs = 45000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    page.on('response', async (resp) => {
      try {
        if (!matcher(resp.url())) return;
        if (resp.status() !== 200) return;
        const j = await resp.json().catch(() => null);
        if (j) done(j);
      } catch (_) {}
    });
    setTimeout(() => done(null), timeoutMs);
  });
}

(async () => {
  const bigThreshold = parseInt(process.argv[2], 10) || 8;
  const dateStr = targetDateStr(process.argv[3]);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    viewport: { width: 1280, height: 800 },
  });
  const page = context.pages()[0] || (await context.newPage());

  const reservationsP = waitForJson(page, (u) => /\/reservations(\?|$)/.test(u));
  const tablesP = waitForJson(page, (u) => /\/tables(\?|$)/.test(u));

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const reservations = (await reservationsP) || [];
  const tables = (await tablesP) || [];

  if (!reservations.length) {
    console.error('לא הצלחתי לקרוא הזמנות (ייתכן שה-session פג - צריך להריץ שוב login.js).');
    await context.close();
    process.exit(1);
  }

  const tableNum = new Map(tables.map((t) => [t._id, t.number]));

  const all = reservations
    .map((r) => {
      const d = r.reservation_details || {};
      return {
        name: (d.customer && d.customer.name) || '(ללא שם)',
        phone: (d.customer && d.customer.phone) || '',
        seats: d.seats_count || 0,
        from: d.reserved_from,
        day: d.reserved_from ? dayFmt.format(new Date(d.reserved_from)) : null,
        tables: (d.reserved_tables_ids || []).map((id) => tableNum.get(id)).filter(Boolean),
        state: r.state,
        type: r.type,
        deposit: depositStatus(r),
      };
    })
    .filter((r) => r.state !== 'cancelled' && r.type !== 'walked_in');

  // Coverage debug: which days does the app's default load actually contain?
  const dayCounts = {};
  for (const r of all) if (r.day) dayCounts[r.day] = (dayCounts[r.day] || 0) + 1;
  const coveredDays = Object.keys(dayCounts).sort();
  console.log('טווח תאריכים בנתונים שנטענו:', coveredDays.join(', ') || '(אין)');

  const rows = all
    .filter((r) => r.day === dateStr)
    .sort((a, b) => b.seats - a.seats);
  const big = rows.filter((r) => r.seats >= bigThreshold);

  console.log(`\n📅 הזמנות לתאריך ${dateStr}  |  "גדול" = ${bigThreshold}+ סועדים`);
  console.log(`סה"כ הזמנות ביום: ${rows.length}  |  מתוכן גדולות: ${big.length}\n`);
  console.log(`שולחנות גדולים (${bigThreshold}+):`);
  console.log('─'.repeat(66));
  if (big.length === 0) {
    console.log(dateStr < (coveredDays[0] || '') || dateStr > (coveredDays[coveredDays.length - 1] || '')
      ? '  התאריך הזה מחוץ לטווח שנטען. צריך גרסה שמנווטת לתאריך (שלב הבא).'
      : '  אין שולחנות גדולים ליום הזה.');
  } else {
    for (const r of big) {
      const time = timeFmt.format(new Date(r.from));
      const tbl = r.tables.length ? `ש' ${r.tables.join(',')}` : 'ללא שולחן';
      console.log(`  ${time}  |  ${String(r.seats).padStart(2)} סועדים  |  ${r.name}  |  ${tbl}  |  פיקדון: ${r.deposit}`);
    }
  }
  console.log('─'.repeat(66));

  await context.close();
  process.exit(0);
})();
