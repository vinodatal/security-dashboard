import { NextRequest } from "next/server";
import { decrypt } from "./crypto";

const COOKIE_NAME = "sec_session";

export interface SessionData {
  graphToken: string;
  tenantId: string;
  subscriptionId?: string;
}

export function getSession(req: NextRequest): SessionData | null {
  const cookie = req.cookies.get(COOKIE_NAME);
  if (!cookie?.value) return null;
  try {
    // Cookie value may be URL-encoded by the browser/Next.js
    const decoded = decodeURIComponent(cookie.value);
    return JSON.parse(decrypt(decoded));
  } catch {
    return null;
  }
}
