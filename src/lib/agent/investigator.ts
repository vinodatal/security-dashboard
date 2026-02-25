import { chatCompletion, AgentMessage, AgentTool } from "./llm";
import { callTool, listMcpTools } from "../mcp-client";
import { getTenantCredentials } from "../db/index";
import { decrypt } from "../crypto";

// Cache all tool definitions from MCP
let allToolsCache: Map<string, AgentTool> = new Map();
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

function simplifyParams(schema: any): any {
  if (!schema?.properties) return { type: "object", properties: {} };
  const simplified: any = { type: "object", properties: {} };
  for (const [key, val] of Object.entries(schema.properties as Record<string, any>)) {
    simplified.properties[key] = { type: val.type ?? "string" };
    if (val.description) simplified.properties[key].description = val.description.slice(0, 60);
  }
  if (schema.required) simplified.required = schema.required;
  return simplified;
}

async function loadAllTools(env?: Record<string, string>): Promise<Map<string, AgentTool>> {
  if (allToolsCache.size > 0 && Date.now() - cacheTime < CACHE_TTL) return allToolsCache;

  const mcpTools = await listMcpTools(env);
  allToolsCache = new Map();
  for (const t of mcpTools) {
    if (t.name === "setup_app_registration") continue;
    allToolsCache.set(t.name, {
      type: "function",
      function: {
        name: t.name,
        description: (t.description ?? "").slice(0, 100),
        parameters: simplifyParams(t.inputSchema),
      },
    });
  }
  cacheTime = Date.now();
  return allToolsCache;
}

// Smart routing: map finding context to relevant tools
const TOOL_ROUTES: Record<string, string[]> = {
  // Identity & access
  no_mfa:           ["get_entra_user_details", "get_entra_signin_logs", "get_entra_audit_logs"],
  stale_account:    ["get_entra_user_details", "get_entra_signin_logs", "get_entra_audit_logs"],
  excessive_roles:  ["get_entra_user_details", "get_entra_audit_logs", "detect_privileged_user_risks"],
  risky_user:       ["get_entra_risky_users", "get_entra_user_details", "get_entra_signin_logs"],
  compromised:      ["get_entra_user_details", "get_entra_signin_logs", "get_entra_audit_logs", "get_defender_alerts"],

  // Defender & incidents
  defender:         ["get_defender_alerts", "get_defender_incident", "get_defender_incident_alerts", "run_hunting_query"],
  incident:         ["get_defender_incident", "get_defender_incident_alerts", "get_entra_user_details", "lookup_threat_intel"],
  hunting:          ["run_hunting_query", "get_defender_alerts"],
  threat_intel:     ["lookup_threat_intel", "get_threat_actor_profile", "run_hunting_query"],

  // Data protection
  dlp:              ["get_purview_alerts", "triage_dlp_alerts", "search_purview_audit"],
  purview:          ["get_purview_alerts", "triage_dlp_alerts", "search_purview_audit", "get_data_security_posture"],
  insider_risk:     ["get_insider_risk_alerts", "search_purview_audit", "get_entra_user_details", "get_entra_signin_logs"],
  data_security:    ["get_data_security_posture", "get_purview_sensitive_info_types", "get_purview_alerts"],

  // Device & compliance
  device:           ["get_intune_devices", "get_intune_device_detail", "get_intune_policies", "detect_policy_conflicts"],
  compliance:       ["get_intune_devices", "get_intune_policies", "detect_policy_conflicts"],

  // Posture
  secure_score:     ["get_secure_score", "get_security_recommendations", "check_infra_security"],
  posture:          ["get_secure_score", "get_security_recommendations", "check_infra_security", "query_azure_resources"],
  infrastructure:   ["check_infra_security", "query_azure_resources", "scan_iac_template"],

  // Scanning
  scan:             ["scan_repository", "scan_file", "analyze_script", "scan_iac_template"],
  secrets:          ["scan_repository", "scan_file"],

  // Sentinel
  sentinel:         ["query_sentinel", "get_sentinel_incidents", "list_sentinel_workspaces"],

  // Mitigation verification
  mitigation_verification: ["get_entra_user_details", "get_entra_signin_logs", "get_secure_score", "detect_privileged_user_risks"],
};

// Keywords to match finding detail text to routes
const KEYWORD_ROUTES: Array<{ keywords: string[]; route: string }> = [
  { keywords: ["mfa", "multi-factor", "authenticator"], route: "no_mfa" },
  { keywords: ["stale", "inactive", "last sign-in", "no sign-in"], route: "stale_account" },
  { keywords: ["excessive", "too many roles", "privilege"], route: "excessive_roles" },
  { keywords: ["risky user", "risk level", "at risk"], route: "risky_user" },
  { keywords: ["compromised", "breach", "stolen", "revoke"], route: "compromised" },
  { keywords: ["defender", "alert", "security alert"], route: "defender" },
  { keywords: ["incident"], route: "incident" },
  { keywords: ["hunting", "kql", "advanced hunting"], route: "hunting" },
  { keywords: ["threat intel", "indicator", "ioc", "ip address", "malicious"], route: "threat_intel" },
  { keywords: ["dlp", "data loss", "data protection"], route: "dlp" },
  { keywords: ["purview", "sensitivity", "label"], route: "purview" },
  { keywords: ["insider risk", "insider threat", "exfiltration"], route: "insider_risk" },
  { keywords: ["device", "intune", "endpoint", "non-compliant", "noncompliant"], route: "device" },
  { keywords: ["compliance", "policy conflict"], route: "compliance" },
  { keywords: ["secure score", "score", "improvement"], route: "secure_score" },
  { keywords: ["posture", "recommendation"], route: "posture" },
  { keywords: ["infrastructure", "network", "nsg", "firewall"], route: "infrastructure" },
  { keywords: ["scan", "repository", "repo", "vulnerability"], route: "scan" },
  { keywords: ["secret", "credential", "api key", "hardcoded"], route: "secrets" },
  { keywords: ["sentinel", "log analytics", "workspace"], route: "sentinel" },
];

