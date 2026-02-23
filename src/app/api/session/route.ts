import { NextRequest, NextResponse } from "next/server";
import { encrypt } from "@/lib/crypto";
import { getSession, SessionData } from "@/lib/session";

const COOKIE_NAME = "sec_session";
const COOKIE_MAX_AGE = 3600;

// POST /api/session — create session
export async function POST(req: NextRequest) {
  const { graphToken, tenantId, subscriptionId } = await req.json();

  if (!graphToken || !tenantId) {
    return NextResponse.json({ error: "graphToken and tenantId required" }, { status: 400 });
  }

  const sessionData: SessionData = { graphToken, tenantId, subscriptionId };
  const encrypted = encrypt(JSON.stringify(sessionData));

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, encrypted, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });

  return response;
}

// GET /api/session — check session (no token exposed)
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ authenticated: false });
  return NextResponse.json({
    authenticated: true,
    tenantId: session.tenantId,
    subscriptionId: session.subscriptionId,
  });
}

// DELETE /api/session — logout
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(COOKIE_NAME);
  return response;
}
