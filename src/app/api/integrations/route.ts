import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// GET /api/integrations — list configured integrations
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get("tenantId");
  if (!tenantId) return NextResponse.json({ error: "tenantId required" }, { status: 400 });

  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      config TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const integrations = db.prepare("SELECT id, tenant_id, type, name, enabled, created_at FROM integrations WHERE tenant_id = ?").all(tenantId);
  return NextResponse.json({ integrations });
}

// POST /api/integrations — add a Jira/ServiceNow integration
export async function POST(req: NextRequest) {
  const { tenantId, type, name, baseUrl, auth, projectKey, issueType, tableName } = await req.json();

  if (!tenantId || !type || !baseUrl || !auth) {
    return NextResponse.json({ error: "tenantId, type, baseUrl, auth required" }, { status: 400 });
  }

  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      config TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const config = JSON.stringify({ baseUrl, auth, projectKey, issueType, tableName });
  const result = db.prepare(
    "INSERT INTO integrations (tenant_id, type, name, config) VALUES (?, ?, ?, ?)"
  ).run(tenantId, type, name || `${type} integration`, config);

  return NextResponse.json({ id: result.lastInsertRowid, message: `${type} integration added` });
}

// DELETE /api/integrations?id=xxx
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  getDb().prepare("DELETE FROM integrations WHERE id = ?").run(parseInt(id, 10));
  return NextResponse.json({ message: "Integration removed" });
}
