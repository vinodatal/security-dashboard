import { NextRequest, NextResponse } from "next/server";

// Required Graph app permissions for the MCP server
const REQUIRED_PERMISSIONS = [
  "SecurityAlert.Read.All",
  "SecurityIncident.Read.All",
  "SecurityEvents.Read.All",
  "ThreatHunting.Read.All",
  "AuditLog.Read.All",
  "Directory.Read.All",
];

export async function POST(req: NextRequest) {
  const { graphToken } = await req.json();

  if (!graphToken) {
    return NextResponse.json({ error: "graphToken is required" }, { status: 400 });
  }

  const headers = { Authorization: `Bearer ${graphToken}` };

  try {
    // List all app registrations the user owns/can see
    const appRes = await fetch(
      "https://graph.microsoft.com/v1.0/applications?$select=id,appId,displayName,requiredResourceAccess&$top=50",
      { headers }
    );

    if (!appRes.ok) {
      const errText = await appRes.text();
      console.error("check-app failed:", appRes.status, errText);
      return NextResponse.json({ apps: [], error: `Cannot list app registrations (HTTP ${appRes.status})` });
    }

    const appData = await appRes.json();
    const apps = (appData.value ?? []).map((app: any) => {
      // Check which required permissions are configured
      const graphAccess = (app.requiredResourceAccess ?? []).find(
        (r: any) => r.resourceAppId === "00000003-0000-0000-c000-000000000000"
      );
      const configuredRoleIds = (graphAccess?.resourceAccess ?? [])
        .filter((r: any) => r.type === "Role")
        .map((r: any) => r.id);

      return {
        clientId: app.appId,
        objectId: app.id,
        name: app.displayName,
        permissionCount: configuredRoleIds.length,
      };
    });

    return NextResponse.json({ apps });
  } catch (e: any) {
    return NextResponse.json({ apps: [], error: e.message });
  }
}
