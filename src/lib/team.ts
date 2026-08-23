/**
 * ניהול צוות + כניסה קלה לפאנל.
 *
 * במקום שכל הצוות יחזיק את טוקן המנהל הארוך, כל איש צוות מקבל שם + קוד אישי
 * קצר (4-8 ספרות). בכניסה מוצלחת נוצר "טוקן צוות" חתום שנשמר בדפדפן.
 *
 * אבטחה:
 * - הקוד לא נשמר כמות שהוא אלא כ-hash (עם מלח שכולל את מזהה האיש + הסוד).
 * - טוקן הצוות הוא חתימה על (מזהה + hash הקוד): מחיקת האיש או החלפת הקוד
 *   מבטלת מיידית את כל הטוקנים שלו - בלי לנהל רשימת sessions.
 * - טוקן המנהל (ADMIN_TOKEN) נשאר "מפתח ראשי" עם הרשאות מלאות (עלויות, ניהול צוות).
 */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { getRepo } from "./db";

/** השוואה בזמן קבוע (מקומי - כדי להימנע מייבוא מעגלי מ-admin-auth) */
function safeTokenEqual(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const KEY = "team_members";
const TOKEN_PREFIX = "tm.";

export interface TeamMember {
  id: string;
  name: string;
  /** hash של הקוד האישי (לא הקוד עצמו) */
  codeHash: string;
  createdAt: number;
  lastLoginAt?: number;
}

/** מה שמותר להחזיר לפאנל (בלי ה-hash) */
export interface TeamMemberPublic {
  id: string;
  name: string;
  createdAt: number;
  lastLoginAt?: number;
}

const secret = () => process.env.ADMIN_TOKEN || "dev-secret";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * הצפנת סיסמה: scrypt עם מלח אקראי לכל משתמש + "פלפל" (ADMIN_TOKEN מהסביבה).
 * פורמט אחסון: "s2$<מלח>$<hash>".
 *
 * למה scrypt ולא sha256 (הפורמט הישן): sha256 מהיר - תוקף שהשיג את ה-DB
 * יכול לנסות מיליארדי ניחושים בשנייה. scrypt דורש הרבה זיכרון וזמן לכל
 * ניסיון, מה שהופך פיצוח לבלתי מעשי. הפלפל מוסיף שכבה: גם דליפת DB מלאה
 * לא מספיקה לפיצוח בלי משתנה הסביבה. סיסמאות ישנות משודרגות אוטומטית
 * בכניסה מוצלחת הבאה.
 */
export const hashCode = (memberId: string, code: string): string => {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(code, `${salt}:${memberId}:${secret()}`, 32).toString("hex");
  return `s2$${salt}$${hash}`;
};

/** אימות סיסמה מול hash שמור - תומך גם בפורמט הישן (sha256) לצורך מעבר חלק. */
function verifyCode(member: TeamMember, code: string): { ok: boolean; legacy: boolean } {
  if (member.codeHash.startsWith("s2$")) {
    const [, salt, stored] = member.codeHash.split("$");
    if (!salt || !stored) return { ok: false, legacy: false };
    const computed = scryptSync(code, `${salt}:${member.id}:${secret()}`, 32).toString("hex");
    return { ok: safeTokenEqual(stored, computed), legacy: false };
  }
  // פורמט ישן: sha256(id:code:secret)
  const legacyHash = sha256(`${member.id}:${code}:${secret()}`);
  return { ok: safeTokenEqual(member.codeHash, legacyHash), legacy: true };
}

const signToken = (memberId: string, codeHash: string) =>
  sha256(`${memberId}.${codeHash}.${secret()}`);

// ביצועים: אימות טוקן צוות רץ על כל בקשת פאנל (כולל הסקר של כל 4 שניות),
// וכל אימות משך את רשימת הצוות מה-DB - נסיעת רשת שלמה רק בשביל להיכנס.
// מטמון קצר בזיכרון חוסך אותה; מחיקת איש צוות נכנסת לתוקף תוך עד 30 שניות
// (ובאותו instance - מיד, כי השמירה מנקה את המטמון).
const TEAM_CACHE_MS = 30_000;
let teamCache: { members: TeamMember[]; ts: number } | null = null;

export async function loadTeam(): Promise<TeamMember[]> {
  if (teamCache && Date.now() - teamCache.ts < TEAM_CACHE_MS) return teamCache.members;
  try {
    const raw = await getRepo().getSetting(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    const members = Array.isArray(arr) ? arr : [];
    teamCache = { members, ts: Date.now() };
    return members;
  } catch {
    return [];
  }
}

export async function saveTeam(members: TeamMember[]): Promise<void> {
  await getRepo().setSetting(KEY, JSON.stringify(members));
  teamCache = { members, ts: Date.now() };
}

export const toPublic = (m: TeamMember): TeamMemberPublic => ({
  id: m.id,
  name: m.name,
  createdAt: m.createdAt,
  lastLoginAt: m.lastLoginAt,
});

// ----- נעילת brute-force (נשמרת ב-DB, עמידה גם מול ריבוי instances/IPs) -----
const LOCK_KEY = "login_failures";
const MAX_FAILS = 8;
const LOCK_MS = 15 * 60 * 1000;

type FailMap = Record<string, { count: number; until: number }>;

async function loadFails(): Promise<FailMap> {
  try {
    const raw = await getRepo().getSetting(LOCK_KEY);
    return raw ? (JSON.parse(raw) as FailMap) : {};
  } catch {
    return {};
  }
}

/**
 * כניסת איש צוות: שם (לא תלוי רישיות/רווחים) + סיסמה.
 * מחזיר טוקן, "locked" אם החשבון נעול זמנית, או null אם הפרטים שגויים.
 * אחרי MAX_FAILS ניסיונות כושלים - נעילה ל-15 דקות (מקשה מאוד על ניחוש סיסמאות).
 */
export async function teamLogin(
  name: string,
  code: string
): Promise<{ token: string; name: string } | "locked" | null> {
  const norm = name.trim().toLowerCase();
  const repo = getRepo();
  const fails = await loadFails();
  const entry = fails[norm];
  if (entry && entry.count >= MAX_FAILS && Date.now() < entry.until) return "locked";

  const members = await loadTeam();
  const member = members.find((m) => m.name.trim().toLowerCase() === norm);
  const verdict = member ? verifyCode(member, code.trim()) : { ok: false, legacy: false };

  if (!member || !verdict.ok) {
    // רישום כישלון (גם על שם שלא קיים - שלא ידלוף אילו שמות קיימים)
    const next = entry && Date.now() < entry.until ? entry.count + 1 : 1;
    fails[norm] = { count: next, until: Date.now() + LOCK_MS };
    // ניקוי רשומות שפג תוקפן כדי שהמפתח לא יתנפח
    for (const k of Object.keys(fails)) {
      if (fails[k].until < Date.now()) delete fails[k];
    }
    await repo.setSetting(LOCK_KEY, JSON.stringify(fails)).catch(() => undefined);
    return null;
  }

  // הצלחה: איפוס כשלונות + עדכון "נראה לאחרונה"
  if (entry) {
    delete fails[norm];
    await repo.setSetting(LOCK_KEY, JSON.stringify(fails)).catch(() => undefined);
  }
  // שדרוג שקוף: hash ישן (sha256) מוחלף ב-scrypt בכניסה מוצלחת.
  // תופעת לוואי מכוונת: טוקנים ישנים של האיש (מכשירים אחרים) נפסלים,
  // כי הטוקן חתום על ה-hash - הם פשוט יתחברו שוב פעם אחת.
  if (verdict.legacy) member.codeHash = hashCode(member.id, code.trim());
  member.lastLoginAt = Date.now();
  await saveTeam(members).catch(() => undefined);
  return {
    token: `${TOKEN_PREFIX}${member.id}.${signToken(member.id, member.codeHash)}`,
    name: member.name,
  };
}

/**
 * אימות טוקן צוות. מחזיר את האיש אם הטוקן תקף, אחרת null.
 * הטוקן נפסל אוטומטית אם האיש הוסר או שהקוד שלו הוחלף.
 */
export async function verifyTeamToken(token: string): Promise<TeamMember | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const rest = token.slice(TOKEN_PREFIX.length);
  const dot = rest.indexOf(".");
  if (dot <= 0) return null;
  const memberId = rest.slice(0, dot);
  const sig = rest.slice(dot + 1);

  const members = await loadTeam();
  const member = members.find((m) => m.id === memberId);
  if (!member) return null;
  return safeTokenEqual(signToken(member.id, member.codeHash), sig) ? member : null;
}
