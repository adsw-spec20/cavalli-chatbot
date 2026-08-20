import { NextRequest, NextResponse } from "next/server";
import { getTemplates, setTemplates, type QuickReply } from "@/lib/admin-service";
import { isAdminAuthorized } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await getTemplates());
}

export async function PUT(req: NextRequest) {
  if (!(await isAdminAuthorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json()) as QuickReply[];
  if (!Array.isArray(body)) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const clean = body
    .filter((t) => t && typeof t.text === "string" && t.text.trim())
    .map((t) => ({ title: String(t.title ?? "").slice(0, 40), text: String(t.text) }));
  await setTemplates(clean);
  return NextResponse.json({ ok: true });
}
