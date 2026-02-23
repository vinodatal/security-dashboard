import { NextRequest } from "next/server";
import { getDb } from "./db";

const COOKIE_NAME = "sec_session";

export interface SessionData {
  graphToken: string;
  tenantId: string;
  subscriptionId?: string;
}

export function getSession(req: NextRequest): SessionData | null {
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
