import { NextRequest, NextResponse } from "next/server";
import { getTrends } from "@/lib/db";

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get("tenantId");
  const days = parseInt(req.nextUrl.searchParams.get("days") ?? "30", 10);

  if (!tenantId) {
    return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
  }

  const trends = getTrends(tenantId, days);
  return NextResponse.json({ count: trends.length, trends });
}
