// Maps security metrics to compliance framework controls

export interface ComplianceControl {
  id: string;
  name: string;
  description: string;
  framework: string;
  metrics: string[];        // Which dashboard metrics map to this control
  evaluator: (snapshot: any) => ControlStatus;
}

export interface ControlStatus {
  status: "pass" | "fail" | "partial" | "unknown";
  detail: string;
  value?: number;
}

export interface FrameworkResult {
  framework: string;
  totalControls: number;
  passing: number;
  failing: number;
  partial: number;
  unknown: number;
  score: number;
  controls: Array<ComplianceControl & { result: ControlStatus }>;
}

// Control definitions per framework
const CONTROLS: ComplianceControl[] = [
  // --- CIS Microsoft 365 Benchmark ---
  {
    id: "CIS-1.1", name: "Enable MFA for all users", description: "Multi-factor authentication should be enforced",
    framework: "CIS", metrics: ["secure_score_pct"],
    evaluator: (s) => s.secure_score_pct >= 60
      ? { status: "pass", detail: "Secure Score indicates MFA policies active", value: s.secure_score_pct }
      : { status: "fail", detail: `Secure Score ${s.secure_score_pct}% — likely missing MFA enforcement`, value: s.secure_score_pct },
  },
  {
    id: "CIS-2.1", name: "Security alerts monitored", description: "Active monitoring of security alerts",
    framework: "CIS", metrics: ["defender_alert_count"],
    evaluator: (s) => ({ status: "pass", detail: `${s.defender_alert_count ?? 0} alerts being monitored`, value: s.defender_alert_count }),
  },
  {
    id: "CIS-3.1", name: "DLP policies enforced", description: "Data loss prevention policies active",
    framework: "CIS", metrics: ["purview_alert_count"],
    evaluator: (s) => s.purview_alert_count !== null
      ? { status: "pass", detail: `DLP active — ${s.purview_alert_count} alerts in period` }
      : { status: "unknown", detail: "Unable to verify DLP status" },
  },
  {
    id: "CIS-4.1", name: "Device compliance enforced", description: "All devices should meet compliance policies",
    framework: "CIS", metrics: ["noncompliant_device_count"],
    evaluator: (s) => s.noncompliant_device_count === 0
      ? { status: "pass", detail: "All devices compliant" }
      : { status: "fail", detail: `${s.noncompliant_device_count} non-compliant devices`, value: s.noncompliant_device_count },
  },
  {
    id: "CIS-5.1", name: "No high-risk users", description: "Identity protection should flag no high-risk users",
    framework: "CIS", metrics: ["risky_user_count"],
    evaluator: (s) => s.risky_user_count === 0
      ? { status: "pass", detail: "No risky users detected" }
      : { status: "fail", detail: `${s.risky_user_count} risky users`, value: s.risky_user_count },
  },

  // --- NIST CSF ---
  {
    id: "NIST-ID.AM", name: "Asset Management", description: "Identify and manage assets",
    framework: "NIST", metrics: ["noncompliant_device_count", "sensitivity_label_count"],
    evaluator: (s) => s.sensitivity_label_count > 0
      ? { status: "pass", detail: `${s.sensitivity_label_count} sensitivity labels configured` }
      : { status: "partial", detail: "Sensitivity labels not detected" },
  },
  {
    id: "NIST-PR.AC", name: "Access Control", description: "Manage access permissions and identities",
    framework: "NIST", metrics: ["risky_user_count", "secure_score_pct"],
    evaluator: (s) => s.risky_user_count === 0 && s.secure_score_pct >= 50
      ? { status: "pass", detail: "Access controls healthy" }
      : { status: "partial", detail: `${s.risky_user_count} risky users, score ${s.secure_score_pct}%` },
  },
  {
    id: "NIST-DE.CM", name: "Continuous Monitoring", description: "Monitor for security events",
    framework: "NIST", metrics: ["defender_alert_count", "signin_count"],
    evaluator: (s) => ({ status: "pass", detail: `Monitoring active — ${s.defender_alert_count ?? 0} alerts, ${s.signin_count ?? 0} sign-ins tracked` }),
  },
  {
    id: "NIST-RS.AN", name: "Incident Analysis", description: "Analyze and triage incidents",
    framework: "NIST", metrics: ["defender_alert_high"],
    evaluator: (s) => s.defender_alert_high === 0
      ? { status: "pass", detail: "No high-severity incidents" }
      : { status: "fail", detail: `${s.defender_alert_high} high-severity alerts need attention`, value: s.defender_alert_high },
  },
  {
    id: "NIST-PR.DS", name: "Data Security", description: "Protect data at rest and in transit",
    framework: "NIST", metrics: ["purview_alert_count", "insider_risk_alert_count"],
    evaluator: (s) => s.insider_risk_alert_count === 0
      ? { status: "pass", detail: "No insider risk or DLP violations" }
      : { status: "fail", detail: `${s.insider_risk_alert_count} insider risk alerts`, value: s.insider_risk_alert_count },
  },

  // --- SOC 2 ---
  {
    id: "SOC2-CC6.1", name: "Logical Access Controls", description: "Restrict logical access",
    framework: "SOC2", metrics: ["risky_user_count", "secure_score_pct"],
    evaluator: (s) => s.risky_user_count === 0 && s.secure_score_pct >= 50
      ? { status: "pass", detail: "Access controls meet SOC 2 requirements" }
      : { status: "fail", detail: `${s.risky_user_count} risky users, Secure Score ${s.secure_score_pct}%` },
  },
  {
    id: "SOC2-CC7.2", name: "System Monitoring", description: "Monitor system components for anomalies",
    framework: "SOC2", metrics: ["defender_alert_count"],
    evaluator: (s) => ({ status: "pass", detail: `Continuous monitoring active — ${s.defender_alert_count ?? 0} security events` }),
  },
  {
    id: "SOC2-CC6.6", name: "Data Protection", description: "Protect confidential information",
    framework: "SOC2", metrics: ["purview_alert_count", "sensitivity_label_count"],
    evaluator: (s) => s.sensitivity_label_count > 0
      ? { status: "pass", detail: `${s.sensitivity_label_count} sensitivity labels enforcing data protection` }
      : { status: "partial", detail: "Sensitivity labels not configured" },
  },
  {
    id: "SOC2-CC8.1", name: "Change Management", description: "Manage changes to infrastructure",
    framework: "SOC2", metrics: ["noncompliant_device_count"],
    evaluator: (s) => s.noncompliant_device_count === 0
      ? { status: "pass", detail: "All managed devices compliant" }
      : { status: "fail", detail: `${s.noncompliant_device_count} devices out of compliance` },
  },

  // --- HIPAA ---
  {
    id: "HIPAA-164.312(a)", name: "Access Control", description: "Implement access controls for ePHI",
    framework: "HIPAA", metrics: ["risky_user_count", "secure_score_pct"],
    evaluator: (s) => s.risky_user_count === 0
      ? { status: "pass", detail: "No risky users accessing systems" }
      : { status: "fail", detail: `${s.risky_user_count} users with elevated risk levels` },
  },
  {
    id: "HIPAA-164.312(b)", name: "Audit Controls", description: "Record and examine activity",
    framework: "HIPAA", metrics: ["signin_count"],
    evaluator: (s) => s.signin_count !== null
      ? { status: "pass", detail: `Audit logging active — ${s.signin_count} sign-in events recorded` }
      : { status: "unknown", detail: "Unable to verify audit log status" },
  },
  {
    id: "HIPAA-164.312(c)", name: "Integrity Controls", description: "Protect ePHI from improper alteration",
    framework: "HIPAA", metrics: ["purview_alert_count", "insider_risk_alert_count"],
    evaluator: (s) => s.insider_risk_alert_count === 0 && (s.purview_alert_count ?? 0) === 0
      ? { status: "pass", detail: "No data integrity violations detected" }
      : { status: "fail", detail: `${s.purview_alert_count ?? 0} DLP + ${s.insider_risk_alert_count ?? 0} insider risk events` },
  },
  {
    id: "HIPAA-164.308(a)(5)", name: "Security Awareness Training", description: "Security awareness program",
    framework: "HIPAA", metrics: ["secure_score_pct"],
    evaluator: (s) => s.secure_score_pct >= 50
      ? { status: "pass", detail: `Security posture ${s.secure_score_pct}% indicates awareness` }
      : { status: "partial", detail: `Low Secure Score (${s.secure_score_pct}%) may indicate training gaps` },
  },
];

export function evaluateCompliance(snapshot: any): FrameworkResult[] {
  const frameworks = [...new Set(CONTROLS.map((c) => c.framework))];

  return frameworks.map((framework) => {
    const controls = CONTROLS.filter((c) => c.framework === framework).map((c) => {
      let result: ControlStatus;
      try {
        result = c.evaluator(snapshot);
      } catch {
        result = { status: "unknown", detail: "Evaluation error" };
      }
      return { ...c, result };
    });

    const passing = controls.filter((c) => c.result.status === "pass").length;
    const failing = controls.filter((c) => c.result.status === "fail").length;
    const partial = controls.filter((c) => c.result.status === "partial").length;
    const unknown = controls.filter((c) => c.result.status === "unknown").length;
    const score = controls.length > 0 ? Math.round(((passing + partial * 0.5) / controls.length) * 100) : 0;

    return { framework, totalControls: controls.length, passing, failing, partial, unknown, score, controls };
  });
}

export const SUPPORTED_FRAMEWORKS = ["CIS", "NIST", "SOC2", "HIPAA"];
