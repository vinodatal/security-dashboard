import { getAlertRules, saveAlertEvent } from "../db/index.js";

// Maps metric names to snapshot column values
function extractMetric(snapshot: any, metric: string): number | null {
  const map: Record<string, string> = {
    secure_score_pct: "secure_score_pct",
    secure_score: "secure_score_current",
    defender_alerts: "defender_alert_count",
    defender_alerts_high: "defender_alert_high",
    risky_users: "risky_user_count",
    signins: "signin_count",
    noncompliant_devices: "noncompliant_device_count",
    purview_alerts: "purview_alert_count",
    insider_risk_alerts: "insider_risk_alert_count",
  };
  const col = map[metric];
  if (!col) return null;
  const val = snapshot[col];
  return typeof val === "number" ? val : null;
}

function evaluate(value: number, operator: string, threshold: number): boolean {
  switch (operator) {
    case "lt": return value < threshold;
    case "lte": return value <= threshold;
    case "gt": return value > threshold;
    case "gte": return value >= threshold;
    case "eq": return value === threshold;
    case "neq": return value !== threshold;
    default: return false;
  }
}

const OPERATOR_LABELS: Record<string, string> = {
  lt: "dropped below",
  lte: "is at or below",
  gt: "exceeded",
  gte: "is at or above",
  eq: "equals",
  neq: "changed from",
};

export interface TriggeredAlert {
  ruleId: number;
  ruleName: string;
  tenantId: string;
  metric: string;
  value: number;
  threshold: number;
  message: string;
  notifyType: string;
  notifyTarget: string;
}

export function evaluateAlerts(tenantId: string, snapshot: any): TriggeredAlert[] {
  const rules = getAlertRules(tenantId);
  const triggered: TriggeredAlert[] = [];

  for (const rule of rules) {
    const value = extractMetric(snapshot, rule.metric);
    if (value === null) continue;

    if (evaluate(value, rule.operator, rule.threshold)) {
      const label = OPERATOR_LABELS[rule.operator] ?? rule.operator;
      const message = `🚨 ${rule.name}: ${rule.metric} ${label} ${rule.threshold} (current: ${value})`;

      saveAlertEvent({
        ruleId: rule.id,
        tenantId,
        metric: rule.metric,
        value,
        threshold: rule.threshold,
        message,
      });

      triggered.push({
        ruleId: rule.id,
        ruleName: rule.name,
        tenantId,
        metric: rule.metric,
        value,
        threshold: rule.threshold,
        message,
        notifyType: rule.notify_type,
        notifyTarget: rule.notify_target,
      });
    }
  }

  return triggered;
}
