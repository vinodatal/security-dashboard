import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";

const MCP_SERVER_PATH = path.resolve(process.cwd(), "../security-scanner-sample/dist/server.js");
const DEFAULT_TIMEOUT_MS = 30_000;
const SLOW_TOOLS = new Set(["detect_privileged_user_risks", "search_purview_audit", "get_data_security_posture"]);
const SLOW_TIMEOUT_MS = 90_000;

// Persistent client pool
const pool = new Map<string, { client: Client; lastUsed: number }>();

function envKey(env?: Record<string, string>): string {
  if (!env) return "default";
  return `${env.AZURE_CLIENT_ID ?? ""}:${env.AZURE_TENANT_ID ?? ""}`;
}

async function getClient(env?: Record<string, string>): Promise<Client> {
  const key = envKey(env);
  const existing = pool.get(key);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.client;
  }

  const transport = new StdioClientTransport({
    command: "node",
    args: [MCP_SERVER_PATH],
    env: { ...process.env, ...env } as Record<string, string>,
  });

  const client = new Client({ name: "security-dashboard", version: "1.0.0" });
  await client.connect(transport);
  pool.set(key, { client, lastUsed: Date.now() });

  // Auto-cleanup after 5 min idle
  setTimeout(() => {
    const entry = pool.get(key);
    if (entry && Date.now() - entry.lastUsed > 5 * 60 * 1000) {
      entry.client.close().catch(() => {});
      pool.delete(key);
    }
  }, 5 * 60 * 1000);

  return client;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

export async function callTool(
  toolName: string,
  args: Record<string, unknown>,
  env?: Record<string, string>
) {
  const client = await getClient(env);
  try {
    const timeoutMs = SLOW_TOOLS.has(toolName) ? SLOW_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
    const result = await withTimeout(
      client.callTool({ name: toolName, arguments: args }),
      timeoutMs,
      toolName
    );
    const text = result.content as Array<{ type: string; text: string }>;
    const output = text.map((c) => c.text).join("\n");
    try {
      return JSON.parse(output);
    } catch {
      return output;
    }
  } catch (e: any) {
    // If connection died, remove from pool and retry once
    if (e.message?.includes("timed out")) {
      return { error: `${toolName} timed out (>${(SLOW_TOOLS.has(toolName) ? SLOW_TIMEOUT_MS : DEFAULT_TIMEOUT_MS) / 1000}s)` };
    }
    pool.delete(envKey(env));
    try {
      const client2 = await getClient(env);
      const timeoutMs2 = SLOW_TOOLS.has(toolName) ? SLOW_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
      const result = await withTimeout(
        client2.callTool({ name: toolName, arguments: args }),
        timeoutMs2,
        toolName
      );
      const text = result.content as Array<{ type: string; text: string }>;
      const output = text.map((c) => c.text).join("\n");
      try {
        return JSON.parse(output);
      } catch {
        return output;
      }
    } catch (e2: any) {
      return { error: e2.message ?? "Tool call failed" };
    }
  }
}
