import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import crypto from "crypto";

const COOKIE_NAME = "sec_session";
const COOKIE_MAX_AGE = 3600;

// POST /api/session — create session (token stored in DB, session ID in cookie)
export async function POST(req: NextRequest) {
  const { graphToken, tenantId, subscriptionId } = await req.json();

  if (!graphToken || !tenantId) {
    return NextResponse.json({ error: "graphToken and tenantId required" }, { status: 400 });
  }

  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      subscription_id TEXT,
      graph_token TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )
  `);

  // Clean expired sessions
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();

  const sessionId = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + COOKIE_MAX_AGE * 1000).toISOString();

  db.prepare("INSERT INTO sessions (id, tenant_id, subscription_id, graph_token, expires_at) VALUES (?, ?, ?, ?, ?)")
    .run(sessionId, tenantId, subscriptionId ?? "", graphToken, expiresAt);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, sessionId, {
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
  const session = getSessionFromDb(req);
  if (!session) return NextResponse.json({ authenticated: false });
  return NextResponse.json({
    authenticated: true,
    tenantId: session.tenantId,
    subscriptionId: session.subscriptionId,
  });
}

// DELETE /api/session — logout
export async function DELETE(req: NextRequest) {
  const cookie = req.cookies.get(COOKIE_NAME);
  if (cookie?.value) {
    try {
      const db = getDb();
      db.prepare("DELETE FROM sessions WHERE id = ?").run(cookie.value);
    } catch {}
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(COOKIE_NAME);
  return response;
}

function getSessionFromDb(req: NextRequest): { graphToken: string; tenantId: string; subscriptionId?: string } | null {
  const cookie = req.cookies.get(COOKIE_NAME);
  if (!cookie?.value) return null;
  try {
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        subscription_id TEXT,
        graph_token TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )
    `);
    const row = db.prepare("SELECT * FROM sessions WHERE id = ? AND expires_at > datetime('now')").get(cookie.value) as any;
    if (!row) return null;
    return { graphToken: row.graph_token, tenantId: row.tenant_id, subscriptionId: row.subscription_id };
  } catch {
    return null;
  }
}
