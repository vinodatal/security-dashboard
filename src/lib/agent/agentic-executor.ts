/**
 * Agentic Workflow Executor — the LLM drives workflow execution,
 * adapting the plan based on each step's results.
 *
 * Unlike the mechanical executor (run step 1, 2, 3, analyze),
 * the agentic executor:
 * 1. Receives the workflow as a starting plan
 * 2. After each step, the LLM sees the result and decides:
 *    - Continue as planned
 *    - Modify next step's params (e.g., focus on a specific user)
 *    - Add new investigation steps (e.g., deep-dive on a finding)
 *    - Skip remaining steps (nothing to investigate)
 * 3. Produces analysis progressively, not just at the end
 */

import { chatCompletion, type AgentMessage } from "./llm";
import { callTool } from "../mcp-client";
import { getRemediationContext, getDocLinks } from "./remediation-kb";
import { BUILT_IN_SKILLS, buildSkillContext, selectRelevantSkills, type SkillPackage } from "../skills";
import { getTenantCredentials, getCustomSkills } from "../db/index";
import { decrypt } from "../crypto";

// ─── Types ──────────────────────────────────────────────────────────────────

interface WorkflowStep {
  id: string;
  name: string;
  tool: string;
  params?: Record<string, unknown>;
  resolvedParams?: Record<string, unknown>;
}

interface AgenticUpdate {
  type: "step_start" | "step_result" | "agent_thinking" | "step_added" | "step_skipped" | "analysis" | "complete";
  stepName?: string;
  toolName?: string;
  message: string;
  data?: unknown;
}

export interface AgenticResult {
  updates: AgenticUpdate[];
  stepsExecuted: Array<{
    name: string;
    tool: string;
    source: "planned" | "agent-added";
    result?: unknown;
    error?: string;
    durationMs: number;
  }>;
  stepsSkipped: string[];
  analysis: string;
  totalDurationMs: number;
}

// ─── Tool definitions for LLM ───────────────────────────────────────────────

const AGENT_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "execute_step",
      description: "Execute the next planned workflow step OR call any MCP security tool for additional investigation.",
      parameters: {
        type: "object",
        properties: {
          tool_name: {
            type: "string",
            description: "MCP tool name (e.g., get_defender_alerts, get_entra_user_details, run_hunting_query)",
          },
          params_json: {
            type: "string",
            description: "JSON string of tool parameters. Always include tenantId.",
          },
          reason: {
            type: "string",
            description: "Brief explanation of why this step is needed",
          },
        },
        required: ["tool_name", "params_json", "reason"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "skip_remaining",
      description: "Skip remaining planned steps because enough data has been collected or findings don't warrant further investigation.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Why remaining steps are being skipped" },
        },
        required: ["reason"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "produce_analysis",
      description: "Produce the final security analysis report. Call this when you have enough data to draw conclusions. Include: Executive Verdict, Risk Score, Correlations, Remediation Plan.",
      parameters: {
        type: "object",
        properties: {
          analysis: {
            type: "string",
            description: "Full markdown analysis report with ## sections: Verdict, Correlations, Risk Score, Remediation Plan, Next Steps",
          },
        },
        required: ["analysis"],
      },
    },
  },
];

// ─── Main executor ──────────────────────────────────────────────────────────

function getMcpEnv(tenantId: string) {
  const creds = getTenantCredentials(tenantId);
  if (!creds) return undefined;
  try {
    return {
      AZURE_CLIENT_ID: creds.clientId,
      AZURE_CLIENT_SECRET: decrypt(creds.clientSecretEnc),
      AZURE_TENANT_ID: tenantId,
    };
  } catch {
    return undefined;
  }
}

