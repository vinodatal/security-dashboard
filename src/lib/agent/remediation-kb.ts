/**
 * Remediation Knowledge Base — per-tool Microsoft Learn doc references,
 * proven fix scripts, and remediation patterns for the workflow analysis agent.
 */

export interface RemediationEntry {
  tool: string;
  findingPatterns: FindingPattern[];
  docs: DocLink[];
}

export interface FindingPattern {
  signal: string;
  severity: "critical" | "high" | "medium" | "low";
  remediation: string;
  scripts: RemediationScript[];
  verification: string;
}

export interface RemediationScript {
  type: "azure-cli" | "powershell" | "graph-api" | "portal";
  label: string;
  command: string;
}

export interface DocLink {
  title: string;
  url: string;
}

export const REMEDIATION_KB: RemediationEntry[] = [
  // ─── Identity & Access ────────────────────────────────────────────────────
  {
    tool: "detect_privileged_user_risks",
    findingPatterns: [
      {
        signal: "Admin account without MFA",
        severity: "critical",
        remediation: "Enforce MFA registration for all privileged accounts. Use Conditional Access to require MFA for admin roles.",
        scripts: [
          {
            type: "azure-cli",
            label: "Create CA policy requiring MFA for admins",
            command: `az rest --method POST --url "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies" --body '{"displayName":"Require MFA for Admins","state":"enabled","conditions":{"users":{"includeRoles":["62e90394-69f5-4237-9190-012177145e10"]},"applications":{"includeApplications":["All"]}},"grantControls":{"operator":"OR","builtInControls":["mfa"]}}'`,
          },
          {
            type: "powershell",
            label: "Check MFA registration status",
            command: `Connect-MgGraph -Scopes "UserAuthenticationMethod.Read.All"\nGet-MgUserAuthenticationMethod -UserId "<UPN>" | Select-Object AdditionalProperties`,
          },
        ],
        verification: `az rest --method GET --url "https://graph.microsoft.com/v1.0/users/<UPN>/authentication/methods" | jq '.value[].\\\"@odata.type\\\"'`,
      },
      {
        signal: "Stale admin account (no sign-in 30+ days)",
        severity: "high",
        remediation: "Disable or remove stale privileged accounts. Review if the account is a service account before disabling.",
        scripts: [
          {
            type: "azure-cli",
            label: "Disable stale admin account",
            command: `az ad user update --id "<UPN>" --account-enabled false`,
          },
          {
            type: "azure-cli",
            label: "Remove role assignment",
            command: `az rest --method DELETE --url "https://graph.microsoft.com/v1.0/directoryRoles/<ROLE_ID>/members/<USER_ID>/\\$ref"`,
          },
        ],
        verification: `az ad user show --id "<UPN>" --query "accountEnabled"`,
      },
      {
        signal: "Excessive role assignments (3+ privileged roles)",
        severity: "high",
        remediation: "Apply least-privilege: remove unnecessary roles. Use PIM for just-in-time elevation instead of permanent assignments.",
        scripts: [
          {
            type: "azure-cli",
            label: "List user role assignments",
            command: `az rest --method GET --url "https://graph.microsoft.com/v1.0/users/<UPN>/memberOf?\\$filter=isof('microsoft.graph.directoryRole')" --query "value[].displayName"`,
          },
          {
            type: "powershell",
            label: "Enable PIM for a role",
            command: `Connect-MgGraph -Scopes "RoleManagement.ReadWrite.Directory"\nNew-MgRoleManagementDirectoryRoleEligibilityScheduleRequest -Action "AdminAssign" -DirectoryScopeId "/" -PrincipalId "<USER_OID>" -RoleDefinitionId "<ROLE_ID>" -ScheduleInfo @{Expiration=@{Type="AfterDuration";Duration="PT8H"}}`,
          },
        ],
        verification: `az rest --method GET --url "https://graph.microsoft.com/v1.0/users/<UPN>/memberOf" --query "value[?\\\"@odata.type\\\"=='#microsoft.graph.directoryRole'].displayName"`,
      },
    ],
    docs: [
      { title: "Securing privileged access", url: "https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/security-planning" },
      { title: "Conditional Access: Require MFA for admins", url: "https://learn.microsoft.com/en-us/entra/identity/conditional-access/howto-conditional-access-policy-admin-mfa" },
      { title: "Privileged Identity Management", url: "https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-configure" },
    ],
  },

  {
    tool: "get_entra_risky_users",
    findingPatterns: [
      {
        signal: "User flagged as high risk",
        severity: "critical",
        remediation: "Confirm compromise: revoke sessions, reset password, require MFA re-registration. Investigate sign-in logs for attacker activity.",
        scripts: [
          {
            type: "azure-cli",
            label: "Revoke all user sessions",
            command: `az rest --method POST --url "https://graph.microsoft.com/v1.0/users/<UPN>/revokeSignInSessions"`,
          },
          {
            type: "azure-cli",
            label: "Reset user password",
            command: `az ad user update --id "<UPN>" --password "<NEW_RANDOM_PASSWORD>" --force-change-password-next-sign-in true`,
          },
          {
            type: "azure-cli",
            label: "Dismiss risk (after remediation)",
            command: `az rest --method POST --url "https://graph.microsoft.com/v1.0/identityProtection/riskyUsers/dismiss" --body '{"userIds":["<USER_OID>"]}'`,
          },
        ],
        verification: `az rest --method GET --url "https://graph.microsoft.com/v1.0/identityProtection/riskyUsers?\\$filter=userPrincipalName eq '<UPN>'" --query "value[0].riskLevel"`,
      },
    ],
    docs: [
      { title: "Investigate risk with Identity Protection", url: "https://learn.microsoft.com/en-us/entra/id-protection/howto-identity-protection-investigate-risk" },
      { title: "Remediate risks and unblock users", url: "https://learn.microsoft.com/en-us/entra/id-protection/howto-identity-protection-remediate-unblock" },
    ],
  },

  {
    tool: "get_entra_signin_logs",
    findingPatterns: [
      {
        signal: "Sign-ins from unfamiliar locations or impossible travel",
        severity: "high",
        remediation: "Investigate sign-in source. Block suspicious locations via Conditional Access named locations.",
        scripts: [
          {
            type: "azure-cli",
            label: "Create named location to block a country",
            command: `az rest --method POST --url "https://graph.microsoft.com/v1.0/identity/conditionalAccess/namedLocations" --body '{"@odata.type":"#microsoft.graph.countryNamedLocation","displayName":"Blocked Countries","countriesAndRegions":["XX"],"includeUnknownCountriesAndRegions":false}'`,
          },
        ],
        verification: `az rest --method GET --url "https://graph.microsoft.com/v1.0/identity/conditionalAccess/namedLocations" --query "value[].displayName"`,
      },
      {
        signal: "Sign-ins without Conditional Access applied",
        severity: "medium",
        remediation: "Review CA policy coverage. Ensure all users and applications are covered by at least one CA policy.",
        scripts: [
          {
            type: "azure-cli",
            label: "List all Conditional Access policies",
            command: `az rest --method GET --url "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies" --query "value[].{name:displayName, state:state, users:conditions.users.includeUsers}"`,
          },
        ],
        verification: `az rest --method GET --url "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies" --query "length(value[?state=='enabled'])"`,
      },
    ],
    docs: [
      { title: "Sign-in logs in Entra ID", url: "https://learn.microsoft.com/en-us/entra/identity/monitoring-health/concept-sign-ins" },
      { title: "Conditional Access policies", url: "https://learn.microsoft.com/en-us/entra/identity/conditional-access/overview" },
    ],
  },

  // ─── Defender & Alerts ────────────────────────────────────────────────────
  {
    tool: "get_defender_alerts",
    findingPatterns: [
      {
        signal: "High/critical severity alerts",
        severity: "critical",
        remediation: "Triage each alert: investigate entities (users, devices, IPs), check threat intelligence, contain if confirmed compromise.",
        scripts: [
          {
            type: "azure-cli",
            label: "Get alert details",
            command: `az rest --method GET --url "https://graph.microsoft.com/v1.0/security/alerts_v2/<ALERT_ID>"`,
          },
          {
            type: "azure-cli",
            label: "Update alert status to inProgress",
            command: `az rest --method PATCH --url "https://graph.microsoft.com/v1.0/security/alerts_v2/<ALERT_ID>" --body '{"status":"inProgress","assignedTo":"<YOUR_UPN>"}'`,
          },
        ],
        verification: `az rest --method GET --url "https://graph.microsoft.com/v1.0/security/alerts_v2?\\$filter=severity eq 'high' and status eq 'new'&\\$count=true" --query "@odata.count"`,
      },
    ],
    docs: [
      { title: "Manage security alerts", url: "https://learn.microsoft.com/en-us/microsoft-365/security/defender/investigate-alerts" },
      { title: "Microsoft Defender XDR alerts", url: "https://learn.microsoft.com/en-us/microsoft-365/security/defender/alerts-queue" },
    ],
  },

  {
    tool: "get_secure_score",
    findingPatterns: [
      {
        signal: "Secure Score below 50%",
        severity: "high",
        remediation: "Focus on the top improvement actions by score impact. Quick wins: enable MFA for all users, enable audit logging, disable legacy auth.",
        scripts: [
          {
            type: "azure-cli",
            label: "Get top improvement actions",
            command: `az rest --method GET --url "https://graph.microsoft.com/v1.0/security/secureScores?\\$top=1" --query "value[0].controlScores[?scoreInPercentage < 100].{control:controlName, current:scoreInPercentage, category:controlCategory}" --output table`,
          },
          {
            type: "azure-cli",
            label: "Block legacy authentication",
            command: `az rest --method POST --url "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies" --body '{"displayName":"Block Legacy Auth","state":"enabled","conditions":{"users":{"includeUsers":["All"]},"applications":{"includeApplications":["All"]},"clientAppTypes":["exchangeActiveSync","other"]},"grantControls":{"operator":"OR","builtInControls":["block"]}}'`,
          },
        ],
        verification: `az rest --method GET --url "https://graph.microsoft.com/v1.0/security/secureScores?\\$top=1" --query "value[0].{current:currentScore, max:maxScore, pct:percentageScore}"`,
      },
    ],
    docs: [
      { title: "Microsoft Secure Score", url: "https://learn.microsoft.com/en-us/microsoft-365/security/defender/microsoft-secure-score" },
      { title: "Secure Score improvement actions", url: "https://learn.microsoft.com/en-us/microsoft-365/security/defender/microsoft-secure-score-improvement-actions" },
    ],
  },

  // ─── Device & Compliance ──────────────────────────────────────────────────
  {
    tool: "get_intune_devices",
    findingPatterns: [
      {
        signal: "Non-compliant devices",
        severity: "medium",
        remediation: "Review compliance policy failures per device. Common issues: OS version out of date, encryption disabled, no PIN. Push compliance notification to device owners.",
        scripts: [
          {
            type: "powershell",
            label: "Sync device to re-evaluate compliance",
            command: `Connect-MgGraph -Scopes "DeviceManagementManagedDevices.ReadWrite.All"\nSync-MgDeviceManagementManagedDevice -ManagedDeviceId "<DEVICE_ID>"`,
          },
          {
            type: "azure-cli",
            label: "Get device compliance details",
            command: `az rest --method GET --url "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/<DEVICE_ID>/deviceCompliancePolicyStates"`,
          },
        ],
        verification: `az rest --method GET --url "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?\\$filter=complianceState eq 'noncompliant'&\\$count=true" --query "@odata.count"`,
      },
    ],
    docs: [
      { title: "Device compliance policies", url: "https://learn.microsoft.com/en-us/mem/intune/protect/device-compliance-get-started" },
      { title: "Monitor device compliance", url: "https://learn.microsoft.com/en-us/mem/intune/protect/compliance-policy-monitor" },
    ],
  },

  // ─── Data Protection ──────────────────────────────────────────────────────
  {
    tool: "get_purview_alerts",
    findingPatterns: [
      {
        signal: "DLP policy violations",
        severity: "medium",
        remediation: "Review the matched sensitive information types and affected users. Check if data was actually exfiltrated or just detected. Update DLP policies if false positives are high.",
        scripts: [
          {
            type: "azure-cli",
            label: "Get DLP alert details",
            command: `az rest --method GET --url "https://graph.microsoft.com/v1.0/security/alerts_v2/<ALERT_ID>"`,
          },
        ],
        verification: `az rest --method GET --url "https://graph.microsoft.com/v1.0/security/alerts_v2?\\$filter=serviceSource eq 'dataLossPrevention' and status eq 'new'&\\$count=true" --query "@odata.count"`,
      },
    ],
    docs: [
      { title: "Data Loss Prevention overview", url: "https://learn.microsoft.com/en-us/purview/dlp-learn-about-dlp" },
      { title: "View DLP alerts", url: "https://learn.microsoft.com/en-us/purview/dlp-alerts-dashboard-learn" },
    ],
  },

  {
    tool: "triage_dlp_alerts",
    findingPatterns: [
      {
        signal: "High-risk DLP alerts needing attention",
        severity: "high",
        remediation: "Prioritize alerts by risk score. For confirmed data leaks: revoke sharing, notify data owner, escalate to privacy team if PII involved.",
        scripts: [
          {
            type: "powershell",
            label: "Revoke external sharing on a file",
            command: `Connect-PnPOnline -Url "https://<tenant>.sharepoint.com/sites/<site>" -Interactive\nSet-PnPFile -Url "<FILE_PATH>" -SharingCapability "Disabled"`,
          },
        ],
        verification: `# Re-run triage_dlp_alerts to confirm alert count decreased`,
      },
    ],
    docs: [
      { title: "Investigate DLP alerts", url: "https://learn.microsoft.com/en-us/purview/dlp-investigate-alerts" },
    ],
  },

  // ─── Infrastructure ───────────────────────────────────────────────────────
  {
    tool: "check_infra_security",
    findingPatterns: [
      {
        signal: "Open management ports (RDP/SSH exposed to internet)",
        severity: "critical",
        remediation: "Restrict management port access to known IP ranges or use Azure Bastion. Never expose RDP (3389) or SSH (22) to 0.0.0.0/0.",
        scripts: [
          {
            type: "azure-cli",
            label: "Restrict NSG rule to specific IP",
            command: `az network nsg rule update --nsg-name <NSG_NAME> --resource-group <RG> --name <RULE_NAME> --source-address-prefixes <YOUR_IP>/32`,
          },
          {
            type: "azure-cli",
            label: "Deploy Azure Bastion (recommended)",
            command: `az network bastion create --name MyBastion --resource-group <RG> --vnet-name <VNET> --public-ip-address <PIP_NAME> --sku Standard`,
          },
        ],
        verification: `az network nsg rule list --nsg-name <NSG_NAME> --resource-group <RG> --query "[?destinationPortRange=='3389' || destinationPortRange=='22'].{name:name, source:sourceAddressPrefix, access:access}" --output table`,
      },
      {
        signal: "Unencrypted storage accounts",
        severity: "high",
        remediation: "Enable HTTPS-only traffic and enforce TLS 1.2 minimum on all storage accounts.",
        scripts: [
          {
            type: "azure-cli",
            label: "Enforce HTTPS on storage account",
            command: `az storage account update --name <STORAGE_NAME> --resource-group <RG> --https-only true --min-tls-version TLS1_2`,
          },
        ],
        verification: `az storage account show --name <STORAGE_NAME> --resource-group <RG> --query "{httpsOnly:enableHttpsTrafficOnly, minTls:minimumTlsVersion}"`,
      },
    ],
    docs: [
      { title: "Azure network security best practices", url: "https://learn.microsoft.com/en-us/azure/security/fundamentals/network-best-practices" },
      { title: "Azure Bastion", url: "https://learn.microsoft.com/en-us/azure/bastion/bastion-overview" },
      { title: "Azure Storage security", url: "https://learn.microsoft.com/en-us/azure/storage/common/storage-security-guide" },
    ],
  },

  {
    tool: "get_security_recommendations",
    findingPatterns: [
      {
        signal: "Unimplemented security recommendations",
        severity: "medium",
        remediation: "Review recommendations sorted by score impact. Implement those with high max score first for biggest posture improvement.",
        scripts: [
          {
            type: "azure-cli",
            label: "List recommendations by impact",
            command: `az rest --method GET --url "https://graph.microsoft.com/v1.0/security/secureScores?\\$top=1" --query "value[0].controlScores | sort_by(@, &maxScore) | reverse(@) | [:10].{control:controlName, max:maxScore, current:scoreInPercentage}"`,
          },
        ],
        verification: `# Re-run get_secure_score to check if score improved`,
      },
    ],
    docs: [
      { title: "Secure Score improvement actions", url: "https://learn.microsoft.com/en-us/microsoft-365/security/defender/microsoft-secure-score-improvement-actions" },
    ],
  },

  // ─── Threat Intelligence & Hunting ────────────────────────────────────────
  {
    tool: "run_hunting_query",
    findingPatterns: [
      {
        signal: "Suspicious process or lateral movement detected",
        severity: "high",
        remediation: "Isolate affected devices, investigate the process chain, check for persistence mechanisms, and block malicious hashes.",
        scripts: [
          {
            type: "azure-cli",
            label: "Isolate a device via Defender",
            command: `az rest --method POST --url "https://graph.microsoft.com/v1.0/security/alerts_v2/<ALERT_ID>/comments" --body '{"comment":"Isolating device for investigation"}'`,
          },
        ],
        verification: `# Run the same hunting query again to verify no new activity`,
      },
    ],
    docs: [
      { title: "Advanced hunting overview", url: "https://learn.microsoft.com/en-us/microsoft-365/security/defender/advanced-hunting-overview" },
      { title: "Advanced hunting query best practices", url: "https://learn.microsoft.com/en-us/microsoft-365/security/defender/advanced-hunting-best-practices" },
    ],
  },

  {
    tool: "lookup_threat_intel",
    findingPatterns: [
      {
        signal: "Indicators with known malicious reputation",
        severity: "critical",
        remediation: "Block the indicators across the environment: add to Defender indicator block list, update firewall rules, search for related activity in logs.",
        scripts: [
          {
            type: "azure-cli",
            label: "Add IoC to Defender block list",
            command: `az rest --method POST --url "https://graph.microsoft.com/beta/security/tiIndicators" --body '{"action":"block","description":"Blocked by workflow","targetProduct":"Azure Sentinel","threatType":"Malware","tlpLevel":"white","<TYPE>":"<VALUE>"}'`,
          },
        ],
        verification: `# Re-run lookup_threat_intel to confirm indicators are now blocked`,
      },
    ],
    docs: [
      { title: "Microsoft threat intelligence", url: "https://learn.microsoft.com/en-us/microsoft-365/security/defender/microsoft-365-security-center-defender-threat-intelligence" },
    ],
  },
];