function selectTools(
  finding: { type: string; detail: string },
  allTools: Map<string, AgentTool>
): AgentTool[] {
  const selectedNames = new Set<string>();

  // 1. Match by explicit finding type
  if (TOOL_ROUTES[finding.type]) {
    for (const name of TOOL_ROUTES[finding.type]) selectedNames.add(name);
  }

  // 2. Match by keywords in detail text
  const lowerDetail = finding.detail.toLowerCase();
  for (const { keywords, route } of KEYWORD_ROUTES) {
    if (keywords.some((kw) => lowerDetail.includes(kw))) {
      for (const name of (TOOL_ROUTES[route] ?? [])) selectedNames.add(name);
    }
  }

  // 3. Fallback: if nothing matched, use general investigation tools
  if (selectedNames.size === 0) {
    for (const name of ["get_entra_user_details", "get_entra_signin_logs", "get_defender_alerts", "get_secure_score", "detect_privileged_user_risks"]) {
      selectedNames.add(name);
    }
  }

  // 4. Cap at 8 tools max
  const tools: AgentTool[] = [];
  for (const name of selectedNames) {
    if (tools.length >= 8) break;
    const tool = allTools.get(name);
    if (tool) tools.push(tool);
  }

  return tools;
}

const SYSTEM_PROMPT = `You are a security investigation and remediation assistant. Given a security finding, investigate by calling the provided tools, then give a clear analysis with specific remediation steps.

## Process
1. Call relevant tools to gather data
2. Analyze results
3. Provide assessment with remediation

## Output Format
- **Summary** (1-2 sentences)
- **Findings** with data from tools
- **Risk Assessment** (Critical/High/Medium/Low)
- **Remediation Steps** with exact az CLI commands
- **Verification** — how to confirm the fix

Common commands:
- Revoke sessions: \`az rest --method POST --uri "https://graph.microsoft.com/v1.0/users/<id>/revokeSignInSessions"\`
- Disable account: \`az ad user update --id <upn> --account-enabled false\`
- Remove role: \`az role assignment delete --assignee <upn> --role "<role>"\`

Be concise. Use bullet points. Only report data from tool results.`;

export interface InvestigationResult {
  finding: string;
  narrative: string;
  toolCalls: Array<{ tool: string; args: any; summary: string }>;
  toolsUsed: string[];
}

export async function investigate(
  tenantId: string,
  finding: { type: string; user?: string; detail: string; severity: string },
  userToken?: string
): Promise<InvestigationResult> {
  let mcpEnv: Record<string, string> | undefined;
  const creds = getTenantCredentials(tenantId);
  if (creds) {
    try {
      const secret = decrypt(creds.clientSecretEnc);
      mcpEnv = { AZURE_CLIENT_ID: creds.clientId, AZURE_CLIENT_SECRET: secret, AZURE_TENANT_ID: tenantId };
    } catch {}
  }

  // Load all tools, then select relevant subset
  const allTools = await loadAllTools(mcpEnv);
  const selectedTools = selectTools(finding, allTools);

  const userPrompt = `Investigate this security finding:
- Type: ${finding.type}
- Severity: ${finding.severity}
${finding.user ? `- User: ${finding.user}` : ""}
- Detail: ${finding.detail}

Tenant ID: ${tenantId}
You have ${selectedTools.length} tools available. Call the relevant ones to gather context.`;

  const messages: AgentMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];

  const toolCallLog: Array<{ tool: string; args: any; summary: string }> = [];

  for (let i = 0; i < 5; i++) {
    const { message, finishReason } = await chatCompletion(messages, selectedTools, 1500);

    if (finishReason === "tool_calls" && message.tool_calls?.length) {
      messages.push(message);

      const toolResults = await Promise.all(
        message.tool_calls.map(async (tc: any) => {
          const args = JSON.parse(tc.function.arguments);
          if (!args.tenantId) args.tenantId = tenantId;
          if (userToken && !args.userToken && !mcpEnv) args.userToken = userToken;

          try {
            const result = await callTool(tc.function.name, args, mcpEnv);
            const resultStr = typeof result === "string" ? result : JSON.stringify(result, null, 2);
            const truncated = resultStr.length > 1500 ? resultStr.slice(0, 1500) + "\n...(truncated)" : resultStr;

            toolCallLog.push({ tool: tc.function.name, args, summary: resultStr.slice(0, 200) });
            return { id: tc.id, result: truncated };
          } catch (e: any) {
            return { id: tc.id, result: `Error: ${e.message}` };
          }
        })
      );

      for (const tr of toolResults) {
        messages.push({ role: "tool", content: tr.result, tool_call_id: tr.id });
      }
    } else {
      return {
        finding: finding.detail,
        narrative: message.content ?? "No analysis produced.",
        toolCalls: toolCallLog,
        toolsUsed: selectedTools.map((t) => t.function.name),
      };
    }
  }

  messages.push({ role: "user", content: "Provide your final assessment based on the data gathered." });
  const final = await chatCompletion(messages, undefined, 1500);

  return {
    finding: finding.detail,
    narrative: final.message.content ?? "Investigation incomplete.",
    toolCalls: toolCallLog,
    toolsUsed: selectedTools.map((t) => t.function.name),
  };
}
