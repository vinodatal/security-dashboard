/**
 * Workflow Analysis Agent — analyzes completed workflow results using AI.
 *
 * Unlike the simple single-shot LLM call, this agent:
 * 1. Receives all step results as context
 * 2. Has a remediation knowledge base (per-tool docs + scripts)
 * 3. Can call MCP tools for deeper investigation (agentic loop, up to 3 iterations)
 * 4. Produces: Executive Verdict, Cross-Step Correlations, Risk Score,
 *    Remediation Plan with real scripts + doc links, Next Steps
 */

import { chatCompletion, type AgentMessage } from "./llm";
import { callTool } from "../mcp-client";
import { getRemediationContext, getDocLinks } from "./remediation-kb";
import { getTenantCredentials, getCustomSkills } from "../db/index";
import { decrypt } from "../crypto";
import { BUILT_IN_SKILLS, buildSkillContext, selectRelevantSkills, type SkillPackage } from "../skills";

interface StepData {
  name: string;
  tool: string;
  status: string;
  summary?: string;
  result?: unknown;
  error?: string;
}

interface SkippedStep {
  stepName: string;
  reason: string;
}

interface AnalysisResult {
  analysis: string;
  toolCallsMade: string[];
  additionalFindings: string[];
  skillsApplied: string[];
  model: string;
}

function getMcpEnv(tenantId: string) {
  const creds = getTenantCredentials(tenantId);
  if (!creds) return undefined;
  try {
    const clientSecret = decrypt(creds.clientSecretEnc);
    return {
      AZURE_CLIENT_ID: creds.clientId,
      AZURE_CLIENT_SECRET: clientSecret,
      AZURE_TENANT_ID: tenantId,
    };
  } catch {
    return undefined;
  }
}

function truncateData(data: unknown, maxLen = 2500): string {
  const str = JSON.stringify(data, null, 2);
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen) + "\n... (truncated)";
}

const FOLLOW_UP_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "investigate_deeper",
      description: "Call an additional MCP security tool to investigate a finding further. Use this when the workflow results suggest a risk that needs more data to confirm.",
      parameters: {
        type: "object",
        properties: {
          tool_name: {
            type: "string",
            description: "MCP tool to call (e.g., get_entra_user_details, get_entra_signin_logs, run_hunting_query)",
          },
          reason: {
            type: "string",
            description: "Why this additional investigation is needed",
          },
          params_json: {
            type: "string",
            description: "JSON string of tool parameters (e.g., '{\"userPrincipalName\":\"user@domain.com\",\"include\":[\"roles\",\"mfa\"]}')",
          },
        },
        required: ["tool_name", "reason", "params_json"],
      },
    },
  },
];

