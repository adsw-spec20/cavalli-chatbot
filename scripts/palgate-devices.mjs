/**
 * מציג את רשימת השערים של חשבון ה-PalGate שלך, כדי לבחור את PALGATE_DEVICE_ID.
 *
 * הרצה (אחרי שמילאת PALGATE_SESSION_TOKEN / PALGATE_PHONE / PALGATE_TOKEN_TYPE
 * ב-.env.local):   node scripts/palgate-devices.mjs
 *
 * הסקריפט קורא את .env.local מקומית בלבד ופונה רק לענן של PalGate.
 */

import { createCipheriv, createDecipheriv } from "node:crypto";
import { readFileSync } from "node:fs";

// --- טעינת .env.local (פרסור פשוט; מקומי בלבד) ---
try {
  const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of raw.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  /* אין .env.local - נסתמך על משתני סביבה שהוזנו בשורת הפקודה */
}

const BASE_URL = process.env.PALGATE_API_BASE_URL || "https://api1.pal-es.com/v1/bt/";
const T_C_KEY = Buffer.from("fad3257281290000000000003ab45a65", "hex");

function packU64BE(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
}
function generateToken(sessionHex, phone, type) {
  const sessionToken = Buffer.from(sessionHex, "hex");
  if (sessionToken.length !== 16) throw new Error("PALGATE_SESSION_TOKEN חייב להיות 32 תווי hex");
  const phoneBytes = packU64BE(phone);
  const key = Buffer.from(T_C_KEY);
  phoneBytes.copy(key, 6, 2, 8);
  const d = createDecipheriv("aes-128-ecb", key, null); // שלב 1: decrypt
  d.setAutoPadding(false);
  const step1 = Buffer.concat([d.update(sessionToken), d.final()]);
  const ns = Buffer.alloc(16);
  ns.writeUInt16LE(0x0a0a, 1);
  ns.writeUInt32BE((Math.floor(Date.now() / 1000) + 2) >>> 0, 10);
  const c = createCipheriv("aes-128-ecb", step1, null); // שלב 2: encrypt
  c.setAutoPadding(false);
  const step2 = Buffer.concat([c.update(ns), c.final()]);
  const out = Buffer.alloc(23);
  out[0] = type === 0 ? 0x01 : type === 1 ? 0x11 : 0x21;
  phoneBytes.copy(out, 1, 2, 8);
  step2.copy(out, 7);
  return out.toString("hex").toUpperCase();
}

const sessionHex = process.env.PALGATE_SESSION_TOKEN;
const phone = Number(process.env.PALGATE_PHONE);
const type = Number(process.env.PALGATE_TOKEN_TYPE);
if (!sessionHex || !phone || Number.isNaN(type)) {
  console.error(
    "❌ חסרים ערכים. ודא ש-PALGATE_SESSION_TOKEN, PALGATE_PHONE ו-PALGATE_TOKEN_TYPE מוגדרים ב-.env.local (מהרצת palgate-link.mjs)."
  );
  process.exit(1);
}

const res = await fetch(`${BASE_URL}devices/`, {
  headers: {
    "x-bt-token": generateToken(sessionHex, phone, type),
    Accept: "*/*",
    "Accept-Language": "en-us",
    "Content-Type": "application/json",
    "User-Agent": "okhttp/4.9.3",
  },
});
if (!res.ok) {
  console.error(`❌ PalGate החזיר HTTP ${res.status}. ${(await res.text()).slice(0, 200)}`);
  process.exit(1);
}
const data = await res.json();
const devices = Array.isArray(data) ? data : data.devices || [];
if (!devices.length) {
  console.error("❌ לא נמצאו שערים בחשבון. ודא שהחשבון מורשה לשער.");
  process.exit(1);
}
console.log("\n🚪 השערים בחשבון שלך:\n");
for (const d of devices) {
  const id = d.id || d._id || d.deviceId || d.serialNumber || "(לא ידוע)";
  const name = d.name || d.description || d.label || "(ללא שם)";
  console.log(`  PALGATE_DEVICE_ID=${id}   # ${name}`);
}
console.log("\nהעתק את המזהה של שער החניה הרצוי אל PALGATE_DEVICE_ID (ב-.env.local וב-Vercel).\n");
