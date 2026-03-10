import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_DIR = path.resolve(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "dashboard.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  fs.mkdirSync(DB_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      captured_at TEXT NOT NULL DEFAULT (datetime('now')),
      secure_score_current REAL,
      secure_score_max REAL,
      secure_score_pct REAL,
      defender_alert_count INTEGER,
      defender_alert_high INTEGER,
      risky_user_count INTEGER,
      signin_count INTEGER,
      noncompliant_device_count INTEGER,
      purview_alert_count INTEGER,
      insider_risk_alert_count INTEGER,
      sensitivity_label_count INTEGER,
      admin_risk_count INTEGER,
      admin_no_mfa_count INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_tenant_time
      ON snapshots (tenant_id, captured_at);
  `);

  // Add columns if upgrading from older schema
  try { db.exec("ALTER TABLE snapshots ADD COLUMN admin_risk_count INTEGER"); } catch {}
  try { db.exec("ALTER TABLE snapshots ADD COLUMN admin_no_mfa_count INTEGER"); } catch {}

  db.exec(`    CREATE TABLE IF NOT EXISTS snapshot_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
      panel TEXT NOT NULL,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS monitored_tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL UNIQUE,
      client_id TEXT,
      client_secret TEXT,
      user_token TEXT,
      poll_interval_min INTEGER NOT NULL DEFAULT 15,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_poll_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS alert_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      metric TEXT NOT NULL,
      operator TEXT NOT NULL,
      threshold REAL NOT NULL,
      notify_type TEXT NOT NULL DEFAULT 'webhook',
      notify_target TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_triggered_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS alert_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id INTEGER NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL,
      triggered_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      metric TEXT NOT NULL,
      value REAL NOT NULL,
      threshold REAL NOT NULL,
      message TEXT NOT NULL,
      notified INTEGER NOT NULL DEFAULT 0,
      detection_count INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      mitigated_at TEXT,
      mitigation_note TEXT
    );
  `);

  // Migrations for existing DBs
  try { db.exec("ALTER TABLE alert_history ADD COLUMN detection_count INTEGER NOT NULL DEFAULT 1"); } catch {}
  try { db.exec("ALTER TABLE alert_history ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"); } catch {}
  try { db.exec("ALTER TABLE alert_history ADD COLUMN mitigated_at TEXT"); } catch {}
  try { db.exec("ALTER TABLE alert_history ADD COLUMN mitigation_note TEXT"); } catch {}
  try { db.exec("ALTER TABLE alert_history ADD COLUMN last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))"); } catch {}

  // Custom workflows table
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_workflows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id TEXT NOT NULL UNIQUE,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'reporting',
      complexity TEXT NOT NULL DEFAULT 'medium',
      estimated_duration TEXT NOT NULL DEFAULT '5-15 min',
      tags TEXT NOT NULL DEFAULT '[]',
      definition TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'user',
      schedule TEXT,
      schedule_enabled INTEGER NOT NULL DEFAULT 0,
      notify_type TEXT,
      notify_target TEXT,
      last_run_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      mode TEXT NOT NULL DEFAULT 'guided',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      total_steps INTEGER NOT NULL DEFAULT 0,
      completed_steps INTEGER NOT NULL DEFAULT 0,
      skipped_steps INTEGER NOT NULL DEFAULT 0,
      failed_steps INTEGER NOT NULL DEFAULT 0,
      findings_count INTEGER NOT NULL DEFAULT 0,
      report_md TEXT,
      triggered_by TEXT NOT NULL DEFAULT 'user'
    );

    CREATE INDEX IF NOT EXISTS idx_workflow_runs_tenant
      ON workflow_runs (tenant_id, started_at);

    CREATE INDEX IF NOT EXISTS idx_custom_workflows_tenant
      ON custom_workflows (tenant_id);

    CREATE TABLE IF NOT EXISTS custom_skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_id TEXT NOT NULL UNIQUE,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      tags TEXT NOT NULL DEFAULT '[]',
      definition TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'uploaded',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_custom_skills_tenant
      ON custom_skills (tenant_id);
  `);

  return db;
}

