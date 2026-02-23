"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Tenant {
  tenantId: string;
  displayName: string;
}

interface Subscription {
  subscriptionId: string;
  displayName: string;
}

interface AppInfo {
  clientId: string;
  name: string;
  permissionCount: number;
}

type Step = "idle" | "signing-in" | "pick-tenant" | "loading-tenant" | "ready";

export default function Home() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState("");

  const [userName, setUserName] = useState("");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState("");

  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [selectedSub, setSelectedSub] = useState("");
  const [graphToken, setGraphToken] = useState("");

  const [apps, setApps] = useState<AppInfo[]>([]);
  const [selectedApp, setSelectedApp] = useState<string>("");
  const [appSecret, setAppSecret] = useState("");
  const [creatingApp, setCreatingApp] = useState(false);
  const [hasStoredCreds, setHasStoredCreds] = useState(false);
  const [showAdminSetup, setShowAdminSetup] = useState(false);
  const [adminSecret, setAdminSecret] = useState("");

  // Step 1: Sign in — get user + tenant list
  const handleSignIn = async () => {
    setError("");
    setStep("signing-in");
    try {
      const res = await fetch("/api/login");
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setStep("idle");
        return;
      }
      setUserName(data.user?.displayName || data.user?.userPrincipalName || "User");
      setTenants(data.tenants ?? []);
      setSelectedTenant(data.currentTenantId || data.tenants?.[0]?.tenantId || "");
      setStep("pick-tenant");
    } catch (e: any) {
      setError(e.message || "Sign-in failed");
      setStep("idle");
    }
  };

  // Step 2: Select tenant — load subscriptions + check app
  const handleSelectTenant = async () => {
    if (!selectedTenant) return;
    setError("");
    setStep("loading-tenant");
    try {
      // Get tokens + subscriptions for selected tenant
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: selectedTenant }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setStep("pick-tenant");
        return;
      }

      setUserName(data.user?.displayName || userName);
      setSubscriptions(data.subscriptions ?? []);
      setSelectedSub(data.subscriptions?.[0]?.subscriptionId || "");
      setGraphToken(data.graphToken);

      // Check for app registrations
      const appRes = await fetch("/api/check-app", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ graphToken: data.graphToken, tenantId: selectedTenant }),
      });
      const appData = await appRes.json();
      setApps(appData.apps ?? []);
      if (appData.apps?.length > 0) setSelectedApp(appData.apps[0].clientId);

      // Check if credentials are already stored server-side
      const adminRes = await fetch("/api/admin");
      const adminData = await adminRes.json();
      const stored = (adminData.tenants ?? []).find((t: any) => t.tenantId === selectedTenant);
      setHasStoredCreds(!!stored);

      setStep("ready");
    } catch (e: any) {
      setError(e.message || "Failed to load tenant");
      setStep("pick-tenant");
    }
  };

  const handleCreateApp = async () => {
    setCreatingApp(true);
    setError("");
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: selectedTenant, graphToken }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      setApps((prev) => [...prev, { clientId: data.clientId, name: "Security Dashboard", permissionCount: 6 }]);
      setSelectedApp(data.clientId);
      // Capture client secret from setup for app-only token flow
      const secret = data.details?.credentials?.AZURE_CLIENT_SECRET;
      if (secret) setAppSecret(secret);
    } catch (e: any) {
      setError(e.message || "Failed to create app");
    } finally {
      setCreatingApp(false);
    }
  };

  const handleSaveCredentials = async () => {
    if (!selectedApp || !adminSecret) {
      setError("Select an app and enter the client secret");
      return;
    }
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: selectedTenant, clientId: selectedApp, clientSecret: adminSecret }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setHasStoredCreds(true);
      setAdminSecret("");
      setShowAdminSetup(false);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleViewDashboard = async () => {
    // Store token in httpOnly cookie — never in URL
    await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        graphToken,
        tenantId: selectedTenant,
        subscriptionId: selectedSub,
      }),
    });
    router.push(`/dashboard?tenantId=${encodeURIComponent(selectedTenant)}&subscriptionId=${encodeURIComponent(selectedSub)}`);
  };

  const tenantName = tenants.find((t) => t.tenantId === selectedTenant)?.displayName || "";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">🛡️ Security Dashboard</h1>
          <p className="text-gray-400">View your Azure security posture</p>
        </div>

        <div className="bg-gray-900 rounded-xl p-6 space-y-4 border border-gray-800">

          {/* Step 1: Sign in */}
          {step === "idle" && (
            <>
              <p className="text-sm text-gray-400 text-center">
                Uses your Azure CLI session. Run{" "}
                <code className="bg-gray-800 px-1.5 py-0.5 rounded text-blue-400">az login</code>{" "}
                first if you haven&apos;t already.
              </p>
              <button
                onClick={handleSignIn}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors text-lg"
              >
                Sign In
              </button>
            </>
          )}

          {step === "signing-in" && (
            <div className="text-center py-8">
              <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-gray-400">Reading Azure CLI session...</p>
            </div>
          )}

          {/* Step 2: Pick tenant */}
          {step === "pick-tenant" && (
            <>
              <div className="flex items-center gap-3 bg-gray-800 rounded-lg px-3 py-2">
                <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-bold">
                  {userName[0]?.toUpperCase() ?? "?"}
                </div>
                <p className="text-sm text-white">{userName}</p>
                <button
                  onClick={() => { setStep("idle"); setTenants([]); }}
                  className="ml-auto text-xs text-gray-500 hover:text-gray-300"
                >
                  Sign out
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Select Tenant ({tenants.length} available)
                </label>
                <select
                  value={selectedTenant}
                  onChange={(e) => setSelectedTenant(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {tenants.map((t) => (
                    <option key={t.tenantId} value={t.tenantId}>
                      {t.displayName} ({t.tenantId.slice(0, 8)}...)
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleSelectTenant}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
              >
                Connect to Tenant →
              </button>
            </>
          )}

          {step === "loading-tenant" && (
            <div className="text-center py-8">
              <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-gray-400">Loading {tenantName}...</p>
            </div>
          )}

          {/* Step 3: Ready — subscription, app status, launch */}
          {step === "ready" && (
            <>
              {/* User + tenant */}
              <div className="flex items-center gap-3 bg-gray-800 rounded-lg px-3 py-2">
                <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-bold">
                  {userName[0]?.toUpperCase() ?? "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{userName}</p>
                  <p className="text-xs text-gray-400 truncate">{tenantName}</p>
                </div>
                <button
                  onClick={() => setStep("pick-tenant")}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Switch
                </button>
              </div>

              {/* Subscription */}
              {subscriptions.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Subscription</label>
                  <select
                    value={selectedSub}
                    onChange={(e) => setSelectedSub(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {subscriptions.map((s) => (
                      <option key={s.subscriptionId} value={s.subscriptionId}>
                        {s.displayName}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* App registration */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  App Registration ({apps.length} found)
                </label>
                {apps.length > 0 ? (
                  <>
                    <select
                      value={selectedApp}
                      onChange={(e) => setSelectedApp(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {apps.map((a) => (
                        <option key={a.clientId} value={a.clientId}>
                          {a.name} — {a.permissionCount} permissions
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={handleCreateApp}
                      disabled={creatingApp}
                      className="mt-2 text-xs text-blue-400 hover:text-blue-300"
                    >
                      {creatingApp ? "Updating permissions..." : "Update permissions & grant consent"}
                    </button>

                    {/* Credential status */}
                    {hasStoredCreds ? (
                      <div className="mt-2 bg-green-950 border border-green-800 rounded-lg px-3 py-2">
                        <p className="text-xs text-green-300">✓ App credentials stored securely (encrypted)</p>
                      </div>
                    ) : (
                      <div className="mt-2">
                        <button
                          onClick={() => setShowAdminSetup(!showAdminSetup)}
                          className="text-xs text-yellow-400 hover:text-yellow-300"
                        >
                          {showAdminSetup ? "Hide admin setup" : "⚠ Set up app credentials (admin one-time)"}
                        </button>
                        {showAdminSetup && (
                          <div className="mt-2 space-y-2 border border-gray-700 rounded-lg p-3 bg-gray-800/50">
                            <p className="text-xs text-gray-400">
                              Enter the client secret once. It will be encrypted and stored server-side.
                              Regular users won&apos;t need to enter it again.
                            </p>
                            <input
                              type="password"
                              value={adminSecret}
                              onChange={(e) => setAdminSecret(e.target.value)}
                              placeholder="Client secret from Azure Portal"
                              className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                            />
                            <button
                              onClick={handleSaveCredentials}
                              className="w-full py-1.5 bg-green-700 hover:bg-green-600 text-white text-xs font-medium rounded-lg"
                            >
                              Save Credentials (Encrypted)
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="bg-yellow-950 border border-yellow-800 rounded-lg px-4 py-3">
                    <p className="text-sm text-yellow-300 font-medium">No app registrations found</p>
                    <p className="text-xs text-yellow-400/70 mt-1">
                      An app with security API permissions is needed for Defender, Hunting, and Threat Intel tools.
                    </p>
                    <button
                      onClick={handleCreateApp}
                      disabled={creatingApp}
                      className="mt-2 px-3 py-1.5 bg-yellow-700 hover:bg-yellow-600 disabled:bg-yellow-800 text-white text-xs font-medium rounded-lg transition-colors"
                    >
                      {creatingApp ? "Creating..." : "Create App Registration"}
                    </button>
                  </div>
                )}
              </div>

              {/* Launch */}
              <button
                onClick={handleViewDashboard}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
              >
                View Dashboard →
              </button>
            </>
          )}

          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
        </div>
      </div>
    </div>
  );
}
