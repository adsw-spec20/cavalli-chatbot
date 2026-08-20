import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { isMasterAuthorized } from "@/lib/admin-auth";
import { hashCode, loadTeam, saveTeam, toPublic } from "@/lib/team";

export const runtime = "nodejs";

// ניהול צוות - טוקן המנהל הראשי בלבד (הוספה/הסרה של אנשי צוות והקודים שלהם)

const unauthorized = () => NextResponse.json({ error: "unauthorized" }, { status: 401 });

export async function GET(req: NextRequest) {
  if (!isMasterAuthorized(req)) return unauthorized();
  const members = await loadTeam();
  return NextResponse.json(members.map(toPublic));
}

/** הוספת איש צוות: { name, code }. סיסמה: 6-40 תווים, מותר אותיות/ספרות/סימנים. */
export async function POST(req: NextRequest) {
  if (!isMasterAuthorized(req)) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";

  if (name.length < 2 || name.length > 30) {
    return NextResponse.json({ error: "שם חייב להיות באורך 2-30 תווים" }, { status: 400 });
  }
  if (code.length < 6 || code.length > 40) {
    return NextResponse.json(
      { error: "הסיסמה חייבת להיות באורך 6-40 תווים (מומלץ לשלב אותיות וסימנים)" },
      { status: 400 }
    );
  }

  const members = await loadTeam();
  if (members.some((m) => m.name.trim().toLowerCase() === name.toLowerCase())) {
    return NextResponse.json({ error: "כבר קיים איש צוות בשם הזה" }, { status: 409 });
  }
  if (members.length >= 30) {
    return NextResponse.json({ error: "הגעתם למקסימום אנשי צוות" }, { status: 400 });
  }

  const id = randomUUID();
  members.push({ id, name, codeHash: hashCode(id, code), createdAt: Date.now() });
  await saveTeam(members);
  return NextResponse.json(members.map(toPublic));
}

/** הסרת איש צוות (?id=) - מבטלת מיידית גם את הטוקן שלו. */
export async function DELETE(req: NextRequest) {
  if (!isMasterAuthorized(req)) return unauthorized();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const members = await loadTeam();
  const next = members.filter((m) => m.id !== id);
  if (next.length === members.length) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  await saveTeam(next);
  return NextResponse.json(next.map(toPublic));
}