export function saveSnapshot(
  tenantId: string,
  dashboardData: Record<string, any>
): number {
  const db = getDb();

  const score = dashboardData.secureScore;
  const alerts = dashboardData.alerts;
  const alertList = Array.isArray(alerts) ? alerts : alerts?.value ?? [];
  const risky = dashboardData.riskyUsers;
  const riskyList = Array.isArray(risky) ? risky : risky?.value ?? [];
  const signIns = dashboardData.signInLogs;
  const signInList = Array.isArray(signIns) ? signIns : signIns?.value ?? signIns?.signIns ?? [];
  const devices = dashboardData.intuneDevices;
  const deviceList = Array.isArray(devices) ? devices : devices?.value ?? [];
  const purview = dashboardData.purviewAlerts;
  const purviewList = Array.isArray(purview) ? purview : purview?.value ?? purview?.alerts ?? [];
  const insider = dashboardData.insiderRiskAlerts;
  const insiderList = Array.isArray(insider) ? insider : insider?.value ?? insider?.alerts ?? [];
  const posture = dashboardData.dataPosture;
  const adminRisks = dashboardData.adminRisks;

  const stmt = db.prepare(`
    INSERT INTO snapshots (
      tenant_id, secure_score_current, secure_score_max, secure_score_pct,
      defender_alert_count, defender_alert_high, risky_user_count,
      signin_count, noncompliant_device_count, purview_alert_count,
      insider_risk_alert_count, sensitivity_label_count,
      admin_risk_count, admin_no_mfa_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    tenantId,
    score?.currentScore ?? null,
    score?.maxScore ?? null,
    score?.percentageScore ?? null,
    alertList.length,
    alertList.filter((a: any) => a.severity === "high" || a.severity === "critical").length,
    riskyList.length,
    signInList.length,
    deviceList.length,
    purviewList.length,
    insiderList.length,
    posture?.sensitivityLabels?.count ?? null,
    adminRisks?.summary?.totalFindings ?? null,
    adminRisks?.summary?.adminsWithoutMfa ?? null
  );

  const snapshotId = result.lastInsertRowid as number;

  // Store full panel data for drill-down
  const detailStmt = db.prepare(
    "INSERT INTO snapshot_details (snapshot_id, panel, data) VALUES (?, ?, ?)"
  );
  const panels = ["secureScore", "alerts", "riskyUsers", "signInLogs",
    "intuneDevices", "purviewAlerts", "insiderRiskAlerts", "dataPosture", "recommendations", "adminRisks"];
  for (const panel of panels) {
    if (dashboardData[panel] !== undefined) {
      detailStmt.run(snapshotId, panel, JSON.stringify(dashboardData[panel]));
    }
  }

  return snapshotId;
}

export function getTrends(
  tenantId: string,
  days: number = 30
): any[] {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT
      captured_at,
      secure_score_current,
      secure_score_max,
      secure_score_pct,
      defender_alert_count,
      defender_alert_high,
      risky_user_count,
      signin_count,
      noncompliant_device_count,
      purview_alert_count,
      insider_risk_alert_count,
      sensitivity_label_count
    FROM snapshots
    WHERE tenant_id = ? AND captured_at >= datetime('now', ?)
    ORDER BY captured_at ASC
  `);
  return stmt.all(tenantId, `-${days} days`);
}

// --- Monitored Tenants ---

