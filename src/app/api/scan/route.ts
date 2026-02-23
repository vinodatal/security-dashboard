import { NextRequest, NextResponse } from "next/server";
import { callTool } from "@/lib/mcp-client";

export async function POST(req: NextRequest) {
  const { repo, branch, githubToken } = await req.json();

  if (!repo) {
    return NextResponse.json({ error: "repo is required" }, { status: 400 });
  }

  const env = githubToken ? { GITHUB_TOKEN: githubToken } : undefined;

  const result = await callTool(
    "scan_repository",
    { repo, branch: branch || "main", scanTypes: ["dependencies", "secrets"] },
    env
  );

  return NextResponse.json(result);
}
