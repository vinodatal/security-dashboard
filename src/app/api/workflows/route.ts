import { NextRequest, NextResponse } from "next/server";
import { callTool } from "@/lib/mcp-client";
import { getSession } from "@/lib/session";
import {
  getTenantCredentials,
  saveCustomWorkflow,
  getCustomWorkflows,
  deleteCustomWorkflow,
  saveWorkflowRun,
  getWorkflowRuns,
  updateWorkflowSchedule,
} from "@/lib/db";
import { decrypt } from "@/lib/crypto";

function getMcpEnv(tenantId: string) {
  const creds = getTenantCredentials(tenantId);
  if (!creds) return { env: undefined, appArgs: undefined };
  try {
    const clientSecret = decrypt(creds.clientSecretEnc);
    return {
      env: {
        AZURE_CLIENT_ID: creds.clientId,
        AZURE_CLIENT_SECRET: clientSecret,
        AZURE_TENANT_ID: tenantId,
      },
      appArgs: { tenantId },
    };
  } catch {
    return { env: undefined, appArgs: undefined };
  }
}

export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json();
  const { action } = body;
  const { tenantId, graphToken: userToken } = session;
  const { env: mcpEnv } = getMcpEnv(tenantId);

  const baseArgs = mcpEnv ? { tenantId } : { tenantId, userToken };

  try {
    switch (action) {
      case "assess": {
        const result = await callTool(
          "assess_environment",
          { ...baseArgs, forceRefresh: body.forceRefresh ?? false },
          mcpEnv
        );
        return NextResponse.json(result);
      }

      case "suggest": {
        const args: Record<string, unknown> = { ...baseArgs };
        if (body.context) {
          args.context = JSON.stringify(body.context);
        }
        const result = await callTool("suggest_workflows", args, mcpEnv);
        return NextResponse.json(result);
      }

      case "catalog": {
        const args: Record<string, unknown> = {};
        if (body.category) args.category = body.category;
        if (body.tag) args.tag = body.tag;
        if (body.complexity) args.complexity = body.complexity;
        const result = await callTool("get_workflow_catalog", args, mcpEnv);
        return NextResponse.json(result);
      }

      case "prepare": {
        if (!body.workflowId && !body.definition) {
          return NextResponse.json({ error: "workflowId or definition required" }, { status: 400 });
        }
        const args: Record<string, unknown> = {
          mode: body.mode ?? "guided",
        };
        if (body.workflowId) args.workflowId = body.workflowId;
        if (body.definition) {
          // Pass custom workflow definition as JSON string to MCP
          args.definition = typeof body.definition === "string"
            ? body.definition
            : JSON.stringify(body.definition);
        }
        if (body.context) {
          args.context = JSON.stringify(body.context);
        }
        const result = await callTool("prepare_workflow", args, mcpEnv);
        return NextResponse.json(result);
      }

      case "status": {
        const args: Record<string, unknown> = {};
        if (body.executionId) args.executionId = body.executionId;
        if (body.workflowId) args.workflowId = body.workflowId;
        if (body.limit) args.limit = body.limit;
        const result = await callTool("get_workflow_status", args, mcpEnv);
        return NextResponse.json(result);
      }

      case "execute-step": {
        if (!body.toolName || !body.params) {
          return NextResponse.json({ error: "toolName and params required" }, { status: 400 });
        }
        const stepArgs = { ...body.params };
        if (!stepArgs.tenantId) stepArgs.tenantId = tenantId;
        if (!mcpEnv && !stepArgs.userToken) stepArgs.userToken = userToken;
        const result = await callTool(body.toolName, stepArgs, mcpEnv);
        return NextResponse.json(result);
      }

      case "save": {
        if (!body.workflow) {
          return NextResponse.json({ error: "workflow object required" }, { status: 400 });
        }
        const wf = body.workflow;
        const id = saveCustomWorkflow(tenantId, {
          id: wf.id || `custom-${Date.now()}`,
          name: wf.name,
          description: wf.description,
          category: wf.category || "reporting",
          complexity: wf.complexity || "medium",
          estimatedDuration: wf.estimatedDuration || "5-15 min",
          tags: wf.tags || [],
          definition: wf,
          source: wf.source || "user",
          schedule: body.schedule,
          scheduleEnabled: body.scheduleEnabled,
          notifyType: body.notifyType,
          notifyTarget: body.notifyTarget,
        });
        return NextResponse.json({ saved: true, dbId: id, workflowId: wf.id });
      }

      case "list-custom": {
        const workflows = getCustomWorkflows(tenantId);
        return NextResponse.json({ workflows, count: workflows.length });
      }

      case "delete-custom": {
        if (!body.workflowId) {
          return NextResponse.json({ error: "workflowId required" }, { status: 400 });
        }
        deleteCustomWorkflow(body.workflowId, tenantId);
        return NextResponse.json({ deleted: true });
      }

      case "update-schedule": {
        if (!body.workflowId) {
          return NextResponse.json({ error: "workflowId required" }, { status: 400 });
        }
        updateWorkflowSchedule(
          body.workflowId,
          tenantId,
          body.schedule ?? null,
          body.scheduleEnabled ?? false,
          body.notifyType,
          body.notifyTarget
        );
        return NextResponse.json({ updated: true });
      }

      case "save-run": {
        if (!body.workflowId || !body.status) {
          return NextResponse.json({ error: "workflowId and status required" }, { status: 400 });
        }
        const runId = saveWorkflowRun({
          workflowId: body.workflowId,
          tenantId,
          status: body.status,
          mode: body.mode ?? "guided",
          totalSteps: body.totalSteps ?? 0,
          completedSteps: body.completedSteps ?? 0,
          skippedSteps: body.skippedSteps ?? 0,
          failedSteps: body.failedSteps ?? 0,
          findingsCount: body.findingsCount ?? 0,
          reportMd: body.reportMd,
          triggeredBy: body.triggeredBy ?? "user",
        });
        return NextResponse.json({ saved: true, runId });
      }

      case "list-runs": {
        const runs = getWorkflowRuns(tenantId, body.workflowId, body.limit ?? 20);
        return NextResponse.json({ runs, count: runs.length });
      }

      case "create-from-nl": {
        if (!body.description) {
          return NextResponse.json({ error: "description required" }, { status: 400 });
        }
        const { chatCompletion } = await import("@/lib/agent/llm");
        const systemPrompt = `You are a security workflow architect. Given a natural language description of a security task, generate a structured workflow definition as JSON.

Available MCP tools you can use in steps:
- get_defender_alerts: Get Defender security alerts (params: tenantId, severity?, top?)
- get_secure_score: Get Microsoft Secure Score (params: tenantId, top?)
- get_security_recommendations: Get security recommendations (params: tenantId, category?, top?)
- get_entra_signin_logs: Get sign-in logs (params: tenantId, userPrincipalName?, lookbackDays?, top?)
- get_entra_risky_users: Get risky users (params: tenantId, userPrincipalName?, riskLevel?, top?)
- get_entra_user_details: Get user profile/roles/MFA/groups (params: tenantId, userPrincipalName, include?)
- get_entra_audit_logs: Get audit logs (params: tenantId, userPrincipalName?, lookbackDays?, top?)
- get_intune_devices: Get managed devices (params: tenantId, complianceState?, top?)
- get_intune_policies: Get Intune policies (params: tenantId, policyType?, top?)
- get_intune_device_detail: Device details (params: tenantId, deviceId, include?)
- detect_policy_conflicts: Find policy conflicts (params: tenantId)
- detect_privileged_user_risks: Find admin MFA/stale issues (params: tenantId, staleDays?)
- get_purview_alerts: Get DLP alerts (params: tenantId, severity?, top?)
- get_insider_risk_alerts: Get insider risk alerts (params: tenantId, severity?, top?)
- triage_dlp_alerts: Triage DLP alerts by risk (params: tenantId, top?, hoursBack?)
- search_purview_audit: Search audit logs (params: tenantId, userPrincipalName?, operations?, hoursBack?, top?)
- get_data_security_posture: Data security overview (params: tenantId)
- get_purview_sensitive_info_types: List SITs/labels (params: tenantId)
- run_hunting_query: Execute KQL query (params: tenantId, query)
- query_sentinel: Run Sentinel KQL (params: tenantId, workspaceId, query, timespan?)
- get_sentinel_incidents: Get Sentinel incidents (params: tenantId, workspaceId, severity?, hours?)
- lookup_threat_intel: Check IoC reputation (params: tenantId, indicators)
- check_infra_security: OWASP infra checks (params: tenantId, subscriptionId, checks?)
- query_azure_resources: Azure Resource Graph KQL (params: tenantId, subscriptionId, query)
- get_access_packages: List access packages (params: tenantId, top?)
- get_lifecycle_workflows: List lifecycle workflows (params: tenantId, category?)
- scan_repository: Scan GitHub repo (params: repo, branch?, scanTypes?)
- analyze_script: Analyze script for threats (params: script, scriptType?)
- scan_iac_template: Scan IaC templates (params: template, templateType?)

Output ONLY valid JSON with this structure:
{
  "id": "kebab-case-id",
  "name": "Human Readable Name",
  "description": "What this workflow does",
  "category": "incident-response|identity-access|compliance-posture|device-endpoint|data-protection|reporting",
  "complexity": "low|medium|high",
  "estimatedDuration": "X-Y min",
  "tags": ["tag1", "tag2"],
  "requiredLicenses": [],
  "requiredTools": ["tool1", "tool2"],
  "steps": [
    {
      "id": "step-id",
      "name": "Step Name",
      "tool": "tool_name",
      "params": { "param": "value" }
    }
  ]
}

Do NOT include any markdown formatting, code fences, or explanation. Output ONLY the JSON object.`;

        const result = await chatCompletion(
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: body.description },
          ],
          undefined,
          2000
        );

        try {
          const content = result.message.content || "";
          // Strip any markdown code fences if present
          const jsonStr = content.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
          const workflow = JSON.parse(jsonStr);
          // Add trigger conditions if missing
          if (!workflow.triggerConditions) workflow.triggerConditions = [];
          return NextResponse.json({ workflow, source: "generated" });
        } catch {
          return NextResponse.json(
            { error: "Failed to parse generated workflow", raw: result.message.content },
            { status: 500 }
          );
        }
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}. Use: assess, suggest, catalog, generate, status, execute-step, create-from-nl` },
          { status: 400 }
        );
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