export function addMonitoredTenant(tenant: {
  tenantId: string;
  clientId?: string;
  clientSecret?: string;
  userToken?: string;
  pollIntervalMin?: number;
}) {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO monitored_tenants (tenant_id, client_id, client_secret, user_token, poll_interval_min)
    VALUES (?, ?, ?, ?, ?)
  `).run(tenant.tenantId, tenant.clientId ?? null, tenant.clientSecret ?? null, tenant.userToken ?? null, tenant.pollIntervalMin ?? 15);
}

export function getMonitoredTenants(): any[] {
  return getDb().prepare("SELECT * FROM monitored_tenants WHERE enabled = 1").all();
}

export function updateLastPoll(tenantId: string) {
  getDb().prepare("UPDATE monitored_tenants SET last_poll_at = datetime('now') WHERE tenant_id = ?").run(tenantId);
}

// --- Alert Rules ---

export function createAlertRule(rule: {
  tenantId: string;
  name: string;
  metric: string;
  operator: string;
  threshold: number;
  notifyType: string;
  notifyTarget: string;
}) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO alert_rules (tenant_id, name, metric, operator, threshold, notify_type, notify_target)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(rule.tenantId, rule.name, rule.metric, rule.operator, rule.threshold, rule.notifyType, rule.notifyTarget);
  return result.lastInsertRowid;
}

export function getAlertRules(tenantId: string): any[] {
  return getDb().prepare("SELECT * FROM alert_rules WHERE tenant_id = ? AND enabled = 1").all(tenantId);
}

export function deleteAlertRule(id: number) {
  getDb().prepare("DELETE FROM alert_rules WHERE id = ?").run(id);
}

// --- Alert History ---

// Returns existing active alert for this rule, or null
export function getActiveAlert(ruleId: number): any {
  return getDb().prepare(
    "SELECT * FROM alert_history WHERE rule_id = ? AND status = 'active' ORDER BY triggered_at DESC LIMIT 1"
  ).get(ruleId);
}

export function incrementAlertCount(alertId: number, newValue: number) {
  getDb().prepare(
    "UPDATE alert_history SET detection_count = detection_count + 1, last_seen_at = datetime('now'), value = ? WHERE id = ?"
  ).run(newValue, alertId);
}

export function saveAlertEvent(event: {
  ruleId: number;
  tenantId: string;
  metric: string;
  value: number;
  threshold: number;
  message: string;
}): { isNew: boolean; alertId: number } {
  const db = getDb();

  // Check for existing active alert for this rule
  const existing = getActiveAlert(event.ruleId);
  if (existing) {
    incrementAlertCount(existing.id, event.value);
    return { isNew: false, alertId: existing.id };
  }

  // New alert
  const result = db.prepare(`
    INSERT INTO alert_history (rule_id, tenant_id, metric, value, threshold, message, status)
    VALUES (?, ?, ?, ?, ?, ?, 'active')
  `).run(event.ruleId, event.tenantId, event.metric, event.value, event.threshold, event.message);
  db.prepare("UPDATE alert_rules SET last_triggered_at = datetime('now') WHERE id = ?").run(event.ruleId);
  return { isNew: true, alertId: result.lastInsertRowid as number };
}

export function mitigateAlert(alertId: number, note?: string) {
  getDb().prepare(
    "UPDATE alert_history SET status = 'mitigated', mitigated_at = datetime('now'), mitigation_note = ? WHERE id = ?"
  ).run(note ?? null, alertId);
}

export function reopenAlert(alertId: number) {
  getDb().prepare(
    "UPDATE alert_history SET status = 'active', mitigated_at = NULL, mitigation_note = NULL WHERE id = ?"
  ).run(alertId);
}

export function getAlertHistory(tenantId: string, limit = 50): any[] {
  return getDb().prepare(`
    SELECT ah.*, ar.name as rule_name, ar.notify_type, ar.notify_target
    FROM alert_history ah
    JOIN alert_rules ar ON ah.rule_id = ar.id
    WHERE ah.tenant_id = ?
    ORDER BY CASE WHEN ah.status = 'active' THEN 0 ELSE 1 END, ah.triggered_at DESC LIMIT ?
  `).all(tenantId, limit);
}

// --- Tenant Credentials (encrypted) ---

export function saveTenantCredentials(tenantId: string, clientId: string, encryptedSecret: string) {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenant_credentials (
      tenant_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      client_secret_enc TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.prepare(`
    INSERT OR REPLACE INTO tenant_credentials (tenant_id, client_id, client_secret_enc)
    VALUES (?, ?, ?)
  `).run(tenantId, clientId, encryptedSecret);
}

export function getTenantCredentials(tenantId: string): { clientId: string; clientSecretEnc: string } | null {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenant_credentials (
      tenant_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      client_secret_enc TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  const row = db.prepare("SELECT client_id, client_secret_enc FROM tenant_credentials WHERE tenant_id = ?").get(tenantId) as any;
  if (!row) return null;
  return { clientId: row.client_id, clientSecretEnc: row.client_secret_enc };
}

export function listTenantCredentials(): Array<{ tenantId: string; clientId: string; updatedAt: string }> {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenant_credentials (
      tenant_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      client_secret_enc TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  return db.prepare("SELECT tenant_id, client_id, updated_at FROM tenant_credentials").all() as any[];
}

// --- Custom Workflows ---

export function saveCustomWorkflow(
  tenantId: string,
  workflow: {
    id: string;
    name: string;
    description: string;
    category: string;
    complexity: string;
    estimatedDuration: string;
    tags: string[];
    definition: Record<string, unknown>;
    source?: string;
    schedule?: string;
    scheduleEnabled?: boolean;
    notifyType?: string;
    notifyTarget?: string;
  }
): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT OR REPLACE INTO custom_workflows
      (workflow_id, tenant_id, name, description, category, complexity,
       estimated_duration, tags, definition, source,
       schedule, schedule_enabled, notify_type, notify_target, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    workflow.id,
    tenantId,
    workflow.name,
    workflow.description,
    workflow.category,
    workflow.complexity,
    workflow.estimatedDuration,
    JSON.stringify(workflow.tags),
    JSON.stringify(workflow.definition),
    workflow.source ?? "user",
    workflow.schedule ?? null,
    workflow.scheduleEnabled ? 1 : 0,
    workflow.notifyType ?? null,
    workflow.notifyTarget ?? null
  );
  return result.lastInsertRowid as number;
}

export function getCustomWorkflows(tenantId: string): Array<{
  id: number;
  workflowId: string;
  name: string;
  description: string;
  category: string;
  complexity: string;
  estimatedDuration: string;
  tags: string[];
  definition: Record<string, unknown>;
  source: string;
  schedule: string | null;
  scheduleEnabled: boolean;
  notifyType: string | null;
  notifyTarget: string | null;
  lastRunAt: string | null;
  createdAt: string;
}> {
  const rows = getDb().prepare(
    "SELECT * FROM custom_workflows WHERE tenant_id = ? ORDER BY updated_at DESC"
  ).all(tenantId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: r.id as number,
    workflowId: r.workflow_id as string,
    name: r.name as string,
    description: r.description as string,
    category: r.category as string,
    complexity: r.complexity as string,
    estimatedDuration: r.estimated_duration as string,
    tags: JSON.parse((r.tags as string) || "[]"),
    definition: JSON.parse((r.definition as string) || "{}"),
    source: r.source as string,
    schedule: r.schedule as string | null,
    scheduleEnabled: !!(r.schedule_enabled as number),
    notifyType: r.notify_type as string | null,
    notifyTarget: r.notify_target as string | null,
    lastRunAt: r.last_run_at as string | null,
    createdAt: r.created_at as string,
  }));
}

export function deleteCustomWorkflow(workflowId: string, tenantId: string) {
  getDb().prepare(
    "DELETE FROM custom_workflows WHERE workflow_id = ? AND tenant_id = ?"
  ).run(workflowId, tenantId);
}

export function updateWorkflowSchedule(
  workflowId: string,
  tenantId: string,
  schedule: string | null,
  enabled: boolean,
  notifyType?: string,
  notifyTarget?: string
) {
  getDb().prepare(`
    UPDATE custom_workflows
    SET schedule = ?, schedule_enabled = ?, notify_type = ?, notify_target = ?, updated_at = datetime('now')
    WHERE workflow_id = ? AND tenant_id = ?
  `).run(schedule ?? null, enabled ? 1 : 0, notifyType ?? null, notifyTarget ?? null, workflowId, tenantId);
}

export function saveWorkflowRun(run: {
  workflowId: string;
  tenantId: string;
  status: string;
  mode: string;
  totalSteps: number;
  completedSteps: number;
  skippedSteps: number;
  failedSteps: number;
  findingsCount: number;
  reportMd?: string;
  triggeredBy: string;
}): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO workflow_runs
      (workflow_id, tenant_id, status, mode, total_steps, completed_steps,
       skipped_steps, failed_steps, findings_count, report_md, triggered_by,
       completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    run.workflowId, run.tenantId, run.status, run.mode,
    run.totalSteps, run.completedSteps, run.skippedSteps,
    run.failedSteps, run.findingsCount, run.reportMd ?? null,
    run.triggeredBy
  );

  // Update last_run_at on the custom workflow
  db.prepare(
    "UPDATE custom_workflows SET last_run_at = datetime('now') WHERE workflow_id = ? AND tenant_id = ?"
  ).run(run.workflowId, run.tenantId);

  return result.lastInsertRowid as number;
}

export function getWorkflowRuns(tenantId: string, workflowId?: string, limit = 20): Array<Record<string, unknown>> {
  const db = getDb();
  if (workflowId) {
    return db.prepare(
      "SELECT * FROM workflow_runs WHERE tenant_id = ? AND workflow_id = ? ORDER BY started_at DESC LIMIT ?"
    ).all(tenantId, workflowId, limit) as Array<Record<string, unknown>>;
  }
  return db.prepare(
    "SELECT * FROM workflow_runs WHERE tenant_id = ? ORDER BY started_at DESC LIMIT ?"
  ).all(tenantId, limit) as Array<Record<string, unknown>>;
}

// --- Custom Skills ---

export function saveCustomSkill(
  tenantId: string,
  skill: {
    id: string;
    name: string;
    description: string;
    category: string;
    tags: string[];
    definition: Record<string, unknown>;
    source?: string;
  }
): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT OR REPLACE INTO custom_skills
      (skill_id, tenant_id, name, description, category, tags, definition, source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    skill.id,
    tenantId,
    skill.name,
    skill.description,
    skill.category,
    JSON.stringify(skill.tags),
    JSON.stringify(skill.definition),
    skill.source ?? "uploaded"
  );
  return result.lastInsertRowid as number;
}

export function getCustomSkills(tenantId: string): Array<Record<string, unknown>> {
  const rows = getDb().prepare(
    "SELECT * FROM custom_skills WHERE tenant_id = ? ORDER BY updated_at DESC"
  ).all(tenantId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: r.id,
    skillId: r.skill_id,
    name: r.name,
    description: r.description,
    category: r.category,
    tags: JSON.parse((r.tags as string) || "[]"),
    definition: JSON.parse((r.definition as string) || "{}"),
    source: r.source,
    createdAt: r.created_at,
  }));
}

export function deleteCustomSkill(skillId: string, tenantId: string) {
  getDb().prepare(
    "DELETE FROM custom_skills WHERE skill_id = ? AND tenant_id = ?"
  ).run(skillId, tenantId);
}
