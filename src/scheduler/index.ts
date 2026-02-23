import cron from "node-cron";
import { getMonitoredTenants, updateLastPoll, saveSnapshot, getAlertRules, getDb } from "../lib/db/index.js";
import { callTool } from "../lib/mcp-client.js";
import { evaluateAlerts } from "../lib/alerts/evaluator.js";
import { sendNotifications } from "../lib/alerts/notifier.js";

function ts(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

const TOOL_NAMES = [
  "get_defender_alerts",
  "get_secure_score",
  "get_entra_risky_users",
  "get_entra_signin_logs",
  "get_intune_devices",
  "get_purview_alerts",
  "get_insider_risk_alerts",
  "detect_privileged_user_risks",
];

let pollCount = 0;

async function pollTenant(tenant: any): Promise<void> {
  const { tenant_id: tenantId, client_id: clientId, client_secret: clientSecret, user_token: userToken } = tenant;
  const label = tenantId.slice(0, 8);

  console.log(`[${ts()}] [poll] Tenant ${label} — starting ${TOOL_NAMES.length} tool calls...`);
  const startTime = Date.now();

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
      callTool("detect_privileged_user_risks", toolArgs, mcpEnv),
    ]);

    // Log per-tool results
    const toolResults: string[] = [];
    results.forEach((r, i) => {
      const name = TOOL_NAMES[i];
      if (r.status === "fulfilled") {
        const val = r.value;
        const hasError = val?.error || val?.isError;
        toolResults.push(`  ${hasError ? "✗" : "✓"} ${name}${hasError ? " (API error)" : ""}`);
      } else {
        toolResults.push(`  ✗ ${name} — ${(r as PromiseRejectedResult).reason?.message?.slice(0, 80) ?? "failed"}`);
      }
    });
    console.log(`[${ts()}] [poll] Tenant ${label} — tool results:\n${toolResults.join("\n")}`);

    const [alerts, secureScore, riskyUsers, signInLogs, intuneDevices, purviewAlerts, insiderRiskAlerts, adminRisks] = results.map(
      (r) => (r.status === "fulfilled" ? r.value : { error: (r as PromiseRejectedResult).reason?.message ?? "Failed" })
    );

    const dashboardData = { alerts, secureScore, riskyUsers, signInLogs, intuneDevices, purviewAlerts, insiderRiskAlerts, adminRisks };

    // Save snapshot
    const snapshotId = saveSnapshot(tenantId, dashboardData);
    updateLastPoll(tenantId);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[${ts()}] [poll] Tenant ${label} — snapshot #${snapshotId} saved (${elapsed}s)`);

    // Evaluate alert rules
    const rules = getAlertRules(tenantId);
    if (rules.length > 0) {
      const snapshot = getDb().prepare("SELECT * FROM snapshots WHERE id = ?").get(snapshotId);
      const triggered = evaluateAlerts(tenantId, snapshot);

      console.log(`[${ts()}] [alerts] Tenant ${label} — ${rules.length} rule(s) evaluated, ${triggered.length} triggered`);

      if (triggered.length > 0) {
        for (const t of triggered) {
          console.log(`[${ts()}] [alerts]   🚨 ${t.ruleName}: ${t.metric} = ${t.value} (threshold: ${t.threshold})`);
        }
        await sendNotifications(triggered);
        console.log(`[${ts()}] [alerts] Notifications sent`);
      }
    }
  } catch (e: any) {
    console.error(`[${ts()}] [poll] Tenant ${label} — ERROR: ${e.message}`);
  }
}

async function pollAll(): Promise<void> {
  pollCount++;
  const tenants = getMonitoredTenants();

  if (tenants.length === 0) {
    console.log(`[${ts()}] [scheduler] No monitored tenants. Add alert rules via the dashboard to start monitoring.`);
    return;
  }

  console.log(`[${ts()}] [scheduler] ── Poll #${pollCount} ── ${tenants.length} tenant(s) ──`);
  const startTime = Date.now();

  for (const tenant of tenants) {
    await pollTenant(tenant);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[${ts()}] [scheduler] ── Poll #${pollCount} complete (${elapsed}s) ── next in 15 min ──\n`);
}

export function startScheduler(): void {
  console.log(`[${ts()}] [scheduler] ╔══════════════════════════════════════════╗`);
  console.log(`[${ts()}] [scheduler] ║  Security Dashboard — Background Monitor ║`);
  console.log(`[${ts()}] [scheduler] ║  Polling every 15 minutes                ║`);
  console.log(`[${ts()}] [scheduler] ╚══════════════════════════════════════════╝`);
  console.log();

  // Run immediately on start
  pollAll().catch((e) => console.error(`[${ts()}] [scheduler] Initial poll failed: ${e.message}`));

  // Then every 15 minutes
  cron.schedule("*/15 * * * *", () => {
    pollAll().catch((e) => console.error(`[${ts()}] [scheduler] Poll failed: ${e.message}`));
  });
}

// Run directly if called as script
if (process.argv[1]?.includes("scheduler")) {
  startScheduler();
}
