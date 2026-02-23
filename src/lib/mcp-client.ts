import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";

const MCP_SERVER_PATH = path.resolve(
  process.cwd(),
  "../security-scanner-sample/dist/server.js"
);

export async function createMcpClient(env?: Record<string, string>) {
  const transport = new StdioClientTransport({
    command: "node",
    args: [MCP_SERVER_PATH],
    env: { ...process.env, ...env } as Record<string, string>,
  });

  const client = new Client({ name: "security-dashboard", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

export async function callTool(
  toolName: string,
  args: Record<string, unknown>,
  env?: Record<string, string>
) {
  const client = await createMcpClient(env);
  try {
    const result = await client.callTool({ name: toolName, arguments: args });
    const text = result.content as Array<{ type: string; text: string }>;
    const output = text.map((c) => c.text).join("\n");
    try {
      return JSON.parse(output);
    } catch {
      return output;
    }
  } finally {
    await client.close();
  }
}
