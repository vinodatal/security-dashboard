import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const ENDPOINT = "https://models.inference.ai.azure.com/chat/completions";
const MODEL = "gpt-4o-mini";

async function getGitHubToken(): Promise<string> {
  // Use gh CLI token
  const { stdout } = await execAsync("gh auth token");
  return stdout.trim();
}

export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface AgentTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export async function chatCompletion(
  messages: AgentMessage[],
  tools?: AgentTool[],
  maxTokens = 1000
): Promise<{ message: AgentMessage; finishReason: string }> {
  const token = await getGitHubToken();

  const body: any = {
    model: MODEL,
    messages,
    max_tokens: maxTokens,
    temperature: 0.3,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const resp = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`LLM API ${resp.status}: ${err.slice(0, 200)}`);
  }

  const data = await resp.json();
  const choice = data.choices[0];
  return {
    message: choice.message,
    finishReason: choice.finish_reason,
  };
}
