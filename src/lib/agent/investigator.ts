import { chatCompletion, AgentMessage, AgentTool } from "./llm";
import { callTool } from "../mcp-client";
import { getTenantCredentials } from "../db/index";
import { decrypt } from "../crypto";

// MCP tools the agent can call
const AVAILABLE_TOOLS: AgentTool[] = [
  {
    type: "function",
    function: {
      name: "get_entra_user_details",
      description: "Get user profile, roles, groups, MFA methods, manager",
      parameters: {
        type: "object",
        properties: {
          userPrincipalName: { type: "string", description: "User UPN" },
          include: { type: "array", items: { type: "string", enum: ["profile", "roles", "groups", "mfa", "manager"] }, description: "What to include" },
        },
        required: ["userPrincipalName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_entra_signin_logs",
      description: "Get sign-in logs for a user or all users",
      parameters: {
        type: "object",
        properties: {
          userPrincipalName: { type: "string", description: "User UPN (optional, omit for all)" },
          lookbackDays: { type: "number", description: "Days to look back" },
          top: { type: "number", description: "Max results" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_entra_audit_logs",
      description: "Get directory audit logs",
      parameters: {
        type: "object",
        properties: {
          userPrincipalName: { type: "string" },
          lookbackDays: { type: "number" },
          top: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_purview_audit",
      description: "Search audit logs for file access, sharing, downloads",
      parameters: {
        type: "object",
        properties: {
          userPrincipalName: { type: "string" },
          operations: { type: "array", items: { type: "string" } },
          hoursBack: { type: "number" },
          top: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_hunting_query",
      description: "Run an Advanced Hunting KQL query",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "KQL query" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_intune_device_detail",
      description: "Get detailed device info with compliance and apps",
      parameters: {
        type: "object",
        properties: {
          deviceId: { type: "string" },
          include: { type: "array", items: { type: "string", enum: ["compliance", "apps", "groups"] } },
        },
        required: ["deviceId"],
      },
    },
  },
];

const SYSTEM_PROMPT = `You are a security investigation and remediation assistant. Given a security finding, you investigate it by calling available tools to gather context, then provide a clear, actionable analysis with specific remediation steps.

## Investigation Process
1. Gather relevant context about the finding (user details, sign-in history, audit logs)
2. Identify the root cause and risk level
3. Provide specific remediation steps with exact commands
4. Flag any related concerns you discover

## Remediation Playbooks

### Admin Without MFA (no_mfa)
Investigation: get_entra_user_details (include roles, mfa, profile), get_entra_signin_logs
Remediation:
- Revoke all sessions: \`az rest --method POST --uri "https://graph.microsoft.com/v1.0/users/<user-id>/revokeSignInSessions"\`
- Force password reset: \`az ad user update --id <upn> --force-change-password-next-sign-in true\`
- Create Conditional Access policy requiring MFA for admin roles
- Portal: Entra ID → Security → Conditional Access → New policy

### Stale Admin Account (stale_account)
Investigation: get_entra_user_details (include profile, roles, groups), get_entra_signin_logs (90 days)
Remediation:
- Disable account: \`az ad user update --id <upn> --account-enabled false\`
- Review if service account: check groups/app registrations that depend on it
- If human: contact user/manager, confirm still needed
- If service: migrate to managed identity, then disable

### Excessive Roles (excessive_roles)
Investigation: get_entra_user_details (include roles, groups), get_entra_audit_logs
Remediation:
- List current roles: \`az role assignment list --assignee <upn> --all\`
- Remove unnecessary roles: \`az role assignment delete --assignee <upn> --role "<role-name>"\`
- Keep minimum required role (e.g., Security Reader instead of Security Admin)
- Implement PIM (Privileged Identity Management) for just-in-time access

### Compromised Account
Investigation: get_entra_signin_logs (unusual locations), get_entra_user_details, get_entra_audit_logs
Remediation:
- Immediately: \`az rest --method POST --uri "https://graph.microsoft.com/v1.0/users/<id>/revokeSignInSessions"\`
- Reset credentials: \`az ad app credential reset --id <app-id>\` (for service principals)
- Block sign-in: \`az ad user update --id <upn> --account-enabled false\`
- Review: check for persistence (new app registrations, forwarding rules, delegated permissions)

### DLP / Data Exposure
Investigation: search_purview_audit (file access, sharing), get_entra_user_details
Remediation:
- Identify exposed files and who accessed them
- Restrict sharing: Portal → SharePoint admin → Sharing settings
- Notify data owner and compliance team
- Review DLP policy for gaps

### Non-Compliant Device
Investigation: get_intune_device_detail (compliance, apps)
Remediation:
- Force sync: \`az rest --method POST --uri "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/<id>/syncDevice"\`
- Common fixes: OS update, enable encryption, set password policy
- Block access until compliant via Conditional Access

## Output Format
- Start with a brief **Summary** (1-2 sentences)
- Then **Findings** with data from tools
- Then **Risk Assessment** (Critical/High/Medium/Low with reasoning)
- Then **Remediation Steps** with exact commands
- End with **Verification** — how to confirm the fix worked

Be concise. Use bullet points. Include specific data from tool results.
Do NOT make up data — only report what the tools return.`;

export interface InvestigationResult {
  finding: string;
  narrative: string;
  toolCalls: Array<{ tool: string; args: any; summary: string }>;
}

export async function investigate(
  tenantId: string,
  finding: { type: string; user?: string; detail: string; severity: string },
  userToken?: string
): Promise<InvestigationResult> {
  // Build MCP env
  let mcpEnv: Record<string, string> | undefined;
  const creds = getTenantCredentials(tenantId);
  if (creds) {
    try {
      const secret = decrypt(creds.clientSecretEnc);
      mcpEnv = { AZURE_CLIENT_ID: creds.clientId, AZURE_CLIENT_SECRET: secret, AZURE_TENANT_ID: tenantId };
    } catch {}
  }

  const userPrompt = `Investigate this security finding:
- Type: ${finding.type}
- Severity: ${finding.severity}
${finding.user ? `- User: ${finding.user}` : ""}
- Detail: ${finding.detail}

Tenant ID: ${tenantId}
Call the relevant tools to gather context, then provide your assessment and remediation steps.`;

  const messages: AgentMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];

  const toolCallLog: Array<{ tool: string; args: any; summary: string }> = [];

  // Agentic loop — max 5 iterations
  for (let i = 0; i < 5; i++) {
    const { message, finishReason } = await chatCompletion(messages, AVAILABLE_TOOLS, 1500);

    if (finishReason === "tool_calls" && message.tool_calls?.length) {
      messages.push(message);

      // Execute all tool calls in parallel
      const toolResults = await Promise.all(
        message.tool_calls.map(async (tc: any) => {
          const args = JSON.parse(tc.function.arguments);
          // Add tenantId and userToken to all MCP calls
          const mcpArgs = { ...args, tenantId, ...(userToken ? { userToken } : {}) };
          
          try {
            const result = await callTool(tc.function.name, mcpArgs, mcpEnv);
            const resultStr = typeof result === "string" ? result : JSON.stringify(result, null, 2);
            // Truncate large results
            const truncated = resultStr.length > 2000 ? resultStr.slice(0, 2000) + "\n...(truncated)" : resultStr;
            
            toolCallLog.push({
              tool: tc.function.name,
              args,
              summary: resultStr.slice(0, 200),
            });

            return { id: tc.id, result: truncated };
          } catch (e: any) {
            return { id: tc.id, result: `Error: ${e.message}` };
          }
        })
      );

      // Add tool results to messages
      for (const tr of toolResults) {
        messages.push({
          role: "tool",
          content: tr.result,
          tool_call_id: tr.id,
        });
      }
    } else {
      // LLM finished — return narrative
      return {
        finding: finding.detail,
        narrative: message.content ?? "No analysis produced.",
        toolCalls: toolCallLog,
      };
    }
  }

  // Max iterations reached — get final answer
  messages.push({ role: "user", content: "Please provide your final assessment based on the data gathered so far." });
  const final = await chatCompletion(messages, undefined, 1500);

  return {
    finding: finding.detail,
    narrative: final.message.content ?? "Investigation incomplete — max iterations reached.",
    toolCalls: toolCallLog,
  };
}
