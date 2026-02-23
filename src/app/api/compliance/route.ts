import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { evaluateCompliance } from "@/lib/compliance/frameworks";

// GET /api/compliance?tenantId=xxx — evaluate compliance against latest snapshot
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get("tenantId");
  if (!tenantId) return NextResponse.json({ error: "tenantId required" }, { status: 400 });

  const db = getDb();
  const snapshot = db.prepare(
    "SELECT * FROM snapshots WHERE tenant_id = ? ORDER BY captured_at DESC LIMIT 1"
  ).get(tenantId) as any;

  if (!snapshot) {
    return NextResponse.json({ error: "No snapshots found. Load the dashboard first." }, { status: 404 });
  }

  const results = evaluateCompliance(snapshot);

  // SLA metrics from snapshot history
  const sla = db.prepare(`
    SELECT
      COUNT(*) as total_snapshots,
      MIN(captured_at) as first_snapshot,
      MAX(captured_at) as last_snapshot,
      AVG(defender_alert_high) as avg_high_alerts,
      AVG(risky_user_count) as avg_risky_users,
      AVG(noncompliant_device_count) as avg_noncompliant
    FROM snapshots WHERE tenant_id = ?
  `).get(tenantId) as any;

  // Alert response times
  const alertSla = db.prepare(`
    SELECT
      COUNT(*) as total_alerts_triggered,
      MIN(triggered_at) as first_alert,
      MAX(triggered_at) as last_alert
    FROM alert_history WHERE tenant_id = ?
  `).get(tenantId) as any;

  return NextResponse.json({
    compliance: results,
    sla: {
      monitoringSince: sla?.first_snapshot,
      totalSnapshots: sla?.total_snapshots ?? 0,
      avgHighAlerts: Math.round((sla?.avg_high_alerts ?? 0) * 10) / 10,
      avgRiskyUsers: Math.round((sla?.avg_risky_users ?? 0) * 10) / 10,
      avgNoncompliantDevices: Math.round((sla?.avg_noncompliant ?? 0) * 10) / 10,
      totalAlertsTriggered: alertSla?.total_alerts_triggered ?? 0,
    },
    snapshotTime: snapshot.captured_at,
  });
}
