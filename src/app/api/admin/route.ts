import { NextRequest, NextResponse } from "next/server";
import { saveTenantCredentials, listTenantCredentials, getTenantCredentials } from "@/lib/db";
import { encrypt } from "@/lib/crypto";

// GET /api/admin — list configured tenants (no secrets returned)
export async function GET() {
  const tenants = listTenantCredentials();
  return NextResponse.json({ tenants });
}

// POST /api/admin — save tenant credentials (admin one-time setup)
export async function POST(req: NextRequest) {
  const { tenantId, clientId, clientSecret } = await req.json();

  if (!tenantId || !clientId || !clientSecret) {
    return NextResponse.json(
      { error: "tenantId, clientId, and clientSecret are required" },
      { status: 400 }
    );
  }

  // Encrypt the secret before storing
  const encryptedSecret = encrypt(clientSecret);
  saveTenantCredentials(tenantId, clientId, encryptedSecret);

  return NextResponse.json({
    message: "Credentials saved securely (encrypted at rest)",
    tenantId,
    clientId,
  });
}
