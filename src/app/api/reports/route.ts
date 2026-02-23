import { NextRequest, NextResponse } from "next/server";
import { getDb, getTrends } from "@/lib/db";
import { evaluateCompliance } from "@/lib/compliance/frameworks";

// GET /api/reports?tenantId=xxx&days=30 — generate HTML report
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get("tenantId");
  const days = parseInt(req.nextUrl.searchParams.get("days") ?? "30", 10);
  if (!tenantId) return NextResponse.json({ error: "tenantId required" }, { status: 400 });

  const db = getDb();
  const snapshot = db.prepare(
    "SELECT * FROM snapshots WHERE tenant_id = ? ORDER BY captured_at DESC LIMIT 1"
  ).get(tenantId) as any;

  if (!snapshot) {
    return NextResponse.json({ error: "No data available" }, { status: 404 });
  }

  const trends = getTrends(tenantId, days);
  const compliance = evaluateCompliance(snapshot);

  const alertHistory = db.prepare(`
    SELECT ah.message, ah.triggered_at, ar.name as rule_name
    FROM alert_history ah JOIN alert_rules ar ON ah.rule_id = ar.id
    WHERE ah.tenant_id = ? ORDER BY ah.triggered_at DESC LIMIT 20
  `).all(tenantId) as any[];

  // Generate HTML report
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Security Report — ${tenantId.slice(0, 8)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 900px; margin: 0 auto; padding: 40px; color: #1a1a2e; }
    h1 { color: #0f3460; border-bottom: 3px solid #0f3460; padding-bottom: 10px; }
    h2 { color: #16213e; margin-top: 30px; }
    .metric-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 20px 0; }
    .metric { background: #f0f4ff; border-radius: 8px; padding: 16px; text-align: center; }
    .metric .value { font-size: 32px; font-weight: bold; color: #0f3460; }
    .metric .label { font-size: 12px; color: #666; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th { background: #0f3460; color: white; padding: 10px; text-align: left; }
    td { padding: 8px 10px; border-bottom: 1px solid #e0e0e0; }
    .pass { color: #27ae60; font-weight: bold; }
    .fail { color: #e74c3c; font-weight: bold; }
    .partial { color: #f39c12; font-weight: bold; }
    .unknown { color: #999; }
    .score-bar { background: #e0e0e0; border-radius: 4px; height: 8px; margin-top: 4px; }
    .score-fill { height: 8px; border-radius: 4px; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e0e0e0; color: #999; font-size: 12px; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <h1>🛡️ Security Posture Report</h1>
  <p>Tenant: <code>${tenantId}</code> | Generated: ${new Date().toLocaleString()} | Period: ${days} days</p>

  <h2>Security Metrics</h2>
  <div class="metric-grid">
    <div class="metric">
      <div class="value">${snapshot.secure_score_pct ?? "—"}%</div>
      <div class="label">Secure Score</div>
    </div>
    <div class="metric">
      <div class="value">${snapshot.defender_alert_count ?? 0}</div>
      <div class="label">Defender Alerts</div>
    </div>
    <div class="metric">
      <div class="value">${snapshot.risky_user_count ?? 0}</div>
      <div class="label">Risky Users</div>
    </div>
    <div class="metric">
      <div class="value">${snapshot.noncompliant_device_count ?? 0}</div>
      <div class="label">Non-Compliant Devices</div>
    </div>
  </div>

  ${trends.length > 1 ? `
  <h2>Trend Summary (${days} days)</h2>
  <table>
    <tr><th>Metric</th><th>Start</th><th>Current</th><th>Change</th></tr>
    <tr>
      <td>Secure Score</td>
      <td>${trends[0]?.secure_score_pct ?? "—"}%</td>
      <td>${trends[trends.length - 1]?.secure_score_pct ?? "—"}%</td>
      <td>${((trends[trends.length - 1]?.secure_score_pct ?? 0) - (trends[0]?.secure_score_pct ?? 0)).toFixed(1)}%</td>
    </tr>
    <tr>
      <td>Defender Alerts</td>
      <td>${trends[0]?.defender_alert_count ?? 0}</td>
      <td>${trends[trends.length - 1]?.defender_alert_count ?? 0}</td>
      <td>${(trends[trends.length - 1]?.defender_alert_count ?? 0) - (trends[0]?.defender_alert_count ?? 0)}</td>
    </tr>
    <tr>
      <td>Risky Users</td>
      <td>${trends[0]?.risky_user_count ?? 0}</td>
      <td>${trends[trends.length - 1]?.risky_user_count ?? 0}</td>
      <td>${(trends[trends.length - 1]?.risky_user_count ?? 0) - (trends[0]?.risky_user_count ?? 0)}</td>
    </tr>
  </table>` : ""}

  <h2>Compliance Assessment</h2>
  ${compliance.map((fw) => `
    <h3>${fw.framework} — ${fw.score}%</h3>
    <div class="score-bar"><div class="score-fill" style="width:${fw.score}%; background:${fw.score >= 70 ? "#27ae60" : fw.score >= 40 ? "#f39c12" : "#e74c3c"}"></div></div>
    <table>
      <tr><th>Control</th><th>Status</th><th>Detail</th></tr>
      ${fw.controls.map((c) => `
        <tr>
          <td><strong>${c.id}</strong> ${c.name}</td>
          <td class="${c.result.status}">${c.result.status.toUpperCase()}</td>
          <td>${c.result.detail}</td>
        </tr>
      `).join("")}
    </table>
  `).join("")}

  ${alertHistory.length > 0 ? `
  <h2>Recent Alerts</h2>
  <table>
    <tr><th>Time</th><th>Alert</th></tr>
    ${alertHistory.map((a: any) => `
      <tr><td>${new Date(a.triggered_at).toLocaleString()}</td><td>${a.message}</td></tr>
    `).join("")}
  </table>` : ""}

  <div class="footer">
    Generated by Security Dashboard | ${new Date().toISOString()}
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html",
      "Content-Disposition": `inline; filename="security-report-${tenantId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.html"`,
    },
  });
}
