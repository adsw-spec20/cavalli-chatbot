/**
 * בדיקות שכבת השירות והנתונים של פאנל הניהול (בלי רשת, בלי API של מודל).
 * הרצה: npx tsx scripts/test-admin.ts
 *
 * רץ מול FileRepository בתיקייה זמנית - לא נוגע בנתוני הפיתוח או בפרודקשן.
 */

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// חייב לרוץ לפני import של file-repo (הנתיב נקבע בזמן טעינת המודול)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cavalli-admin-test-"));
process.chdir(tmp);

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : err}`);
  }
}

const { FileRepository } = await import("../src/lib/db/file-repo");
const { safeTokenEqual } = await import("../src/lib/admin-auth");
const { verifyMetaSignature } = await import("../src/lib/meta-signature");
const { isSafeMediaUrl } = await import("../src/lib/transcription");
const { isMediaRelevant } = await import("../src/lib/media-store");
const crypto = await import("node:crypto");

console.log("\n== Repository: שיחות וסיכומים ==");
const repo = new FileRepository();

await test("יצירת לקוח ושיחה", async () => {
  await repo.upsertCustomer({
    id: "whatsapp:972501234567",
    channel: "whatsapp",
    channelUserId: "972501234567",
    name: "דנה כהן",
  });
  await repo.createConversation({
    id: "conv-1",
    channel: "whatsapp",
    customerId: "whatsapp:972501234567",
    status: "bot",
  });
  const conv = await repo.getConversation("conv-1");
  assert.ok(conv, "השיחה נשמרה");
  assert.equal(conv!.status, "bot");
});

await test("סיכומי שיחות: הודעה אחרונה, ספירה, awaiting", async () => {
  await repo.addMessage({ conversationId: "conv-1", role: "user", content: "יש חניה?", ts: Date.now() - 3000 });
  await repo.addMessage({ conversationId: "conv-1", role: "assistant", content: "כן, יש חניון צמוד.", ts: Date.now() - 2000 });
  await repo.addMessage({ conversationId: "conv-1", role: "user", content: "ומה המחיר?", ts: Date.now() - 1000 });
  const summaries = await repo.getConversationSummaries();
  assert.equal(summaries.length, 1);
  const s = summaries[0];
  assert.equal(s.messageCount, 3);
  assert.equal(s.lastMessage, "ומה המחיר?");
  assert.equal(s.lastMessageRole, "user", "ההודעה האחרונה של הלקוח => ממתינה");
  assert.equal(s.customerName, "דנה כהן", "שם הלקוח מצורף לסיכום");
  assert.ok(s.lastUserTs, "יש חותמת זמן ללקוח");
});

await test("הודעות system לא נחשבות כהודעה אחרונה", async () => {
  await repo.addMessage({ conversationId: "conv-1", role: "system", content: "נציג השתלט", ts: Date.now(), meta: { activity: true } });
  const [s] = await repo.getConversationSummaries();
  assert.equal(s.lastMessage, "ומה המחיר?", "system לא דורס את התצוגה");
});

console.log("\n== Repository: ידע נלמד (CRUD מלא) ==");

await test("שאלה פתוחה -> מענה -> answered", async () => {
  const qa = await repo.addOpenQuestion({ question: "יש עוגות בלי גלוטן?" });
  assert.equal(qa.status, "open");
  const answered = await repo.answerLearnedQA(qa.id, "כן, יש מבחר ללא גלוטן.");
  assert.equal(answered!.status, "answered");
  assert.ok(answered!.answeredAt);
});

await test("עריכת שאלה ותשובה קיימות (updateLearnedQA)", async () => {
  const [qa] = await repo.listLearnedQA("answered");
  const updated = await repo.updateLearnedQA(qa.id, {
    question: "יש קינוחים ללא גלוטן?",
    answer: "כן, יש עוגת שוקולד וגלידות ללא גלוטן.",
  });
  assert.equal(updated!.question, "יש קינוחים ללא גלוטן?");
  assert.equal(updated!.answer, "כן, יש עוגת שוקולד וגלידות ללא גלוטן.");
  assert.ok(updated!.updatedAt, "נשמרה חותמת עדכון");
  // הבוט שולף את הידע דרך listLearnedQA("answered") - נוודא שהעדכון שם
  const answered = await repo.listLearnedQA("answered");
  assert.equal(answered[0].answer, "כן, יש עוגת שוקולד וגלידות ללא גלוטן.");
});

await test("עריכה עם תשובה על שאלה פתוחה הופכת אותה ל-answered", async () => {
  const qa = await repo.addOpenQuestion({ question: "עד איזו שעה מגישים בוקר?" });
  const updated = await repo.updateLearnedQA(qa.id, { answer: "עד 13:00 בכל יום." });
  assert.equal(updated!.status, "answered");
});

await test("עריכה חלקית לא דורסת שדות אחרים", async () => {
  const [qa] = await repo.listLearnedQA("answered");
  const before = qa.answer;
  const updated = await repo.updateLearnedQA(qa.id, { question: "ניסוח חדש?" });
  assert.equal(updated!.answer, before, "התשובה לא נמחקה בעריכת שאלה בלבד");
});

await test("מחיקת ידע", async () => {
  const all = await repo.listLearnedQA();
  await repo.deleteLearnedQA(all[0].id);
  const after = await repo.listLearnedQA();
  assert.equal(after.length, all.length - 1);
});

await test("updateLearnedQA על מזהה לא קיים מחזיר null", async () => {
  assert.equal(await repo.updateLearnedQA("no-such-id", { answer: "x" }), null);
});

console.log("\n== אבטחה ==");

await test("safeTokenEqual: השוואה נכונה", () => {
  assert.equal(safeTokenEqual("secret-token", "secret-token"), true);
  assert.equal(safeTokenEqual("secret-token", "wrong-token!"), false);
  assert.equal(safeTokenEqual("secret-token", ""), false);
  assert.equal(safeTokenEqual("secret-token", "secret-token-longer"), false);
});

await test("verifyMetaSignature: חתימה תקינה עוברת, מזויפת נדחית", () => {
  process.env.META_APP_SECRET = "test-secret";
  const body = JSON.stringify({ hello: "world" });
  const sig = "sha256=" + crypto.createHmac("sha256", "test-secret").update(body, "utf8").digest("hex");
  assert.equal(verifyMetaSignature(body, sig), true);
  assert.equal(verifyMetaSignature(body, "sha256=deadbeef"), false);
  assert.equal(verifyMetaSignature(body, null), false);
  delete process.env.META_APP_SECRET;
});

await test("verifyMetaSignature: בלי secret - עובר בפיתוח, נחסם בפרודקשן", () => {
  delete process.env.META_APP_SECRET;
  const env = process.env as Record<string, string | undefined>;
  const prevEnv = env.NODE_ENV;
  const prevVercel = env.VERCEL_ENV;
  delete env.VERCEL_ENV;
  env.NODE_ENV = "development";
  assert.equal(verifyMetaSignature("{}", null), true, "פיתוח: פתוח");
  env.NODE_ENV = "production";
  assert.equal(verifyMetaSignature("{}", null), false, "פרודקשן: fail closed");
  env.NODE_ENV = prevEnv;
  if (prevVercel) env.VERCEL_ENV = prevVercel;
});

await test("isSafeMediaUrl: חוסם כתובות פנימיות ו-http", () => {
  assert.equal(isSafeMediaUrl("https://lookaside.fbsbx.com/audio.mp4"), true);
  assert.equal(isSafeMediaUrl("http://example.com/a.mp3"), false, "http לא מאובטח");
  assert.equal(isSafeMediaUrl("https://localhost/a.mp3"), false);
  assert.equal(isSafeMediaUrl("https://169.254.169.254/latest/meta-data"), false, "cloud metadata");
  assert.equal(isSafeMediaUrl("https://10.0.0.5/x"), false);
  assert.equal(isSafeMediaUrl("not-a-url"), false);
});

console.log("\n== לוגיקת מדיה ==");

await test("isMediaRelevant: התאמת מילות מפתח", () => {
  const item = { id: "1", label: "סרטון חניה", keywords: "חניה, איך מגיעים", url: "https://x", type: "video" as const };
  assert.equal(isMediaRelevant(item, "איפה אפשר לחנות? יש חנייה?"), true);
  assert.equal(isMediaRelevant(item, "כמה עולה קפוצ'ינו?"), false);
});

console.log(`\n${passed} עברו, ${failed} נכשלו`);
process.chdir(os.tmpdir()); // לצאת מהתיקייה לפני מחיקתה (Windows)
try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch {
  /* תיקייה זמנית - מערכת ההפעלה תנקה */
}
process.exit(failed ? 1 : 0);
