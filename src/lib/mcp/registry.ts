/**
 * Multi-MCP Connection Registry — manages connections to N MCP servers,
 * discovers their tools, and provides a unified tool namespace.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
// SSE transport for remote MCP servers
// import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import path from "path";
import { getDb } from "../db/index";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MCPConnection {
  id: string;
  name: string;
  type: "built-in" | "microsoft" | "community" | "custom";
  enabled: boolean;
  transport: "stdio" | "http-sse";
  config: StdioConnectionConfig | HttpConnectionConfig;
  authType: string;
  authConfig?: Record<string, string>;
  tools: DiscoveredTool[];
  healthStatus: "healthy" | "degraded" | "disconnected" | "connecting";
  lastError?: string;
  lastDiscoveredAt?: string;
}

export interface StdioConnectionConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface HttpConnectionConfig {
  url: string;
  headers?: Record<string, string>;
}

export interface DiscoveredTool {
  name: string;
  qualifiedName: string; // "sentinel:search_tables"
  description: string;
  server: string;        // connection ID
  inputSchema: Record<string, unknown>;
}

// ─── Registry ───────────────────────────────────────────────────────────────

const activeClients = new Map<string, { client: Client; lastUsed: number }>();
const discoveredTools = new Map<string, DiscoveredTool[]>(); // connectionId → tools

const BUILT_IN_ID = "built-in";
const MCP_SERVER_PATH = path.resolve(process.cwd(), "../security-scanner-sample/dist/server.js");

/**
 * Initialize DB table for MCP connections.
 */
export function initConnectionsTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_connections (
      id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'custom',
      enabled INTEGER NOT NULL DEFAULT 1,
      transport TEXT NOT NULL DEFAULT 'stdio',
      config TEXT NOT NULL DEFAULT '{}',
      auth_type TEXT NOT NULL DEFAULT 'none',
      auth_config TEXT,
      tools_cache TEXT,
      last_discovered_at TEXT,
      health_status TEXT DEFAULT 'disconnected',
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id, tenant_id)
    )
  `);
}

/**
 * Get all connections for a tenant (built-in + configured).
 */
export function getConnections(tenantId: string): MCPConnection[] {
  initConnectionsTable();
  const db = getDb();
  const rows = db.prepare(
    "SELECT * FROM mcp_connections WHERE tenant_id = ? ORDER BY type, name"
  ).all(tenantId) as Array<Record<string, unknown>>;

  const connections: MCPConnection[] = [
    // Built-in is always first
    {
      id: BUILT_IN_ID,
      name: "Security Scanner (Built-in)",
      type: "built-in",
      enabled: true,
      transport: "stdio",
      config: { command: "node", args: [MCP_SERVER_PATH] } as StdioConnectionConfig,
      authType: "env-vars",
      tools: discoveredTools.get(BUILT_IN_ID) ?? [],
      healthStatus: activeClients.has(BUILT_IN_ID) ? "healthy" : "disconnected",
    },
  ];

  for (const row of rows) {
    connections.push({
      id: row.id as string,
      name: row.name as string,
      type: (row.type as MCPConnection["type"]) ?? "custom",
      enabled: !!(row.enabled as number),
      transport: (row.transport as MCPConnection["transport"]) ?? "stdio",
      config: JSON.parse((row.config as string) || "{}"),
      authType: (row.auth_type as string) ?? "none",
      authConfig: row.auth_config ? JSON.parse(row.auth_config as string) : undefined,
      tools: row.tools_cache ? JSON.parse(row.tools_cache as string) : [],
      healthStatus: (row.health_status as MCPConnection["healthStatus"]) ?? "disconnected",
      lastError: row.last_error as string | undefined,
      lastDiscoveredAt: row.last_discovered_at as string | undefined,
    });
  }

  return connections;
}

/**
 * Save a new MCP connection.
 */
export function saveConnection(tenantId: string, conn: {
  id: string;
  name: string;
  type?: string;
  transport: string;
  config: Record<string, unknown>;
  authType: string;
  authConfig?: Record<string, string>;
}) {
  initConnectionsTable();
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO mcp_connections
      (id, tenant_id, name, type, transport, config, auth_type, auth_config)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    conn.id, tenantId, conn.name, conn.type ?? "custom",
    conn.transport, JSON.stringify(conn.config),
    conn.authType, conn.authConfig ? JSON.stringify(conn.authConfig) : null
  );
}

/**
 * Delete a connection.
 */
export function deleteConnection(connectionId: string, tenantId: string) {
  initConnectionsTable();
  // Disconnect first
  const client = activeClients.get(`${tenantId}:${connectionId}`);
  if (client) {
    client.client.close().catch(() => {});
    activeClients.delete(`${tenantId}:${connectionId}`);
  }
  discoveredTools.delete(connectionId);
  getDb().prepare("DELETE FROM mcp_connections WHERE id = ? AND tenant_id = ?").run(connectionId, tenantId);
}

/**
 * Connect to an MCP server and discover its tools.
 */
export async function connectAndDiscover(
  connectionId: string,
  tenantId: string,
  mcpEnv?: Record<string, string>
): Promise<{ tools: DiscoveredTool[]; error?: string }> {
  const connections = getConnections(tenantId);
  const conn = connections.find(c => c.id === connectionId);
  if (!conn) return { tools: [], error: `Connection '${connectionId}' not found` };

  const clientKey = `${tenantId}:${connectionId}`;

  try {
    let client: Client;

    if (conn.transport === "stdio") {
      const config = conn.config as StdioConnectionConfig;
      const env: Record<string, string> = {
        ...process.env as Record<string, string>,
        ...(config.env ?? {}),
        ...(mcpEnv ?? {}),
        ...(conn.authConfig ?? {}),
      };

      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env,
      });

      client = new Client({ name: "security-dashboard", version: "1.0.0" });
      await client.connect(transport);
    } else if (conn.transport === "http-sse") {
      const config = conn.config as HttpConnectionConfig;
      const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");

      // Build auth headers
      const headers: Record<string, string> = { ...(config.headers ?? {}) };

      if (conn.authType === "az-cli") {
        const { exec } = await import("child_process");
        const { promisify } = await import("util");
        const execAsync = promisify(exec);
        // Derive resource from server URL if not explicitly set
        const resource = conn.authConfig?.resource ??
          (config.url.includes("sentinel.microsoft.com") ? "https://management.azure.com" :
           config.url.includes("graph.microsoft.com") ? "https://graph.microsoft.com" :
           "https://management.azure.com");
        const tenantFlag = conn.authConfig?.tenantId ? ` --tenant ${conn.authConfig.tenantId}` : "";
        try {
          const { stdout } = await execAsync(
            `az account get-access-token --resource ${resource}${tenantFlag} --query accessToken -o tsv`
          );
          headers["Authorization"] = `Bearer ${stdout.trim()}`;
        } catch (authErr) {
          const msg = authErr instanceof Error ? authErr.message : String(authErr);
          if (msg.includes("AADSTS500011") || msg.includes("not found in the tenant")) {
            return { tools: [], error: `This tenant doesn't have the required service enabled. The Sentinel MCP server requires the Sentinel data lake preview to be onboarded. See: https://learn.microsoft.com/en-us/azure/sentinel/datalake/sentinel-lake-onboarding` };
          }
          if (msg.includes("az login")) {
            return { tools: [], error: "Not logged in to Azure CLI. Run 'az login' first." };
          }
          return { tools: [], error: `Azure CLI auth failed: ${msg.substring(0, 200)}` };
        }
      } else if (conn.authType === "bearer" && conn.authConfig?.token) {
        headers["Authorization"] = `Bearer ${conn.authConfig.token}`;
      } else if (conn.authType === "api-key" && conn.authConfig?.headerName && conn.authConfig?.key) {
        headers[conn.authConfig.headerName] = conn.authConfig.key;
      }

      const transport = new SSEClientTransport(new URL(config.url), {
        requestInit: { headers },
      });

      client = new Client({ name: "security-dashboard", version: "1.0.0" });
      await client.connect(transport);
    } else {
      return { tools: [], error: `Unknown transport: ${conn.transport}` };
    }

    // Discover tools
    const result = await client.listTools();
    const tools: DiscoveredTool[] = (result.tools ?? []).map(t => ({
      name: t.name,
      qualifiedName: `${connectionId}:${t.name}`,
      description: (t.description ?? "").substring(0, 200),
      server: connectionId,
      inputSchema: (t.inputSchema ?? {}) as Record<string, unknown>,
    }));

    // Cache
    activeClients.set(clientKey, { client, lastUsed: Date.now() });
    discoveredTools.set(connectionId, tools);

    // Update DB
    initConnectionsTable();
    getDb().prepare(`
      UPDATE mcp_connections
      SET tools_cache = ?, last_discovered_at = datetime('now'), health_status = 'healthy', last_error = NULL
      WHERE id = ? AND tenant_id = ?
    `).run(JSON.stringify(tools), connectionId, tenantId);

    return { tools };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    initConnectionsTable();
    getDb().prepare(`
      UPDATE mcp_connections SET health_status = 'disconnected', last_error = ? WHERE id = ? AND tenant_id = ?
    `).run(msg, connectionId, tenantId);
    return { tools: [], error: msg };
  }
}

