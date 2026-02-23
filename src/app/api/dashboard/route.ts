import { NextRequest, NextResponse } from "next/server";
import { callTool } from "@/lib/mcp-client";
import { saveSnapshot, getTenantCredentials } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { getSession } from "@/lib/session";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const hoursBack = body.hoursBack ?? 24;

  const session = getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated. Please sign in." }, { status: 401 });
  }

  const { graphToken: userToken, tenantId } = session;
  const toolArgs = { tenantId, userToken };
  const lookbackDays = Math.max(1, Math.ceil(hoursBack / 24));

  // Load app credentials from server-side encrypted storage
  let mcpEnv: Record<string, string> | undefined;
  let appArgs = toolArgs;

  const creds = getTenantCredentials(tenantId);
  if (creds) {
    try {
      const clientSecret = decrypt(creds.clientSecretEnc);
      mcpEnv = { AZURE_CLIENT_ID: creds.clientId, AZURE_CLIENT_SECRET: clientSecret, AZURE_TENANT_ID: tenantId };
      appArgs = { tenantId } as any;
    } catch (e) {
      console.error("Failed to decrypt tenant credentials:", e);
    }
  }

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
    callTool("detect_privileged_user_risks", toolArgs, mcpEnv),
    callTool("verify_access", toolArgs, mcpEnv),
  ]);

  const [
    alerts, secureScore, riskyUsers, signInLogs,
    intuneDevices, purviewAlerts, recommendations,
    insiderRiskAlerts, dataPosture, adminRisks, accessStatus
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
    adminRisks,
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
