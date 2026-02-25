import { chatCompletion, AgentMessage, AgentTool } from "./llm";
import { callTool, listMcpTools } from "../mcp-client";
import { getTenantCredentials } from "../db/index";
import { decrypt } from "../crypto";

// Cache discovered tools
let cachedTools: AgentTool[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 min

function zodToJsonSchema(schema: any): any {
  if (!schema) return { type: "object", properties: {} };
  // MCP tools return inputSchema as JSON Schema already
  if (schema.type) return schema;
  return { type: "object", properties: {} };
}

async function getAvailableTools(env?: Record<string, string>): Promise<AgentTool[]> {
  if (cachedTools && Date.now() - cacheTime < CACHE_TTL) return cachedTools;

  const mcpTools = await listMcpTools(env);

  cachedTools = mcpTools
    .filter((t: any) => t.name !== "setup_app_registration") // Don't let agent create apps
    .map((t: any) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: (t.description ?? "").slice(0, 200),
        parameters: zodToJsonSchema(t.inputSchema),
      },
    }));

  cacheTime = Date.now();
  return cachedTools;
}

const SYSTEM_PROMPT = `You are a security investigation and remediation assistant with access to 40+ Microsoft Security tools via MCP. Given a question or security finding, you investigate by calling the right tools, then provide a clear analysis with remediation steps.

## How to Work
1. Identify which tools are relevant to the question
2. Call tools to gather data — you can call multiple tools in one turn
3. Analyze the results
4. Provide specific, actionable remediation with exact commands

## Tool Usage Guidelines
- Always include tenantId in tool calls (it's provided in the context)
- For user-specific queries, use userPrincipalName parameter
- Tools that need app-only tokens will use service credentials automatically
- If a tool fails with 403, suggest the user run setup_app_registration

## Output Format
- **Summary** (1-2 sentences)
- **Findings** with data from tools
- **Risk Assessment** (Critical/High/Medium/Low)
- **Remediation Steps** with exact az CLI commands or portal steps
- **Verification** — how to confirm the fix worked

## Common Remediation Commands
- Revoke sessions: \`az rest --method POST --uri "https://graph.microsoft.com/v1.0/users/<id>/revokeSignInSessions"\`
- Disable account: \`az ad user update --id <upn> --account-enabled false\`
- Force password reset: \`az ad user update --id <upn> --force-change-password-next-sign-in true\`
- Remove role: \`az role assignment delete --assignee <upn> --role "<role>"\`
- Sync device: \`az rest --method POST --uri "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/<id>/syncDevice"\`

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

  // Get all available tools from MCP
  const tools = await getAvailableTools(mcpEnv);

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
    const { message, finishReason } = await chatCompletion(messages, tools, 1500);

    if (finishReason === "tool_calls" && message.tool_calls?.length) {
      messages.push(message);

      const toolResults = await Promise.all(
        message.tool_calls.map(async (tc: any) => {
          const args = JSON.parse(tc.function.arguments);
          // Inject tenantId if not provided
          if (!args.tenantId) args.tenantId = tenantId;
          // Only pass userToken for tools that work with delegated permissions
          // Don't pass it when app credentials are available — lets the MCP server
          // use client credentials flow for tools that require app-only tokens
          if (userToken && !args.userToken && !mcpEnv) args.userToken = userToken;

          try {
            const result = await callTool(tc.function.name, args, mcpEnv);
            const resultStr = typeof result === "string" ? result : JSON.stringify(result, null, 2);
            const truncated = resultStr.length > 3000 ? resultStr.slice(0, 3000) + "\n...(truncated)" : resultStr;

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

      for (const tr of toolResults) {
        messages.push({ role: "tool", content: tr.result, tool_call_id: tr.id });
      }
    } else {
      return {
        finding: finding.detail,
        narrative: message.content ?? "No analysis produced.",
        toolCalls: toolCallLog,
      };
    }
  }

  // Max iterations — get final answer
  messages.push({ role: "user", content: "Provide your final assessment based on the data gathered." });
  const final = await chatCompletion(messages, undefined, 1500);

  return {
    finding: finding.detail,
    narrative: final.message.content ?? "Investigation incomplete.",
    toolCalls: toolCallLog,
  };
}
