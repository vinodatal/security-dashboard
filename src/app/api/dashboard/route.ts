import { NextRequest, NextResponse } from "next/server";
import { callTool } from "@/lib/mcp-client";
import { saveSnapshot } from "@/lib/db";

export async function POST(req: NextRequest) {
  const { tenantId, subscriptionId, userToken, clientId, clientSecret, hoursBack = 24 } = await req.json();

  if (!tenantId || !userToken) {
    return NextResponse.json(
      { error: "tenantId and userToken are required" },
      { status: 400 }
    );
  }

  const toolArgs = { tenantId, userToken };
  const lookbackDays = Math.max(1, Math.ceil(hoursBack / 24));

  const mcpEnv = clientId && clientSecret
    ? { AZURE_CLIENT_ID: clientId, AZURE_CLIENT_SECRET: clientSecret, AZURE_TENANT_ID: tenantId }
    : undefined;

  const appArgs = clientId && clientSecret ? { tenantId } : toolArgs;

  const results = await Promise.allSettled([
    callTool("get_defender_alerts", { ...appArgs, top: 20 }, mcpEnv),
    callTool("get_secure_score", appArgs, mcpEnv),
    callTool("get_entra_risky_users", appArgs, mcpEnv),
    callTool("get_entra_signin_logs", { ...toolArgs, lookbackDays, top: 50 }, mcpEnv),
    callTool("get_intune_devices", { ...appArgs, complianceState: "noncompliant", top: 20 }, mcpEnv),
    callTool("get_purview_alerts", { ...appArgs, top: 20 }, mcpEnv),
    callTool("get_security_recommendations", { ...appArgs, top: 10 }, mcpEnv),
    callTool("get_insider_risk_alerts", { ...appArgs, top: 20 }, mcpEnv),
    callTool("get_data_security_posture", appArgs, mcpEnv),
    callTool("verify_access", toolArgs, mcpEnv),
  ]);

  const [
    alerts, secureScore, riskyUsers, signInLogs,
    intuneDevices, purviewAlerts, recommendations,
    insiderRiskAlerts, dataPosture, accessStatus
  ] = results.map((r) =>
    r.status === "fulfilled" ? r.value : { error: (r as PromiseRejectedResult).reason?.message ?? "Failed" }
  );

  const response = {
    alerts,
    secureScore,
    riskyUsers,
    signInLogs,
    intuneDevices,
    purviewAlerts,
    recommendations,
    insiderRiskAlerts,
    dataPosture,
    accessStatus,
    timestamp: new Date().toISOString(),
  };

  // Auto-save snapshot for trend tracking
  try {
    saveSnapshot(tenantId, response);
  } catch (e) {
    console.error("Snapshot save failed:", e);
  }

  return NextResponse.json(response);
}
