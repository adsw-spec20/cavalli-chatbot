import { NextRequest } from "next/server";
import { handleVerify, handleReceive } from "@/lib/meta-webhook";
import { messengerAdapter } from "@/lib/channels/meta-messaging";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  return handleVerify(req, process.env.MESSENGER_VERIFY_TOKEN ?? "");
}

export async function POST(req: NextRequest) {
  return handleReceive(req, "messenger", messengerAdapter);
}
