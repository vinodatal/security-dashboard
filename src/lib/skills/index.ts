/**
 * Skill Package System — types, loader, context builder, and built-in skills.
 *
 * A "skill" is a structured knowledge pack that can contain:
 * - KQL queries for threat hunting
 * - Investigation instructions (LLM guidance)
 * - Remediation scripts (Azure CLI / PowerShell)
 * - Workflow definitions
 * - Detection rule templates
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SkillPackage {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  tags: string[];
  author?: string;
  version?: string;
  queries?: SkillQuery[];
  instructions?: string;
  remediation?: SkillRemediation[];
  workflowDefinition?: Record<string, unknown>;
  detectionRules?: SkillDetectionRule[];
  requiredTools?: string[];
  requiredLicenses?: string[];
  applicableWorkflows?: string[];
  source?: "built-in" | "uploaded" | "nl-generated";
  createdAt?: string;
}

export type SkillCategory =
  | "threat-hunting"
  | "incident-response"
  | "compliance"
  | "identity-security"
  | "data-protection"
  | "infrastructure"
  | "detection"
  | "remediation"
  | "general";

export interface SkillQuery {
  id: string;
  name: string;
  description: string;
  query: string;
  target: "defender" | "sentinel";
  mitreTactics?: string[];
  mitreTechniques?: string[];
}

export interface SkillRemediation {
  finding: string;
  severity: "critical" | "high" | "medium" | "low";
  description: string;
  scripts: Array<{
    type: "azure-cli" | "powershell" | "graph-api" | "portal";
    label: string;
    command: string;
  }>;
  verification?: string;
  docUrl?: string;
}

export interface SkillDetectionRule {
  name: string;
  description: string;
  severity: "high" | "medium" | "low" | "informational";
  query: string;
  tactics?: string[];
  techniques?: string[];
}

// ─── Context Builder ────────────────────────────────────────────────────────

export function buildSkillContext(skills: SkillPackage[]): string {
  if (skills.length === 0) return "";

  let ctx = "\n\n## Expert Skills Applied\n";
  ctx += `${skills.length} specialized skill(s) loaded. Use their queries, guidance, and scripts when relevant.\n\n`;

  for (const skill of skills) {
    ctx += `### 📦 ${skill.name}\n`;
    ctx += `${skill.description}\n\n`;

    if (skill.queries && skill.queries.length > 0) {
      ctx += "**Hunting Queries** — execute via `run_hunting_query` or `query_sentinel`:\n\n";
      for (const q of skill.queries) {
        ctx += `#### ${q.name}\n${q.description}\n`;
        if (q.mitreTactics?.length) ctx += `MITRE: ${q.mitreTactics.join(", ")}\n`;
        ctx += "```kql\n" + q.query + "\n```\n\n";
      }
    }

    if (skill.instructions) {
      ctx += "**Investigation Guidance:**\n\n" + skill.instructions + "\n\n";
    }

    if (skill.remediation && skill.remediation.length > 0) {
      ctx += "**Remediation Scripts:**\n\n";
      for (const r of skill.remediation) {
        ctx += `**${r.finding}** (${r.severity}): ${r.description}\n`;
        for (const s of r.scripts) {
          ctx += `\`\`\`${s.type === "azure-cli" ? "bash" : s.type}\n${s.command}\n\`\`\`\n`;
        }
        if (r.docUrl) ctx += `Docs: ${r.docUrl}\n`;
        ctx += "\n";
      }
    }

    if (skill.detectionRules && skill.detectionRules.length > 0) {
      ctx += "**Detection Rules** (deploy to Sentinel):\n\n";
      for (const rule of skill.detectionRules) {
        ctx += `- **${rule.name}** (${rule.severity}): ${rule.description}\n`;
        ctx += `  \`\`\`kql\n  ${rule.query}\n  \`\`\`\n`;
      }
      ctx += "\n";
    }
  }

  return ctx;
}

export function selectRelevantSkills(
  allSkills: SkillPackage[],
  context: {
    workflowId?: string;
    toolNames?: string[];
    category?: string;
    tags?: string[];
  }
): SkillPackage[] {
  return allSkills.filter((skill) => {
    if (context.workflowId && skill.applicableWorkflows?.includes(context.workflowId)) return true;
    if (context.toolNames && skill.requiredTools?.some((t) => context.toolNames!.includes(t))) return true;
    if (context.category) {
      const catMap: Record<string, string[]> = {
        "incident-response": ["threat-hunting", "incident-response", "detection"],
        "identity-access": ["identity-security", "remediation"],
        "compliance-posture": ["compliance", "infrastructure"],
        "device-endpoint": ["compliance", "remediation"],
        "data-protection": ["data-protection", "compliance"],
        "reporting": ["general"],
      };
      if ((catMap[context.category] ?? []).includes(skill.category)) return true;
    }
    if (context.tags && (skill.tags ?? []).some((t) => context.tags!.includes(t))) return true;
    return false;
  });
}

// ─── Built-in Skills ────────────────────────────────────────────────────────

export const BUILT_IN_SKILLS: SkillPackage[] = [
  {
    id: "credential-theft-hunting",
    name: "Credential Theft Detection",
    description: "KQL queries and investigation guidance for detecting credential theft: credential dumping, pass-the-hash, Kerberoasting.",
    category: "threat-hunting",
    tags: ["credentials", "mimikatz", "kerberos", "lateral-movement"],
    requiredTools: ["run_hunting_query"],
    requiredLicenses: ["defender"],
    applicableWorkflows: ["threat-hunt-report", "investigate-incident"],
    source: "built-in",
    queries: [
      {
        id: "cred-dump-processes",
        name: "Credential Dumping Processes",
        description: "Detect Mimikatz, ProcDump targeting LSASS, and comsvcs.dll abuse",
        query: `DeviceProcessEvents
| where Timestamp > ago(7d)
| where FileName in~ ("mimikatz.exe", "procdump.exe", "procdump64.exe")
    or (FileName =~ "rundll32.exe" and ProcessCommandLine has "comsvcs.dll")
    or (ProcessCommandLine has "sekurlsa" or ProcessCommandLine has "lsadump")
| project Timestamp, DeviceName, FileName, ProcessCommandLine, AccountName
| order by Timestamp desc`,
        target: "defender",
        mitreTactics: ["Credential Access"],
        mitreTechniques: ["T1003.001", "T1003.002"],
      },
      {
        id: "kerberoasting",
        name: "Kerberoasting Activity",
        description: "Detect TGS requests for service accounts indicating Kerberoasting",
        query: `IdentityQueryEvents
| where Timestamp > ago(7d)
| where ActionType == "LDAP query"
| where QueryTarget has "servicePrincipalName"
| project Timestamp, DeviceName, AccountName, QueryType, QueryTarget
| order by Timestamp desc`,
        target: "defender",
        mitreTactics: ["Credential Access"],
        mitreTechniques: ["T1558.003"],
      },
    ],
    instructions: `Credential theft investigation steps:
1. Run all KQL queries to identify scope of compromise
2. For each affected account: check roles, MFA status, recent sign-ins
3. Look for lateral movement: same account on multiple devices
4. Check if service accounts were targeted (Kerberoasting)
5. Establish timeline of first suspicious activity
6. Determine if domain admin credentials were compromised`,
    remediation: [
      {
        finding: "Credential dumping tool detected",
        severity: "critical",
        description: "Isolate affected device, reset all accessible credentials",
        scripts: [
          { type: "azure-cli", label: "Revoke user sessions", command: `az rest --method POST --url "https://graph.microsoft.com/v1.0/users/<UPN>/revokeSignInSessions"` },
          { type: "azure-cli", label: "Force password reset", command: `az ad user update --id "<UPN>" --password "<RANDOM>" --force-change-password-next-sign-in true` },
        ],
        verification: `az rest --method GET --url "https://graph.microsoft.com/v1.0/users/<UPN>/authentication/methods"`,
        docUrl: "https://learn.microsoft.com/en-us/defender-for-identity/credential-access-alerts",
      },
    ],
  },

  {
    id: "ransomware-indicators",
    name: "Ransomware Indicators",
    description: "KQL queries to detect ransomware precursor activity: mass file encryption, shadow copy deletion, ransom notes.",
    category: "threat-hunting",
    tags: ["ransomware", "encryption", "shadow-copy"],
    requiredTools: ["run_hunting_query"],
    requiredLicenses: ["defender"],
    applicableWorkflows: ["ransomware-containment", "threat-hunt-report", "alert-triage"],
    source: "built-in",
    queries: [
      {
        id: "mass-file-rename",
        name: "Mass File Encryption / Rename",
        description: "Detect rapid file modifications suggesting encryption",
        query: `DeviceFileEvents
| where Timestamp > ago(24h)
| where ActionType in ("FileRenamed", "FileModified")
| summarize FileCount=count() by DeviceName, InitiatingProcessFileName, bin(Timestamp, 5m)
| where FileCount > 100
| order by FileCount desc`,
        target: "defender",
        mitreTactics: ["Impact"],
        mitreTechniques: ["T1486"],
      },
      {
        id: "shadow-copy-deletion",
        name: "Shadow Copy Deletion",
        description: "Detect volume shadow copy deletion (common ransomware precursor)",
        query: `DeviceProcessEvents
| where Timestamp > ago(7d)
| where (FileName =~ "vssadmin.exe" and ProcessCommandLine has "delete shadows")
    or (FileName =~ "wmic.exe" and ProcessCommandLine has "shadowcopy delete")
| project Timestamp, DeviceName, FileName, ProcessCommandLine, AccountName`,
        target: "defender",
        mitreTactics: ["Impact"],
        mitreTechniques: ["T1490"],
      },
    ],
    instructions: `Ransomware investigation priority:
1. IMMEDIATE: Isolate affected devices from network
2. Shadow copy deletion = ransomware deployment imminent or active
3. Mass file rename = identify blast radius (devices + file count)
4. Identify patient zero: first device with signs
5. Do NOT restart affected devices (may trigger delayed encryption)`,
  },

  {
    id: "entra-identity-hardening",
    name: "Entra ID Identity Hardening",
    description: "Best practices and scripts for hardening Entra ID: Conditional Access, MFA, legacy auth blocking, PIM.",
    category: "identity-security",
    tags: ["mfa", "conditional-access", "pim", "legacy-auth", "hardening"],
    requiredTools: ["get_entra_user_details", "get_entra_signin_logs", "detect_privileged_user_risks"],
    applicableWorkflows: ["privileged-access-review", "user-risk-assessment", "compliance-assessment"],
    source: "built-in",
    instructions: `Identity hardening priority:
1. Block legacy authentication — single biggest risk reduction
2. Require MFA for all admins — non-negotiable
3. Enable PIM for admin roles — just-in-time vs standing access
4. Require compliant devices — prevent unmanaged endpoint access
5. Block risky sign-ins — CA with Identity Protection
6. Review app consent — audit overprivileged enterprise apps`,
    remediation: [
      {
        finding: "Legacy authentication not blocked",
        severity: "high",
        description: "Legacy auth bypasses MFA. Block via Conditional Access.",
        scripts: [
          {
            type: "azure-cli",
            label: "Block legacy auth CA policy",
            command: `az rest --method POST --url "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies" --body '{"displayName":"Block Legacy Auth","state":"enabled","conditions":{"users":{"includeUsers":["All"]},"applications":{"includeApplications":["All"]},"clientAppTypes":["exchangeActiveSync","other"]},"grantControls":{"operator":"OR","builtInControls":["block"]}}'`,
          },
        ],
        verification: `az rest --method GET --url "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies" --query "value[?displayName=='Block Legacy Auth'].state"`,
        docUrl: "https://learn.microsoft.com/en-us/entra/identity/conditional-access/howto-conditional-access-policy-block-legacy",
      },
    ],
  },

  {
    id: "dlp-investigation-pack",
    name: "DLP Investigation Pack",
    description: "Queries and procedures for DLP incidents: file sharing audit, sensitivity labels, external sharing detection.",
    category: "data-protection",
    tags: ["dlp", "data-loss", "sensitivity-labels", "external-sharing"],
    requiredTools: ["search_purview_audit", "get_purview_alerts", "triage_dlp_alerts"],
    requiredLicenses: ["purview"],
    applicableWorkflows: ["dlp-triage", "insider-threat-investigation", "data-security-posture"],
    source: "built-in",
    queries: [
      {
        id: "external-file-shares",
        name: "External File Sharing Activity",
        description: "Detect files shared externally via SharePoint/OneDrive",
        query: `CloudAppEvents
| where Timestamp > ago(7d)
| where ActionType in ("SharingSet", "AnonymousLinkCreated")
| where RawEventData has "External" or RawEventData has "Anonymous"
| summarize ShareCount=count(), UniqueFiles=dcount(ObjectName) by AccountObjectId, Application
| where ShareCount > 5
| order by ShareCount desc`,
        target: "defender",
        mitreTactics: ["Exfiltration"],
        mitreTechniques: ["T1567"],
      },
    ],
    instructions: `DLP investigation procedure:
1. Identify user and their role — is this normal for their job?
2. Check what data was exposed: sensitivity label, SIT matches
3. Check sharing scope: internal, specific external, or anonymous link?
4. Check user's activity timeline: one-time or pattern?
5. Cross-reference with sign-in logs: suspicious sign-ins before DLP event?
6. If confirmed leak: revoke sharing, notify data owner, escalate if PII`,
  },
];