export async function analyzeWorkflow(
  workflowName: string,
  steps: StepData[],
  skippedSteps: SkippedStep[],
  tenantId: string,
  userToken?: string
): Promise<AnalysisResult> {
  const toolNames = steps.map((s) => s.tool);
  const remediationContext = getRemediationContext(toolNames);
  const docLinks = getDocLinks(toolNames);
  const mcpEnv = getMcpEnv(tenantId);

  // Load and select relevant skills
  const customSkillRows = getCustomSkills(tenantId);
  const customSkills: SkillPackage[] = customSkillRows.map((r) => ({
    ...(r.definition as SkillPackage),
    id: r.skillId as string,
    name: r.name as string,
    source: r.source as SkillPackage["source"],
  }));
  const allSkills = [...BUILT_IN_SKILLS, ...customSkills];
  const selectedSkills = selectRelevantSkills(allSkills, {
    toolNames,
    tags: steps.flatMap((s) => {
      const d = s.result as Record<string, unknown> | undefined;
      if (!d) return [];
      // Extract tags from findings data
      const tags: string[] = [];
      if (d.findings && Array.isArray(d.findings)) {
        for (const f of d.findings as Array<Record<string, unknown>>) {
          if (f.type) tags.push(String(f.type));
        }
      }
      return tags;
    }),
  });
  const skillContext = buildSkillContext(selectedSkills);

  // Build step data for LLM
  const stepsText = steps
    .map((s, i) => {
      const dataStr = s.result ? truncateData(s.result) : null;
      return `### Step ${i + 1}: ${s.name}\n**Tool:** ${s.tool}\n**Status:** ${s.status}\n${s.summary ? `**Summary:** ${s.summary}\n` : ""}${dataStr ? `**Data:**\n\`\`\`json\n${dataStr}\n\`\`\`\n` : s.error ? `**Error:** ${s.error}\n` : "No data returned\n"}`;
    })
    .join("\n");

  const skippedText =
    skippedSteps.length > 0
      ? `\n### Skipped Steps\n${skippedSteps.map((s) => `- **${s.stepName}**: ${s.reason}`).join("\n")}\n`
      : "";

  const docsText =
    docLinks.length > 0
      ? `\n\n## Reference Documentation\nInclude these links in your remediation plan where relevant:\n${docLinks.map((d) => `- [${d.title}](${d.url})`).join("\n")}\n`
      : "";

  const systemPrompt = `You are an expert security analyst with deep knowledge of Microsoft 365, Azure, and Entra ID security. You just ran a security workflow called "${workflowName}" that executed multiple steps against a real tenant. Analyze ALL the step results together.

Your analysis MUST include these sections in this exact order:

## 🎯 Executive Verdict
One paragraph: overall risk level (Critical/High/Medium/Low), the single most important finding, whether immediate action is required. Be specific — cite actual data from the results.

## 🔗 Cross-Step Correlations
Look across ALL step results for connected signals:
- Same user appearing in multiple findings (alerts + risky sign-ins + admin roles)
- Device compliance issues combined with user risk indicators
- DLP violations from users who also have suspicious sign-in patterns
- Low secure score areas matching actual alert categories
If you find correlations, explain the attack chain. If none exist, say so honestly.

## 📊 Risk Score: X/100
Calculate using these weights (clamp to 0-100):
- Critical/high alerts: +15 each (max 40)
- Admins without MFA: +20 each (max 40)
- High-risk users: +10 each (max 30)
- Non-compliant devices: +2 each (max 20)
- DLP violations: +5 each (max 20)
- Secure score below 50%: +15
- Open management ports: +10 each (max 20)
Show the calculation.

## 🔧 Remediation Plan
For EACH finding, provide in this exact format:

### [Priority: Critical/High/Medium] Finding Title
**Issue:** What exactly is wrong (cite specific data)
**Risk:** What could happen if not fixed
**Fix:**
\`\`\`bash
# Azure CLI command to remediate
az ...
\`\`\`
\`\`\`powershell
# PowerShell alternative
Connect-MgGraph...
\`\`\`
**Verify:**
\`\`\`bash
# Command to confirm the fix worked
az ...
\`\`\`
**Docs:** [Relevant Microsoft Learn article](URL)

Sort by priority (Critical first). Use REAL commands from the knowledge base — replace <PLACEHOLDERS> with actual values from the step data where possible.

## ⏭️ Recommended Next Workflows
Based on the findings, suggest 2-3 specific workflows to run next from this list:
- alert-triage, investigate-incident, insider-threat-investigation
- user-risk-assessment, privileged-access-review, suspicious-signin-analysis
- compliance-assessment, infrastructure-audit, policy-gap-analysis
- device-compliance-audit, dlp-triage, executive-report
Explain WHY each is relevant to the current findings.

IMPORTANT:
- Only cite data that actually appears in the results — never hallucinate findings
- If a step returned empty data or errors, note it as "insufficient data" not "no issues"
- Replace <PLACEHOLDERS> in scripts with actual values from step data where available
- Include Microsoft Learn documentation links for every remediation item
${remediationContext}${docsText}${skillContext}`;

  const userMessage = `Analyze the results of the "${workflowName}" workflow:\n\n${stepsText}${skippedText}`;

  const messages: AgentMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  const toolCallsMade: string[] = [];
  const additionalFindings: string[] = [];
  let finalAnalysis = "";

  // Agentic loop: up to 3 iterations for deeper investigation
  for (let iteration = 0; iteration < 4; iteration++) {
    const isLastIteration = iteration === 3;

    const result = await chatCompletion(
      messages,
      isLastIteration ? undefined : FOLLOW_UP_TOOLS,
      4000
    );

    // If the LLM wants to call a tool for deeper investigation
    if (
      result.message.tool_calls &&
      result.message.tool_calls.length > 0 &&
      !isLastIteration
    ) {
      messages.push(result.message);

      for (const toolCall of result.message.tool_calls) {
        const fn = toolCall.function;
        try {
          const args = JSON.parse(fn.arguments);
          const toolName = args.tool_name;
          const reason = args.reason;
          const params = JSON.parse(args.params_json || "{}");

          // Inject tenantId
          if (!params.tenantId) params.tenantId = tenantId;
          if (!mcpEnv && userToken && !params.userToken) params.userToken = userToken;

          toolCallsMade.push(`${toolName}: ${reason}`);

          const toolResult = await callTool(toolName, params, mcpEnv);
          const resultStr = truncateData(toolResult, 2000);
          additionalFindings.push(`${toolName}: ${JSON.stringify(toolResult).substring(0, 200)}`);

          messages.push({
            role: "tool",
            content: `Results from ${toolName}:\n${resultStr}`,
            tool_call_id: toolCall.id,
          });
        } catch (err) {
          messages.push({
            role: "tool",
            content: `Error calling tool: ${err instanceof Error ? err.message : String(err)}`,
            tool_call_id: toolCall.id,
          });
        }
      }

      continue; // Go to next iteration with tool results
    }

    // LLM produced a final response
    finalAnalysis = result.message.content || "";
    break;
  }

  return {
    analysis: finalAnalysis,
    toolCallsMade,
    additionalFindings,
    skillsApplied: selectedSkills.map((s) => s.name),
    model: "gpt-4o-mini",
  };
}
