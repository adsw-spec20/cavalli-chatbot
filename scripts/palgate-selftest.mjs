/**
 * בדיקה עצמית לאלגוריתם ה-token של PalGate מול וקטורי בדיקה ידועים.
 * מוודא שהמימוש (crypto מובנה) תואם בדיוק למימוש המקורי (homebridge-palgate, MIT).
 *
 * הרצה:  node scripts/palgate-selftest.mjs
 * לא פונה לרשת ולא נוגע בשער - חישוב מקומי בלבד.
 */

import { createCipheriv, createDecipheriv } from "node:crypto";

const T_C_KEY = Buffer.from("fad3257281290000000000003ab45a65", "hex");

function packU64BE(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
}
function generateToken(sessionHex, phone, type, unixSeconds) {
  const sessionToken = Buffer.from(sessionHex, "hex");
  const phoneBytes = packU64BE(phone);
  const key = Buffer.from(T_C_KEY);
  phoneBytes.copy(key, 6, 2, 8);
  const d = createDecipheriv("aes-128-ecb", key, null); // שלב 1: decrypt
  d.setAutoPadding(false);
  const step1 = Buffer.concat([d.update(sessionToken), d.final()]);
  const ns = Buffer.alloc(16);
  ns.writeUInt16LE(0x0a0a, 1);
  ns.writeUInt32BE((unixSeconds + 2) >>> 0, 10);
  const c = createCipheriv("aes-128-ecb", step1, null); // שלב 2: encrypt
  c.setAutoPadding(false);
  const step2 = Buffer.concat([c.update(ns), c.final()]);
  const out = Buffer.alloc(23);
  out[0] = type === 0 ? 0x01 : type === 1 ? 0x11 : 0x21;
  phoneBytes.copy(out, 1, 2, 8);
  step2.copy(out, 7);
  return out.toString("hex").toUpperCase();
}

const SESSION = "000102030405060708090a0b0c0d0e0f";
const PHONE = 972500000000;
const TS = 1700000000;
const VECTORS = [
  { type: 0, expected: "0100E26D845D009D5046C334E5D64A4B21D74F0DE80208" },
  { type: 1, expected: "1100E26D845D009D5046C334E5D64A4B21D74F0DE80208" },
  { type: 2, expected: "2100E26D845D009D5046C334E5D64A4B21D74F0DE80208" },
];

let ok = true;
for (const v of VECTORS) {
  const got = generateToken(SESSION, PHONE, v.type, TS);
  const pass = got === v.expected;
  ok = ok && pass;
  console.log(`${pass ? "✅" : "❌"} type=${v.type}  ${got}${pass ? "" : `\n   expected: ${v.expected}`}`);
}
console.log(ok ? "\n✅ כל הווקטורים תואמים - האלגוריתם תקין.\n" : "\n❌ אי-התאמה - אל תשתמש בזה.\n");
process.exit(ok ? 0 : 1);
