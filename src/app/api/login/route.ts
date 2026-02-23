import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

async function azToken(resource: string, tenantId?: string): Promise<string> {
  const tenantFlag = tenantId ? ` --tenant ${tenantId}` : "";
  const { stdout } = await execAsync(
    `az account get-access-token --resource ${resource}${tenantFlag} --query accessToken -o tsv`
  );
  return stdout.trim();
}

async function azAccount(): Promise<{ name: string; tenantId: string; user: string }> {
  const { stdout } = await execAsync(
    `az account show --query "{name:name, tenantId:tenantId, user:user.name}" -o json`
  );
  return JSON.parse(stdout);
}

// GET /api/login — initial login, returns tenants list
export async function GET() {
  try {
    const [account, armToken] = await Promise.all([
      azAccount(),
      azToken("https://management.azure.com"),
    ]);

    // Fetch tenants
    const tenantsRes = await fetch(
      "https://management.azure.com/tenants?api-version=2022-12-01",
      { headers: { Authorization: `Bearer ${armToken}` } }
    );

    let tenants: any[] = [];
    if (tenantsRes.ok) {
      const td = await tenantsRes.json();
      tenants = (td.value ?? []).map((t: any) => ({
        tenantId: t.tenantId,
        displayName: t.displayName || t.tenantId,
      }));
    }
    if (tenants.length === 0) {
      tenants = [{ tenantId: account.tenantId, displayName: account.name }];
    }

    return NextResponse.json({
      user: { displayName: account.user, userPrincipalName: account.user },
      tenants,
      currentTenantId: account.tenantId,
    });
  } catch (e: any) {
    return NextResponse.json({ error: formatAzError(e) }, { status: 401 });
  }
}

// POST /api/login — get tokens + subscriptions for a specific tenant
export async function POST(req: NextRequest) {
  const { tenantId } = await req.json();

  if (!tenantId) {
    return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
  }

  try {
    const [graphToken, armToken] = await Promise.all([
      azToken("https://graph.microsoft.com", tenantId),
      azToken("https://management.azure.com", tenantId),
    ]);

    // Fetch user profile and subscriptions for this tenant
    const [meRes, subsRes] = await Promise.all([
      fetch("https://graph.microsoft.com/v1.0/me?$select=displayName,userPrincipalName", {
        headers: { Authorization: `Bearer ${graphToken}` },
      }),
      fetch("https://management.azure.com/subscriptions?api-version=2022-12-01", {
        headers: { Authorization: `Bearer ${armToken}` },
      }),
    ]);

    const me = meRes.ok
      ? await meRes.json()
      : { displayName: "Unknown", userPrincipalName: "Unknown" };

    let subscriptions: any[] = [];
    if (subsRes.ok) {
      const sd = await subsRes.json();
      subscriptions = (sd.value ?? [])
        .filter((s: any) => s.tenantId === tenantId)
        .map((s: any) => ({
          subscriptionId: s.subscriptionId,
          displayName: s.displayName || s.subscriptionId,
          tenantId: s.tenantId,
        }));
    }

    return NextResponse.json({ user: me, subscriptions, graphToken });
  } catch (e: any) {
    return NextResponse.json({ error: formatAzError(e) }, { status: 500 });
  }
}

function formatAzError(e: any): string {
  const msg = e.message || "";
  if (msg.includes("not found") || msg.includes("not recognized")) {
    return "Azure CLI not found. Install it and run 'az login' first.";
  }
  if (msg.includes("az login") || msg.includes("Please run")) {
    return "Not logged in. Run 'az login' in your terminal first.";
  }
  return msg;
}
