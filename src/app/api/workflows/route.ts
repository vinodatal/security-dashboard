import { NextRequest, NextResponse } from "next/server";
import { callTool } from "@/lib/mcp-client";
import { getSession } from "@/lib/session";
import { getTenantCredentials } from "@/lib/db";
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

      case "generate": {
        if (!body.workflowId) {
          return NextResponse.json({ error: "workflowId required" }, { status: 400 });
        }
        const args: Record<string, unknown> = {
          workflowId: body.workflowId,
          mode: body.mode ?? "guided",
        };
        if (body.context) {
          args.context = JSON.stringify(body.context);
        }
        const result = await callTool("generate_workflow", args, mcpEnv);
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

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}. Use: assess, suggest, catalog, generate, status, execute-step` },
          { status: 400 }
        );
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
