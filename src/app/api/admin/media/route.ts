import { NextRequest, NextResponse, after } from "next/server";
import { getMediaLibrary, setMediaLibrary } from "@/lib/admin-service";
import { prewarmMediaAttachments } from "@/lib/channels/meta-messaging";
import { isAdminAuthorized } from "@/lib/admin-auth";
import type { MediaItem } from "@/lib/media-store";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await getMediaLibrary());
}

export async function PUT(req: NextRequest) {
  if (!(await isAdminAuthorized(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json()) as MediaItem[];
  if (!Array.isArray(body)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const clean = body
    .filter((m) => m && typeof m.url === "string" && m.url.trim())
    .map((m) => ({
      id: String(m.id || Math.random().toString(36).slice(2)),
      label: String(m.label ?? "").slice(0, 60),
      keywords: String(m.keywords ?? "").slice(0, 120),
      url: String(m.url),
      type: m.type === "video" ? ("video" as const) : ("image" as const),
    }));
  await setMediaLibrary(clean);
  // חימום מראש (ברקע) - רושם את המדיה אצל מטא כדי שהשליחה ללקוח תהיה מיידית
  after(() =>
    prewarmMediaAttachments(clean.filter((m) => m.url).map((m) => ({ url: m.url, type: m.type })))
  );
  return NextResponse.json({ ok: true });
}
