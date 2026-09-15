/**
 * ביקורת כיסוי התבניות החינמיות מול שיחות אמת.
 * קורא קובץ שיחות (עם meta) ומריץ את matchQuickAnswers האמיתי על כל תור לקוח,
 * כדי לראות בדיוק אילו שאלות היו נענות בחינם ואילו הולכות למודל.
 * לא שולח שום דבר למודל - עלות אפס.
 *   npx tsx scripts/canned-audit.mts <convs.json>
 */
import { readFileSync } from "fs";
import { matchQuickAnswers } from "../src/lib/conversation-service";

interface Msg { role: string; content: string; ts: number; meta?: Record<string, unknown> }
const convs: { id: string; channel: string; messages: Msg[] }[] = JSON.parse(
  readFileSync(process.argv[2], "utf8")
);

// שחזור אותה מיזוג שהשרת עושה: הודעות לקוח רצופות = תור אחד
const mergeUser = (msgs: Msg[]): { turn: string; answeredBy: string }[] => {
  const out: { turn: string; answeredBy: string }[] = [];
  let buf: string[] = [];
  for (const m of msgs) {
    if (m.role === "user") { buf.push(m.content); continue; }
    if (m.role === "assistant" && buf.length) {
      const meta = m.meta ?? {};
      out.push({
        turn: buf.join("\n"),
        answeredBy: meta.canned ? `canned:${meta.canned}` : meta.gateReply ? "gate" : "model",
      });
      buf = [];
    } else if (m.role === "assistant") buf = [];
  }
  return out;
};

let free = 0, paid = 0;
const missed = new Map<string, { n: number; ex: string }>();
const wouldCatch = new Map<string, number>();
for (const c of convs) {
  for (const { turn, answeredBy } of mergeUser(c.messages)) {
    const keys = matchQuickAnswers(turn);
    if (answeredBy === "model") {
      paid++;
      if (keys.length) {
        // התבנית *כן* מתאימה, אבל בפועל הלך למודל -> בעיה בזרימה, לא בכיסוי
        wouldCatch.set(keys.join("+"), (wouldCatch.get(keys.join("+")) ?? 0) + 1);
      } else {
        const k = turn.replace(/\s+/g, " ").trim().slice(0, 55).toLowerCase();
        const prev = missed.get(k);
        missed.set(k, { n: (prev?.n ?? 0) + 1, ex: prev?.ex ?? turn.replace(/\n/g, " | ") });
      }
    } else free++;
  }
}
console.log(`תורים שנענו בחינם: ${free}`);
console.log(`תורים שהלכו למודל: ${paid}`);
console.log(`\n===== הלכו למודל למרות שתבנית קיימת מתאימה (באג זרימה) =====`);
let flow = 0;
for (const [k, n] of [...wouldCatch].sort((a, b) => b[1] - a[1])) { console.log(`${String(n).padStart(4)}x  ${k}`); flow += n; }
console.log(`סה"כ: ${flow} תורים (${((flow / paid) * 100).toFixed(0)}% מהתורים בתשלום)`);
console.log(`\n===== לא מכוסים בתבנית (מועמדים להרחבה) =====`);
for (const [, v] of [...missed].sort((a, b) => b[1].n - a[1].n).slice(0, 30)) {
  console.log(`${String(v.n).padStart(4)}x  ${v.ex.slice(0, 80)}`);
}
