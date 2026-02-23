import { NextRequest, NextResponse } from "next/server";
import { encrypt, decrypt } from "@/lib/crypto";

const COOKIE_NAME = "sec_session";
const COOKIE_MAX_AGE = 3600; // 1 hour (matches Azure token lifetime)

export interface SessionData {
  graphToken: string;
  tenantId: string;
  subscriptionId?: string;
}

// POST /api/session — create session (store token in httpOnly cookie)
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

// GET /api/session — check if session exists (doesn't return token)
export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(COOKIE_NAME);
  if (!cookie?.value) {
    return NextResponse.json({ authenticated: false });
  }

  try {
    const data: SessionData = JSON.parse(decrypt(cookie.value));
    return NextResponse.json({
      authenticated: true,
      tenantId: data.tenantId,
      subscriptionId: data.subscriptionId,
    });
  } catch {
    return NextResponse.json({ authenticated: false });
  }
}

// DELETE /api/session — logout
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(COOKIE_NAME);
  return response;
}

// Helper: extract session from request (used by other API routes)
export function getSessionFromRequest(req: NextRequest): SessionData | null {
  const cookie = req.cookies.get(COOKIE_NAME);
  if (!cookie?.value) return null;
  try {
    return JSON.parse(decrypt(cookie.value));
  } catch {
    return null;
  }
}