/**
 * Get ALL tools from ALL connected servers for a tenant.
 * This is what the agentic executor uses.
 */
export function getAllTools(tenantId: string): DiscoveredTool[] {
  const connections = getConnections(tenantId);
  const allTools: DiscoveredTool[] = [];

  for (const conn of connections) {
    if (!conn.enabled) continue;
    allTools.push(...conn.tools);
  }

  return allTools;
}

/**
 * Call a tool on a specific MCP server.
 */
export async function callToolOnServer(
  connectionId: string,
  tenantId: string,
  toolName: string,
  params: Record<string, unknown>,
  mcpEnv?: Record<string, string>
): Promise<unknown> {
  const clientKey = `${tenantId}:${connectionId}`;
  let entry = activeClients.get(clientKey);

  // Auto-connect if not connected
  if (!entry) {
    const result = await connectAndDiscover(connectionId, tenantId, mcpEnv);
    if (result.error) throw new Error(result.error);
    entry = activeClients.get(clientKey);
    if (!entry) throw new Error(`Failed to connect to ${connectionId}`);
  }

  entry.lastUsed = Date.now();

  const result = await entry.client.callTool({ name: toolName, arguments: params });
  const text = result.content as Array<{ type: string; text: string }>;
  const output = text.map(c => c.text).join("\n");
  try {
    return JSON.parse(output);
  } catch {
    return output;
  }
}

/**
 * Call a tool using qualified name (e.g., "sentinel:search_tables").
 * Routes to the correct server automatically.
 */
export async function callQualifiedTool(
  qualifiedName: string,
  tenantId: string,
  params: Record<string, unknown>,
  mcpEnv?: Record<string, string>
): Promise<unknown> {
  const colonIdx = qualifiedName.indexOf(":");
  if (colonIdx === -1) {
    // No namespace — assume built-in
    return callToolOnServer(BUILT_IN_ID, tenantId, qualifiedName, params, mcpEnv);
  }

  const server = qualifiedName.substring(0, colonIdx);
  const toolName = qualifiedName.substring(colonIdx + 1);
  return callToolOnServer(server, tenantId, toolName, params, mcpEnv);
}
