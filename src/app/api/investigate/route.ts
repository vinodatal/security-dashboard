import { NextRequest, NextResponse } from "next/server";
import { investigate } from "@/lib/agent/investigator";
import { getSession } from "@/lib/session";

export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { finding } = await req.json();
  if (!finding?.type || !finding?.detail) {
    return NextResponse.json({ error: "finding with type and detail required" }, { status: 400 });
  }

  try {
    const result = await investigate(
      session.tenantId,
      finding,
      session.graphToken
    );
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