/**
 * Get relevant remediation context for a set of tools.
 * Returns a formatted string suitable for inclusion in an LLM prompt.
 */
export function getRemediationContext(toolNames: string[]): string {
  const toolSet = new Set(toolNames);
  const relevant = REMEDIATION_KB.filter((e) => toolSet.has(e.tool));

  if (relevant.length === 0) return "";

  let ctx = "\n\n## Remediation Knowledge Base\n";
  ctx += "Use these proven remediation patterns and exact commands when creating the remediation plan:\n\n";

  for (const entry of relevant) {
    ctx += `### ${entry.tool}\n`;
    for (const fp of entry.findingPatterns) {
      ctx += `**Signal:** ${fp.signal} (${fp.severity})\n`;
      ctx += `**Fix:** ${fp.remediation}\n`;
      for (const script of fp.scripts) {
        ctx += `- ${script.label} (${script.type}):\n\`\`\`\n${script.command}\n\`\`\`\n`;
      }
      ctx += `**Verify:** \`${fp.verification}\`\n\n`;
    }
    ctx += `**Docs:**\n`;
    for (const doc of entry.docs) {
      ctx += `- [${doc.title}](${doc.url})\n`;
    }
    ctx += "\n";
  }

  return ctx;
}

/**
 * Get doc links for a set of tools.
 */
export function getDocLinks(toolNames: string[]): DocLink[] {
  const toolSet = new Set(toolNames);
  const links: DocLink[] = [];
  for (const entry of REMEDIATION_KB.filter((e) => toolSet.has(e.tool))) {
    links.push(...entry.docs);
  }
  return links;
}
