import { NextRequest, NextResponse } from "next/server";
import { updateCustomerDetails } from "@/lib/admin-service";
import { isAdminAuthorized } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json();
  const patch: {
    name?: string;
    vip?: boolean;
    tags?: string[];
    notes?: string;
    memory?: string;
  } = {};
  if (typeof body.name === "string") patch.name = body.name;
  if (typeof body.vip === "boolean") patch.vip = body.vip;
  if (Array.isArray(body.tags)) patch.tags = body.tags;
  if (typeof body.notes === "string") patch.notes = body.notes;
  if (typeof body.memory === "string") patch.memory = body.memory;
  const updated = await updateCustomerDetails(id, patch);
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(updated);
}
