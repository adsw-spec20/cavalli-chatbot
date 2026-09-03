/**
 * מתזמן ההודעות של קוואלי - רץ על השרת, שעון ישראל אמיתי (TZ בדוקר).
 * קורא את schedule.json ושולח כל הודעה בזמנה לקבוצת הוואטסאפ שלה.
 * GATEWAY=waha (ברירת מחדל, השער העצמאי) או greenapi (מעבר הדרגתי).
 */
import cron from "node-cron";
import { readFileSync } from "fs";

const cfg = JSON.parse(readFileSync(new URL("./schedule.json", import.meta.url), "utf8"));
const GATEWAY = process.env.GATEWAY || "waha";

async function sendWaha(group, text) {
  const res = await fetch(`${process.env.WAHA_URL}/api/sendText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": process.env.WAHA_API_KEY || "",
    },
    body: JSON.stringify({ session: "default", chatId: group, text }),
  });
  if (!res.ok) throw new Error(`waha ${res.status}: ${await res.text()}`);
}

async function sendGreenApi(group, text) {
  const { GREENAPI_INSTANCE: inst, GREENAPI_TOKEN: token } = process.env;
  if (!inst || !token) throw new Error("GREENAPI_INSTANCE/TOKEN חסרים");
  const res = await fetch(
    `https://api.green-api.com/waInstance${inst}/sendMessage/${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId: group, message: text }),
    }
  );
  if (!res.ok) throw new Error(`greenapi ${res.status}: ${await res.text()}`);
}

const send = GATEWAY === "greenapi" ? sendGreenApi : sendWaha;

let scheduled = 0;
for (const m of cfg.messages) {
  if (!m.enabled) {
    console.log(`[skip] "${m.name}" - מכובה (enabled=false)`);
    continue;
  }
  if (m.group.includes("TODO") || m.text.includes("TODO")) {
    console.log(`[skip] "${m.name}" - יש עוד TODO למלא`);
    continue;
  }
  cron.schedule(
    m.cron,
    async () => {
      try {
        await send(m.group, m.text);
        console.log(`[sent] "${m.name}" -> ${m.group}`);
      } catch (err) {
        console.error(`[fail] "${m.name}":`, err.message);
      }
    },
    { timezone: "Asia/Jerusalem" }
  );
  scheduled++;
  console.log(`[armed] "${m.name}" (${m.cron}, IL time)`);
}
console.log(`המתזמן פעיל: ${scheduled} הודעות מתוזמנות, שער: ${GATEWAY}`);
