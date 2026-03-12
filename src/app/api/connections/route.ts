import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  getConnections,
  saveConnection,
  deleteConnection,
  connectAndDiscover,
  getAllTools,
  callQualifiedTool,
} from "@/lib/mcp/registry";
import { getTenantCredentials } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

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

export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json();
  const { action } = body;
  const { tenantId } = session;
  const mcpEnv = getMcpEnv(tenantId);

  try {
    switch (action) {
      case "list": {
        const connections = getConnections(tenantId);
        const allTools = getAllTools(tenantId);
        return NextResponse.json({
          connections: connections.map(c => ({
            id: c.id,
            name: c.name,
            type: c.type,
            enabled: c.enabled,
            transport: c.transport,
            authType: c.authType,
            toolCount: c.tools.length,
            healthStatus: c.healthStatus,
            lastError: c.lastError,
            lastDiscoveredAt: c.lastDiscoveredAt,
          })),
          totalConnections: connections.length,
          totalTools: allTools.length,
        });
      }

      case "add": {
        if (!body.name || !body.transport) {
          return NextResponse.json({ error: "name and transport required" }, { status: 400 });
        }
        const id = body.id || body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        saveConnection(tenantId, {
          id,
          name: body.name,
          type: body.type ?? "custom",
          transport: body.transport,
          config: body.config ?? {},
          authType: body.authType ?? "none",
          authConfig: body.authConfig,
        });
        return NextResponse.json({ saved: true, connectionId: id });
      }

      case "remove": {
        if (!body.connectionId) {
          return NextResponse.json({ error: "connectionId required" }, { status: 400 });
        }
        if (body.connectionId === "built-in") {
          return NextResponse.json({ error: "Cannot remove built-in connection" }, { status: 400 });
        }
        deleteConnection(body.connectionId, tenantId);
        return NextResponse.json({ deleted: true });
      }

      case "discover": {
        if (!body.connectionId) {
          return NextResponse.json({ error: "connectionId required" }, { status: 400 });
        }
        const result = await connectAndDiscover(body.connectionId, tenantId, mcpEnv);
        return NextResponse.json({
          connectionId: body.connectionId,
          toolCount: result.tools.length,
          tools: result.tools.map(t => ({
            name: t.name,
            qualifiedName: t.qualifiedName,
            description: t.description,
          })),
          error: result.error,
        });
      }

      case "all-tools": {
        const tools = getAllTools(tenantId);
        return NextResponse.json({
          tools: tools.map(t => ({
            name: t.name,
            qualifiedName: t.qualifiedName,
            description: t.description,
            server: t.server,
          })),
          totalTools: tools.length,
        });
      }

      case "call": {
        if (!body.qualifiedName || !body.params) {
          return NextResponse.json({ error: "qualifiedName and params required" }, { status: 400 });
        }
        const result = await callQualifiedTool(
          body.qualifiedName, tenantId, body.params, mcpEnv
        );
        return NextResponse.json(result);
      }

      case "templates": {
        // Pre-built connection templates for known MCP servers
        return NextResponse.json({
          templates: [
            {
              id: "sentinel-data-exploration",
              name: "Microsoft Sentinel — Data Exploration",
              description: "Search tables, query the data lake, analyze entities in your Sentinel workspace",
              type: "microsoft",
              transport: "http-sse",
              config: { url: "https://sentinel.microsoft.com/mcp/data-exploration" },
              authType: "bearer",
              authNote: "Requires Entra ID token with Security Reader role. Get token: az account get-access-token --resource https://management.azure.com",
              docsUrl: "https://learn.microsoft.com/en-us/azure/sentinel/datalake/sentinel-mcp-data-exploration-tool",
            },
            {
              id: "sentinel-triage",
              name: "Microsoft Sentinel — Triage",
              description: "Triage incidents and hunt over your security data",
              type: "microsoft",
              transport: "http-sse",
              config: { url: "https://sentinel.microsoft.com/mcp/triage" },
              authType: "bearer",
              authNote: "Requires Entra ID token with Security Reader role",
              docsUrl: "https://learn.microsoft.com/en-us/azure/sentinel/datalake/sentinel-mcp-triage-tool",
            },
            {
              id: "github-mcp",
              name: "GitHub MCP Server",
              description: "Search code, manage issues and PRs, list repos",
              type: "community",
              transport: "stdio",
              config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
              authType: "env-vars",
              authNote: "Requires GITHUB_TOKEN environment variable",
              docsUrl: "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
            },
          ],
        });
      }

      case "add-from-template": {
        if (!body.templateId) {
          return NextResponse.json({ error: "templateId required" }, { status: 400 });
        }
        // Fetch templates and find the requested one
        const templates: Array<Record<string, unknown>> = [
          { id: "sentinel-data-exploration", name: "Sentinel Data Exploration", type: "microsoft", transport: "http-sse", config: { url: "https://sentinel.microsoft.com/mcp/data-exploration" }, authType: "bearer" },
          { id: "sentinel-triage", name: "Sentinel Triage", type: "microsoft", transport: "http-sse", config: { url: "https://sentinel.microsoft.com/mcp/triage" }, authType: "bearer" },
          { id: "github-mcp", name: "GitHub MCP", type: "community", transport: "stdio", config: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] }, authType: "env-vars" },
        ];
        const tmpl = templates.find(t => t.id === body.templateId);
        if (!tmpl) return NextResponse.json({ error: "Template not found" }, { status: 404 });

        saveConnection(tenantId, {
          id: tmpl.id as string,
          name: tmpl.name as string,
          type: tmpl.type as string,
          transport: tmpl.transport as string,
          config: tmpl.config as Record<string, unknown>,
          authType: tmpl.authType as string,
          authConfig: body.authConfig,
        });
        return NextResponse.json({ saved: true, connectionId: tmpl.id });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action. Use: list, add, remove, discover, all-tools, call, templates, add-from-template` },
          { status: 400 }
        );
    }
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
