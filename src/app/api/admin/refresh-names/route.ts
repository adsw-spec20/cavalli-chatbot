import { NextRequest, NextResponse } from "next/server";
import { isMasterAuthorized } from "@/lib/admin-auth";
import { getRepo } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * ריענון שמות לקוחות אנונימיים (מנהל בלבד).
 * עובר על כל הלקוחות ללא שם במסנג'ר/אינסטגרם, מנסה לשלוף את השם מ-Graph,
 * מעדכן את מי שאפשר - ומחזיר את התשובה הגולמית של מטא למי שלא (אבחון).
 */
export async function POST(req: NextRequest) {
  if (!isMasterAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const repo = getRepo();
  const summaries = await repo.getConversationSummaries();
  const seen = new Set<string>();
  const targets: { customerId: string; channel: string; userId: string }[] = [];
  for (const s of summaries) {
    const c = s.conversation;
    if (s.customerName || seen.has(c.customerId)) continue;
    if (c.channel !== "messenger" && c.channel !== "instagram") continue;
    seen.add(c.customerId);
    targets.push({
      customerId: c.customerId,
      channel: c.channel,
      userId: c.customerId.split(":")[1] ?? "",
    });
  }

  const tokens: Record<string, string | undefined> = {
    messenger: process.env.MESSENGER_PAGE_ACCESS_TOKEN,
    instagram: process.env.INSTAGRAM_PAGE_ACCESS_TOKEN,
  };
  const fieldsByChannel: Record<string, string> = {
    messenger: "first_name,last_name",
    instagram: "name,username",
  };

  const results: {
    customerId: string;
    channel: string;
    resolved?: string;
    graphStatus?: number;
    graphBody?: string;
  }[] = [];

  for (const t of targets.slice(0, 25)) {
    const token = tokens[t.channel];
    if (!token) {
      results.push({ ...t, graphBody: "אין טוקן לערוץ" });
      continue;
    }
    try {
      const res = await fetch(
        `${GRAPH}/${t.userId}?fields=${fieldsByChannel[t.channel]}&access_token=${token}`
      );
      const body = await res.text();
      let resolved: string | undefined;
      if (res.ok) {
        const d = JSON.parse(body) as {
          name?: string;
          username?: string;
          first_name?: string;
          last_name?: string;
        };
        const full = [d.first_name, d.last_name].filter(Boolean).join(" ");
        resolved = d.name || full || d.username || undefined;
        if (resolved) {
          await repo.updateCustomer(t.customerId, { name: resolved });
        }
      }
      results.push({
        customerId: t.customerId,
        channel: t.channel,
        resolved,
        graphStatus: res.status,
        // מחזירים את גוף התשובה רק כשנכשל (לאבחון) - בלי להדליף מידע מיותר
        graphBody: resolved ? undefined : body.slice(0, 400),
      });
    } catch (err) {
      results.push({
        customerId: t.customerId,
        channel: t.channel,
        graphBody: `fetch failed: ${err instanceof Error ? err.message : "?"}`,
      });
    }
  }

  return NextResponse.json({
    checked: results.length,
    updated: results.filter((r) => r.resolved).length,
    results,
  });
}
