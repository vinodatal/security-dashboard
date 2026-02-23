import cron from "node-cron";
import { getMonitoredTenants, updateLastPoll, saveSnapshot } from "../lib/db/index.js";
import { callTool } from "../lib/mcp-client.js";
import { evaluateAlerts } from "../lib/alerts/evaluator.js";
import { sendNotifications } from "../lib/alerts/notifier.js";

async function pollTenant(tenant: any): Promise<void> {
  const { tenant_id: tenantId, client_id: clientId, client_secret: clientSecret, user_token: userToken } = tenant;

  console.log(`[scheduler] Polling tenant ${tenantId.slice(0, 8)}...`);

  const mcpEnv = clientId && clientSecret
    ? { AZURE_CLIENT_ID: clientId, AZURE_CLIENT_SECRET: clientSecret, AZURE_TENANT_ID: tenantId }
    : undefined;

  const toolArgs = userToken ? { tenantId, userToken } : { tenantId };
  const appArgs = clientId && clientSecret ? { tenantId } : toolArgs;

  try {
    const results = await Promise.allSettled([
      callTool("get_defender_alerts", { ...appArgs, top: 20 }, mcpEnv),
      callTool("get_secure_score", appArgs, mcpEnv),
      callTool("get_entra_risky_users", appArgs, mcpEnv),
      callTool("get_entra_signin_logs", { ...toolArgs, lookbackDays: 1, top: 50 }, mcpEnv),
      callTool("get_intune_devices", { ...appArgs, complianceState: "noncompliant", top: 20 }, mcpEnv),
      callTool("get_purview_alerts", { ...appArgs, top: 20 }, mcpEnv),
      callTool("get_insider_risk_alerts", { ...appArgs, top: 20 }, mcpEnv),
    ]);

    const [alerts, secureScore, riskyUsers, signInLogs, intuneDevices, purviewAlerts, insiderRiskAlerts] = results.map(
      (r) => (r.status === "fulfilled" ? r.value : { error: (r as PromiseRejectedResult).reason?.message ?? "Failed" })
    );

    const dashboardData = { alerts, secureScore, riskyUsers, signInLogs, intuneDevices, purviewAlerts, insiderRiskAlerts };

    // Save snapshot
    const snapshotId = saveSnapshot(tenantId, dashboardData);
    updateLastPoll(tenantId);
    console.log(`[scheduler] Snapshot #${snapshotId} saved for tenant ${tenantId.slice(0, 8)}`);

    // Evaluate alert rules against the snapshot
    // Get the raw snapshot row for metric extraction
    const { getDb } = await import("../lib/db/index.js");
    const snapshot = getDb().prepare("SELECT * FROM snapshots WHERE id = ?").get(snapshotId);

    const triggered = evaluateAlerts(tenantId, snapshot);
    if (triggered.length > 0) {
      console.log(`[scheduler] ${triggered.length} alert(s) triggered for tenant ${tenantId.slice(0, 8)}`);
      await sendNotifications(triggered);
    }
  } catch (e: any) {
    console.error(`[scheduler] Error polling tenant ${tenantId.slice(0, 8)}:`, e.message);
  }
}

async function pollAll(): Promise<void> {
  const tenants = getMonitoredTenants();
  if (tenants.length === 0) {
    return;
  }
  console.log(`[scheduler] Polling ${tenants.length} tenant(s)...`);
  for (const tenant of tenants) {
    await pollTenant(tenant);
  }
}

export function startScheduler(): void {
  console.log("[scheduler] Starting background monitor (every 15 minutes)");

  // Run immediately on start
  pollAll().catch((e) => console.error("[scheduler] Initial poll failed:", e.message));

  // Then every 15 minutes
  cron.schedule("*/15 * * * *", () => {
    pollAll().catch((e) => console.error("[scheduler] Poll failed:", e.message));
  });
}

// Run directly if called as script
if (process.argv[1]?.includes("scheduler")) {
  startScheduler();
}
