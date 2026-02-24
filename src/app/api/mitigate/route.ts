import { NextRequest, NextResponse } from "next/server";
import { mitigateAlert, reopenAlert, getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { investigate } from "@/lib/agent/investigator";

// POST /api/mitigate — mark alert as mitigated + verify with agent
export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { alertId, action } = await req.json();
  if (!alertId) return NextResponse.json({ error: "alertId required" }, { status: 400 });

  const db = getDb();
  const alert = db.prepare("SELECT * FROM alert_history WHERE id = ?").get(alertId) as any;
  if (!alert) return NextResponse.json({ error: "Alert not found" }, { status: 404 });

  if (action === "reopen") {
    reopenAlert(alertId);
    return NextResponse.json({ message: "Alert reopened", status: "active" });
  }

  // Verify mitigation with the investigation agent
  try {
    const verification = await investigate(
      session.tenantId,
      {
        type: "mitigation_verification",
        detail: `Verify if this alert is actually mitigated: ${alert.message}. The alert was for metric "${alert.metric}" with value ${alert.value} exceeding threshold ${alert.threshold}. Check the current state and confirm if the issue has been resolved.`,
        severity: "medium",
      },
      session.graphToken
    );

    const isVerified = verification.narrative?.toLowerCase().includes("resolved") ||
      verification.narrative?.toLowerCase().includes("mitigated") ||
      verification.narrative?.toLowerCase().includes("no longer") ||
      verification.narrative?.toLowerCase().includes("has been fixed");

    mitigateAlert(alertId, verification.narrative?.slice(0, 500));

    return NextResponse.json({
      message: isVerified ? "Mitigation verified by AI" : "Marked as mitigated (AI could not fully confirm)",
      verified: isVerified,
      status: "mitigated",
      analysis: verification.narrative,
      toolsCalled: verification.toolCalls?.map((t) => t.tool),
    });
  } catch (e: any) {
    // Still mitigate even if verification fails
    mitigateAlert(alertId, `Manual mitigation (verification failed: ${e.message})`);
    return NextResponse.json({
      message: "Marked as mitigated (verification unavailable)",
      verified: false,
      status: "mitigated",
      error: e.message,
    });
  }
}
