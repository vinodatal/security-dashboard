import { NextRequest, NextResponse } from "next/server";
import { callTool } from "@/lib/mcp-client";

export async function POST(req: NextRequest) {
  const { tenantId, graphToken } = await req.json();

  if (!tenantId || !graphToken) {
    return NextResponse.json({ error: "tenantId and graphToken are required" }, { status: 400 });
  }

  try {
    // Use MCP tool to create app with security permissions
    const setupResult = await callTool("setup_app_registration", {
      tenantId,
      userToken: graphToken,
      appName: "Security Dashboard",
    });

    const appId = setupResult?.credentials?.AZURE_CLIENT_ID;

    if (!appId) {
      return NextResponse.json({ error: "App creation failed", details: setupResult }, { status: 500 });
    }

    // Patch app to add SPA redirect URI
    const searchResp = await fetch(
      `https://graph.microsoft.com/v1.0/applications?$filter=appId eq '${appId}'&$select=id`,
      { headers: { Authorization: `Bearer ${graphToken}` } }
    );
    const searchData = await searchResp.json();
    const objectId = searchData.value?.[0]?.id;

    if (objectId) {
      await fetch(`https://graph.microsoft.com/v1.0/applications/${objectId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${graphToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ spa: { redirectUris: ["http://localhost:3001"] } }),
      });
    }

    return NextResponse.json({ clientId: appId, details: setupResult });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Setup failed" }, { status: 500 });
  }
}
