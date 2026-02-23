"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import { Sparkline } from "./sparkline";

function Card({ title, icon, children, loading }: { title: string; icon: string; children: React.ReactNode; loading: boolean }) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
      <h2 className="text-lg font-semibold text-white mb-3">{icon} {title}</h2>
      {loading ? (
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-gray-800 rounded w-3/4"></div>
          <div className="h-4 bg-gray-800 rounded w-1/2"></div>
          <div className="h-4 bg-gray-800 rounded w-2/3"></div>
        </div>
      ) : children}
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    high: "bg-red-900 text-red-300",
    critical: "bg-red-950 text-red-200",
    medium: "bg-yellow-900 text-yellow-300",
    low: "bg-blue-900 text-blue-300",
    informational: "bg-gray-800 text-gray-300",
    noncompliant: "bg-red-900 text-red-300",
    compliant: "bg-green-900 text-green-300",
    none: "bg-gray-800 text-gray-300",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[severity?.toLowerCase()] ?? colors.informational}`}>
      {severity}
    </span>
  );
}

function ItemList({ items, renderItem, emptyText, maxItems = 5 }: {
  items: any;
  renderItem: (item: any, i: number) => React.ReactNode;
  emptyText: string;
  maxItems?: number;
}) {
  // Detect errors - could be { error: "..." } or a string containing error info
  const errMsg = items?.error ?? items?.message;
  if (errMsg) {
    const text = typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg);
    return <p className="text-red-400 text-sm">⚠ {text}</p>;
  }
  // Handle different response shapes from MCP tools
  const list = Array.isArray(items) ? items
    : items?.value ?? items?.signIns ?? items?.devices ?? items?.alerts ?? [];
  if (!Array.isArray(list) || list.length === 0) {
    // Check if it's a string (error message from tool)
    if (typeof items === "string" && items.length > 0) {
      return <p className="text-red-400 text-sm">⚠ {items.slice(0, 200)}</p>;
    }
    return <p className="text-green-400 text-sm">{emptyText}</p>;
  }
  return (
    <div className="space-y-2 max-h-64 overflow-y-auto">
      {list.slice(0, maxItems).map(renderItem)}
      {list.length > maxItems && <p className="text-xs text-gray-500">+{list.length - maxItems} more</p>}
    </div>
  );
}

function DashboardContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanRepo, setScanRepo] = useState("");
  const [scanResult, setScanResult] = useState<any>(null);
  const [scanning, setScanning] = useState(false);
  const [expandedAction, setExpandedAction] = useState<number | null>(null);
  const [hoursBack, setHoursBack] = useState(24);
  const [trends, setTrends] = useState<any[]>([]);

  const tenantId = searchParams.get("tenantId") ?? "";
  const subscriptionId = searchParams.get("subscriptionId") ?? "";
  const userToken = searchParams.get("userToken") ?? "";
  const clientId = searchParams.get("clientId") ?? "";
  const clientSecret = searchParams.get("clientSecret") ?? "";

  const fetchData = (hours: number) => {
    setLoading(true);
    setError(null);
    fetch("/api/dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId, subscriptionId, userToken, clientId, clientSecret, hoursBack: hours }),
    })
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!tenantId || !userToken) { router.push("/"); return; }
    fetchData(hoursBack);
    // Fetch trends
    fetch(`/api/trends?tenantId=${encodeURIComponent(tenantId)}&days=30`)
      .then((r) => r.json())
      .then((d) => setTrends(d.trends ?? []))
      .catch(() => {});
  }, [tenantId, subscriptionId, userToken, router]);

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scanRepo) return;
    setScanning(true);
    setScanResult(null);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: scanRepo }),
      });
      setScanResult(await res.json());
    } catch (e: any) {
      setScanResult({ error: e.message });
    } finally {
      setScanning(false);
    }
  };

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="bg-red-950 border border-red-800 rounded-xl p-6 max-w-md">
          <p className="text-red-300">Error: {error}</p>
          <button onClick={() => router.push("/")} className="mt-4 px-4 py-2 bg-gray-800 text-white rounded-lg">← Back</button>
        </div>
      </div>
    );
  }

  const alerts = data?.alerts;
  const score = data?.secureScore;
  const risky = data?.riskyUsers;
  const signIns = data?.signInLogs;
  const devices = data?.intuneDevices;
  const purview = data?.purviewAlerts;
  const recommendations = data?.recommendations;
  const insiderRisk = data?.insiderRiskAlerts;
  const dataPosture = data?.dataPosture;

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-white">🛡️ Security Dashboard</h1>
          <div className="flex items-center gap-3">
            <select
              value={hoursBack}
              onChange={(e) => { const h = Number(e.target.value); setHoursBack(h); fetchData(h); }}
              className="px-2 py-1 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={1}>Last 1 hour</option>
              <option value={6}>Last 6 hours</option>
              <option value={24}>Last 24 hours</option>
              <option value={72}>Last 3 days</option>
              <option value={168}>Last 7 days</option>
              <option value={720}>Last 30 days</option>
            </select>
            <span className="text-xs text-gray-500 font-mono">{tenantId.slice(0, 8)}...</span>
            <button onClick={() => router.push("/")} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-lg">
              Disconnect
            </button>
          </div>
        </div>

        {/* Row 1: Score, Alerts, Risky Users */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-4">
          <Card title="Secure Score" icon="📊" loading={loading}>
            {score?.error ? (
              <p className="text-red-400 text-sm">{typeof score.error === "string" ? score.error : JSON.stringify(score.error)}</p>
            ) : score?.currentScore !== undefined && score?.currentScore !== 0 ? (
              <div>
                <div className="flex items-end gap-2">
                  <span className="text-4xl font-bold text-white">
                    {score.percentageScore ?? Math.round((score.currentScore / (score.maxScore || 100)) * 100)}%
                  </span>
                  <span className="text-sm text-gray-500 mb-1">
                    {Math.round(score.currentScore)}/{Math.round(score.maxScore ?? 100)} pts
                  </span>
                </div>
                <div className="mt-2 w-full bg-gray-800 rounded-full h-2.5">
                  <div
                    className={`h-2.5 rounded-full ${score.percentageScore >= 70 ? "bg-green-500" : score.percentageScore >= 40 ? "bg-yellow-500" : "bg-red-500"}`}
                    style={{ width: `${(score.currentScore / (score.maxScore || 100)) * 100}%` }}
                  ></div>
                </div>
                {trends.length > 1 && (
                  <div className="mt-3">
                    <p className="text-xs text-gray-500 mb-1">30-day trend</p>
                    <Sparkline data={trends.map((t: any) => t.secure_score_pct ?? 0)} color="#3b82f6" />
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">Requires app registration with SecurityEvents.Read.All</p>
            )}
          </Card>

          <Card title="Defender Alerts" icon="🚨" loading={loading}>
            <ItemList
              items={alerts}
              emptyText="✓ No active alerts"
              renderItem={(a, i) => (
                <div key={i} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                  <span className="text-sm text-gray-300 truncate mr-2">{a.title ?? a.displayName ?? "Alert"}</span>
                  <SeverityBadge severity={a.severity ?? "unknown"} />
                </div>
              )}
            />
            {trends.length > 1 && (
              <div className="mt-2">
                <Sparkline data={trends.map((t: any) => t.defender_alert_count ?? 0)} color="#ef4444" />
              </div>
            )}
          </Card>

          <Card title="Risky Users" icon="👤" loading={loading}>
            <ItemList
              items={risky}
              emptyText="✓ No risky users"
              renderItem={(u, i) => (
                <div key={i} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                  <span className="text-sm text-gray-300 truncate mr-2">{u.userDisplayName ?? u.userPrincipalName ?? "User"}</span>
                  <SeverityBadge severity={u.riskLevel ?? "none"} />
                </div>
              )}
            />
          </Card>
        </div>

        {/* Row 2: Sign-ins, Devices, Purview */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-4">
          <Card title={`Recent Sign-ins (${hoursBack}h)`} icon="🔑" loading={loading}>
            {(() => {
              const rawList = Array.isArray(signIns) ? signIns : signIns?.value ?? signIns?.signIns ?? [];
              if (signIns?.error) return <p className="text-red-400 text-sm">⚠ {typeof signIns.error === "string" ? signIns.error : JSON.stringify(signIns.error)}</p>;
              if (!Array.isArray(rawList) || rawList.length === 0) return <p className="text-green-400 text-sm">No recent sign-in data</p>;
              // Group by user
              const grouped: Record<string, { count: number; user: string; apps: Set<string>; locations: Set<string>; riskLevel: string; earliest: string; latest: string }> = {};
              for (const s of rawList) {
                const user = s.userPrincipalName ?? s.userDisplayName ?? "Unknown";
                if (!grouped[user]) {
                  grouped[user] = { count: 0, user, apps: new Set(), locations: new Set(), riskLevel: "none", earliest: s.createdDateTime, latest: s.createdDateTime };
                }
                grouped[user].count++;
                if (s.appDisplayName) grouped[user].apps.add(s.appDisplayName);
                if (s.location?.city) grouped[user].locations.add(`${s.location.city}, ${s.location.countryOrRegion}`);
                if (s.riskLevelDuringSignIn && s.riskLevelDuringSignIn !== "none") grouped[user].riskLevel = s.riskLevelDuringSignIn;
                if (s.createdDateTime < grouped[user].earliest) grouped[user].earliest = s.createdDateTime;
                if (s.createdDateTime > grouped[user].latest) grouped[user].latest = s.createdDateTime;
              }
              const users = Object.values(grouped).sort((a, b) => b.count - a.count);
              return (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {users.slice(0, 8).map((u, i) => (
                    <div key={i} className="bg-gray-800 rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-300 truncate mr-2">{u.user}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-gray-500">{u.count}x</span>
                          <SeverityBadge severity={u.riskLevel} />
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        {[...u.apps].slice(0, 3).map((app, j) => (
                          <span key={j} className="text-xs bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">{app}</span>
                        ))}
                        {u.apps.size > 3 && <span className="text-xs text-gray-600">+{u.apps.size - 3}</span>}
                        {u.locations.size > 0 && <span className="text-xs text-gray-600">• {[...u.locations][0]}</span>}
                      </div>
                    </div>
                  ))}
                  {users.length > 8 && <p className="text-xs text-gray-500">+{users.length - 8} more users</p>}
                </div>
              );
            })()}
          </Card>

          <Card title="Non-Compliant Devices" icon="💻" loading={loading}>
            <ItemList
              items={devices}
              emptyText="✓ All devices compliant"
              renderItem={(d, i) => (
                <div key={i} className="bg-gray-800 rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300 truncate mr-2">{d.deviceName ?? "Device"}</span>
                    <SeverityBadge severity={d.complianceState ?? "unknown"} />
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {d.operatingSystem && <span className="text-xs text-gray-500">{d.operatingSystem}</span>}
                    {d.userPrincipalName && <span className="text-xs text-gray-600">• {d.userPrincipalName}</span>}
                  </div>
                </div>
              )}
            />
          </Card>

          <Card title="Purview Alerts" icon="📋" loading={loading}>
            <ItemList
              items={purview}
              emptyText="✓ No compliance alerts"
              renderItem={(p, i) => (
                <div key={i} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                  <span className="text-sm text-gray-300 truncate mr-2">{p.title ?? p.displayName ?? "Alert"}</span>
                  <SeverityBadge severity={p.severity ?? "unknown"} />
                </div>
              )}
            />
          </Card>
        </div>

        {/* Row 3: Insider Risk, Data Security Posture */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <Card title="Insider Risk Alerts" icon="🕵️" loading={loading}>
            <ItemList
              items={insiderRisk}
              emptyText="✓ No insider risk alerts"
              renderItem={(a, i) => (
                <div key={i} className="bg-gray-800 rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-300 truncate mr-2">{a.title ?? "Alert"}</span>
                    <SeverityBadge severity={a.severity ?? "unknown"} />
                  </div>
                  {a.createdDateTime && <span className="text-xs text-gray-500">{new Date(a.createdDateTime).toLocaleString()}</span>}
                </div>
              )}
            />
          </Card>

          <Card title="Data Security Posture" icon="🏗️" loading={loading}>
            {dataPosture?.error ? (
              <p className="text-red-400 text-sm">⚠ {typeof dataPosture.error === "string" ? dataPosture.error : JSON.stringify(dataPosture.error)}</p>
            ) : dataPosture ? (
              <div className="space-y-3">
                {dataPosture.sensitivityLabels && !dataPosture.sensitivityLabels.error && (
                  <div>
                    <p className="text-xs font-medium text-gray-400 mb-1">Sensitivity Labels</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(dataPosture.sensitivityLabels.labels ?? []).slice(0, 8).map((l: any, i: number) => (
                        <span key={i} className={`text-xs px-2 py-0.5 rounded ${l.isActive ? "bg-blue-900 text-blue-300" : "bg-gray-700 text-gray-500"}`}>
                          {l.name}
                        </span>
                      ))}
                      {(dataPosture.sensitivityLabels.count ?? 0) > 8 && (
                        <span className="text-xs text-gray-500">+{dataPosture.sensitivityLabels.count - 8} more</span>
                      )}
                    </div>
                  </div>
                )}
                {dataPosture.dlpAlerts && !dataPosture.dlpAlerts.error && (
                  <div>
                    <p className="text-xs font-medium text-gray-400 mb-1">DLP Alert Trends</p>
                    <div className="flex gap-3">
                      {Object.entries(dataPosture.dlpAlerts.bySeverity ?? {}).map(([sev, count]) => (
                        <div key={sev} className="text-center">
                          <span className="text-lg font-bold text-white">{count as number}</span>
                          <p className="text-xs text-gray-500">{sev}</p>
                        </div>
                      ))}
                      {Object.keys(dataPosture.dlpAlerts.bySeverity ?? {}).length === 0 && (
                        <p className="text-green-400 text-sm">✓ No DLP alerts</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No posture data available</p>
            )}
          </Card>
        </div>

        {/* Improvement Actions — full width */}
        {!loading && score && !score.error && score?.topActions?.length > 0 && (
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 mb-4">
            <h2 className="text-lg font-semibold text-white mb-4">
              🎯 Improvement Actions
              <span className="text-sm text-gray-500 font-normal ml-2">{score.topActions.length} recommendations</span>
            </h2>
            <div className="space-y-2">
              {score.topActions.map((a: any, i: number) => (
                <div key={i} className="bg-gray-800 rounded-lg px-4 py-3">
                  <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpandedAction(expandedAction === i ? null : i)}>
                    <span className="text-sm text-gray-200 truncate mr-3">{a.name}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      {a.implementationStatus && (
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          a.implementationStatus === "implemented" ? "bg-green-900 text-green-300" :
                          a.implementationStatus === "thirdParty" ? "bg-purple-900 text-purple-300" :
                          a.implementationStatus === "planned" ? "bg-blue-900 text-blue-300" :
                          "bg-gray-700 text-gray-400"
                        }`}>{a.implementationStatus}</span>
                      )}
                      <span className="text-sm font-medium text-blue-400 w-16 text-right">+{a.maxScore - (a.currentScore ?? 0)} pts</span>
                      <span className="text-gray-500 w-4 text-center">{expandedAction === i ? "▲" : "▼"}</span>
                    </div>
                  </div>
                  {expandedAction === i && a.description && (
                    <div
                      className="text-sm text-gray-400 mt-3 border-t border-gray-700 pt-3 prose prose-invert prose-sm max-w-none [&_a]:text-blue-400 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_p]:my-1.5"
                      dangerouslySetInnerHTML={{ __html: a.description }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Security Recommendations — full width */}
        {!loading && recommendations && (
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 mb-4">
            <h2 className="text-lg font-semibold text-white mb-4">🔒 Security Recommendations</h2>
            {recommendations?.error ? (
              <p className="text-red-400 text-sm">⚠ {typeof recommendations.error === "string" ? recommendations.error : JSON.stringify(recommendations.error)}</p>
            ) : recommendations?.recommendations?.length > 0 ? (
              <div className="space-y-2">
                {recommendations.recommendations.map((r: any, i: number) => (
                  <div key={i} className="bg-gray-800 rounded-lg px-4 py-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-200 truncate mr-3">{r.name}</span>
                      <div className="flex items-center gap-3 shrink-0">
                        {r.category && <span className="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-400">{r.category}</span>}
                        {r.userImpact && <span className="text-xs text-gray-500">Impact: {r.userImpact}</span>}
                        <span className="text-sm font-medium text-blue-400">+{r.maxScore} pts</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-sm">No recommendations available</p>
            )}
          </div>
        )}

        {/* Repo Scan */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h2 className="text-lg font-semibold text-white mb-3">🔍 Repository Scan</h2>
          <form onSubmit={handleScan} className="flex gap-3">
            <input
              type="text"
              value={scanRepo}
              onChange={(e) => setScanRepo(e.target.value)}
              placeholder="owner/repo (e.g. octocat/Hello-World)"
              className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button type="submit" disabled={scanning} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded-lg font-medium">
              {scanning ? "Scanning..." : "Scan"}
            </button>
          </form>
          {scanResult && (
            <pre className="mt-4 p-4 bg-gray-800 rounded-lg text-sm text-gray-300 overflow-x-auto max-h-80 overflow-y-auto">
              {JSON.stringify(scanResult, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950 flex items-center justify-center"><p className="text-gray-400">Loading...</p></div>}>
      <DashboardContent />
    </Suspense>
  );
}
