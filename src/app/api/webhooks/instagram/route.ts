import { NextRequest } from "next/server";
import { handleVerify, handleReceive } from "@/lib/meta-webhook";
import { instagramAdapter } from "@/lib/channels/meta-messaging";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function GET(req: NextRequest) {
  return handleVerify(req, process.env.INSTAGRAM_VERIFY_TOKEN ?? "");
}

export async function POST(req: NextRequest) {
  return handleReceive(req, "instagram", instagramAdapter);
}
