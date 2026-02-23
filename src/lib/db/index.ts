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
      sensitivity_label_count INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_tenant_time
      ON snapshots (tenant_id, captured_at);

    CREATE TABLE IF NOT EXISTS snapshot_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
      panel TEXT NOT NULL,
      data TEXT NOT NULL
    );
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

  const stmt = db.prepare(`
    INSERT INTO snapshots (
      tenant_id, secure_score_current, secure_score_max, secure_score_pct,
      defender_alert_count, defender_alert_high, risky_user_count,
      signin_count, noncompliant_device_count, purview_alert_count,
      insider_risk_alert_count, sensitivity_label_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    posture?.sensitivityLabels?.count ?? null
  );

  const snapshotId = result.lastInsertRowid as number;

  // Store full panel data for drill-down
  const detailStmt = db.prepare(
    "INSERT INTO snapshot_details (snapshot_id, panel, data) VALUES (?, ?, ?)"
  );
  const panels = ["secureScore", "alerts", "riskyUsers", "signInLogs",
    "intuneDevices", "purviewAlerts", "insiderRiskAlerts", "dataPosture", "recommendations"];
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