export async function executeAgenticWorkflow(
  workflowName: string,
  steps: WorkflowStep[],
  tenantId: string,
  userToken?: string,
  workflowMeta?: { category?: string; tags?: string[] },
  onUpdate?: (update: AgenticUpdate) => void
): Promise<AgenticResult> {
  const startTime = Date.now();
  const mcpEnv = getMcpEnv(tenantId);
  const updates: AgenticUpdate[] = [];
  const executedSteps: AgenticResult["stepsExecuted"] = [];
  const skippedSteps: string[] = [];

  const emit = (update: AgenticUpdate) => {
    updates.push(update);
    onUpdate?.(update);
  };

  // Build tool and skill context
  const toolNames = steps.map(s => s.tool);
  const remediationContext = getRemediationContext(toolNames);
  const docLinks = getDocLinks(toolNames);

  const customSkillRows = getCustomSkills(tenantId);
  const customSkills: SkillPackage[] = customSkillRows.map((r) => ({
    ...(r.definition as SkillPackage),
    id: r.skillId as string,
    name: r.name as string,
  }));
  const allSkills = [...BUILT_IN_SKILLS, ...customSkills];
  const selectedSkills = selectRelevantSkills(allSkills, {
    toolNames,
    category: workflowMeta?.category,
    tags: [
      ...(workflowMeta?.tags ?? []),
      ...workflowName.toLowerCase().split(/\s+/),
    ],
  });
  const skillContext = buildSkillContext(selectedSkills);
  const docsText = docLinks.length > 0
    ? `\n\nReference docs:\n${docLinks.map(d => `- [${d.title}](${d.url})`).join("\n")}`
    : "";

  // Build the planned steps description
  const planText = steps.map((s, i) =>
    `${i + 1}. **${s.name}** → \`${s.tool}\` with params: ${JSON.stringify(s.resolvedParams ?? s.params ?? {})}`
  ).join("\n");

  const systemPrompt = `You are an expert security analyst executing a workflow called "${workflowName}" against a real Microsoft 365 / Azure tenant (ID: ${tenantId}).

## Your Planned Steps
${planText}

## Your Job
Execute each step by calling \`execute_step\`, examine the result, then DECIDE what to do next:
- **Continue**: execute the next planned step as-is
- **Adapt**: modify the next step's parameters based on what you found (e.g., focus on a specific user)
- **Add steps**: call additional tools that weren't in the plan (e.g., deep-dive on a suspicious user)
- **Skip**: skip remaining steps if findings don't warrant further investigation
- **Conclude**: call \`produce_analysis\` when you have enough data

## Decision Guidelines
- If a step returns 0 results, DON'T blindly run the next step — consider why and adjust
- If you find a specific user/device/IP in the results, add investigation steps for that entity
- Maximum 15 tool calls total (planned + added) to prevent runaway execution
- Always include tenantId: "${tenantId}" in params_json
- After gathering enough data, call \`produce_analysis\` with a full markdown report

## Analysis Format (for produce_analysis)
Include these sections:
## 🎯 Executive Verdict
## 🔗 Cross-Step Correlations  
## 📊 Risk Score: X/100
## 🔧 Remediation Plan (with Azure CLI / PowerShell scripts)
## ⏭️ Recommended Next Workflows

${remediationContext}${docsText}${skillContext}`;

  const messages: AgentMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Begin executing the "${workflowName}" workflow. Start with step 1.` },
  ];

  let analysis = "";
  let totalToolCalls = 0;
  const MAX_TOOL_CALLS = 15;
  const MAX_ITERATIONS = 20;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (totalToolCalls >= MAX_TOOL_CALLS) {
      emit({ type: "agent_thinking", message: "Reached maximum tool call limit, producing analysis..." });
      // Force final analysis
      messages.push({
        role: "user",
        content: "You've reached the tool call limit. Call produce_analysis now with your findings.",
      });
    }

    const isLast = iteration === MAX_ITERATIONS - 1 || totalToolCalls >= MAX_TOOL_CALLS;

    const result = await chatCompletion(
      messages,
      isLast ? undefined : AGENT_TOOLS,
      4000
    );

    // No tool calls — LLM produced text (shouldn't happen with tools, but handle it)
    if (!result.message.tool_calls || result.message.tool_calls.length === 0) {
      if (result.message.content) {
        analysis = result.message.content;
        emit({ type: "analysis", message: "Analysis produced", data: analysis });
      }
      break;
    }

    messages.push(result.message);

    for (const toolCall of result.message.tool_calls) {
      const fnName = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments);

      if (fnName === "produce_analysis") {
        analysis = args.analysis;
        emit({ type: "analysis", message: "Final analysis produced", data: analysis });
        messages.push({
          role: "tool",
          content: "Analysis recorded. Workflow complete.",
          tool_call_id: toolCall.id,
        });
        // Break out of both loops
        iteration = MAX_ITERATIONS;
        break;
      }

      if (fnName === "skip_remaining") {
        const remaining = steps.slice(executedSteps.filter(s => s.source === "planned").length);
        for (const s of remaining) {
          skippedSteps.push(s.name);
        }
        emit({ type: "step_skipped", message: `Skipping ${remaining.length} remaining steps: ${args.reason}` });
        messages.push({
          role: "tool",
          content: `Skipped ${remaining.length} steps. Now call produce_analysis.`,
          tool_call_id: toolCall.id,
        });
        continue;
      }

      if (fnName === "execute_step") {
        const toolName = args.tool_name;
        const reason = args.reason;
        let params: Record<string, unknown>;
        try {
          params = JSON.parse(args.params_json);
        } catch {
          params = { tenantId };
        }

        // Ensure tenantId is present
        if (!params.tenantId) params.tenantId = tenantId;
        if (!mcpEnv && userToken && !params.userToken) params.userToken = userToken;

        // Is this a planned step or agent-added?
        const plannedStep = steps.find(s => s.tool === toolName && !executedSteps.some(e => e.tool === toolName && e.source === "planned"));
        const source = plannedStep ? "planned" as const : "agent-added" as const;

        emit({
          type: source === "agent-added" ? "step_added" : "step_start",
          stepName: plannedStep?.name ?? `Investigate: ${reason}`,
          toolName,
          message: reason,
        });

        totalToolCalls++;
        const stepStart = Date.now();

        try {
          const toolResult = await callTool(toolName, params, mcpEnv);
          const durationMs = Date.now() - stepStart;

          // Truncate for LLM context
          const resultStr = JSON.stringify(toolResult);
          const truncated = resultStr.length > 3000
            ? resultStr.substring(0, 3000) + "\n... (truncated)"
            : resultStr;

          executedSteps.push({
            name: plannedStep?.name ?? `${toolName}: ${reason}`,
            tool: toolName,
            source,
            result: toolResult,
            durationMs,
          });

          emit({
            type: "step_result",
            stepName: plannedStep?.name ?? toolName,
            toolName,
            message: `Completed in ${(durationMs / 1000).toFixed(1)}s`,
            data: toolResult,
          });

          messages.push({
            role: "tool",
            content: `Result from ${toolName} (${(durationMs / 1000).toFixed(1)}s):\n${truncated}`,
            tool_call_id: toolCall.id,
          });
        } catch (err) {
          const durationMs = Date.now() - stepStart;
          const errorMsg = err instanceof Error ? err.message : String(err);

          executedSteps.push({
            name: plannedStep?.name ?? toolName,
            tool: toolName,
            source,
            error: errorMsg,
            durationMs,
          });

          emit({
            type: "step_result",
            stepName: toolName,
            toolName,
            message: `Failed: ${errorMsg}`,
          });

          messages.push({
            role: "tool",
            content: `Error from ${toolName}: ${errorMsg}`,
            tool_call_id: toolCall.id,
          });
        }
      }
    }

    // Check if analysis was produced (break signal)
    if (analysis) break;
  }

  // If agent never called produce_analysis, generate one from the last message
  if (!analysis) {
    const finalResult = await chatCompletion([
      ...messages,
      { role: "user", content: "Summarize your findings and produce the final analysis report now." },
    ], undefined, 3000);
    analysis = finalResult.message.content || "Analysis could not be generated.";
  }

  emit({
    type: "complete",
    message: `Workflow complete: ${executedSteps.length} steps executed (${executedSteps.filter(s => s.source === "agent-added").length} agent-added), ${skippedSteps.length} skipped`,
  });

  return {
    updates,
    stepsExecuted: executedSteps,
    stepsSkipped: skippedSteps,
    analysis,
    totalDurationMs: Date.now() - startTime,
  };
}
