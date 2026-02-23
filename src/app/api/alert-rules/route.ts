import { NextRequest, NextResponse } from "next/server";
import { createAlertRule, getAlertRules, deleteAlertRule, getAlertHistory, addMonitoredTenant } from "@/lib/db";

// GET /api/alert-rules?tenantId=xxx — list rules + history
export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get("tenantId");
  if (!tenantId) return NextResponse.json({ error: "tenantId required" }, { status: 400 });

  const rules = getAlertRules(tenantId);
  const history = getAlertHistory(tenantId, 20);
  return NextResponse.json({ rules, history });
}

// POST /api/alert-rules — create a rule + register tenant for monitoring
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { tenantId, name, metric, operator, threshold, notifyType, notifyTarget, clientId, clientSecret, userToken } = body;

  if (!tenantId || !name || !metric || !operator || !threshold || !notifyTarget) {
    return NextResponse.json({ error: "Missing required fields: tenantId, name, metric, operator, threshold, notifyTarget" }, { status: 400 });
  }

  // Ensure tenant is registered for background monitoring
  addMonitoredTenant({ tenantId, clientId, clientSecret, userToken });

  const id = createAlertRule({
    tenantId,
    name,
    metric,
    operator,
    threshold,
    notifyType: notifyType ?? "webhook",
    notifyTarget,
  });

  return NextResponse.json({ id, message: "Alert rule created. Background monitoring will evaluate this rule every 15 minutes." });
}

// DELETE /api/alert-rules?id=xxx
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  deleteAlertRule(parseInt(id, 10));
  return NextResponse.json({ message: "Rule deleted" });
}
