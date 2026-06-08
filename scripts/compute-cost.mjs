// מחשב עלות מתוך שורות [cost]. הרצה: node scripts/compute-cost.mjs <file>
import fs from "fs";
const lines = fs.readFileSync(process.argv[2], "utf8")
  .split("\n")
  .filter((l) => l.includes("[cost]"));
let In = 0, cr = 0, cw = 0, out = 0;
for (const l of lines) {
  const m = l.match(/in=(\d+) cache_read=(\d+) cache_write=(\d+) out=(\d+)/);
  if (m) { In += +m[1]; cr += +m[2]; cw += +m[3]; out += +m[4]; }
}
// תמחור משוער (לכל מיליון טוקנים)
const SON = { in: 3, out: 15, cw: 3.75, cr: 0.30 };
const HAI = { in: 1, out: 5, cw: 1.25, cr: 0.10 };
const calc = (p) => (In * p.in + cr * p.cr + cw * p.cw + out * p.out) / 1e6;
const usd = calc(SON);
const usdH = calc(HAI);
const ils = (n) => "₪" + (n * 3.7).toFixed(3);
console.log(`קריאות למודל: ${lines.length}`);
console.log(`טוקנים: input=${In}  cache_read=${cr}  cache_write=${cw}  output=${out}`);
console.log(`\nעלות השיחה (Sonnet): $${usd.toFixed(4)}  (${ils(usd)})`);
console.log(`עלות אותה שיחה (Haiku משוער): $${usdH.toFixed(4)}  (${ils(usdH)})`);
