"use client";

import { useEffect, useState, Suspense, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Connection {
  id: string;
  name: string;
  type: "built-in" | "microsoft" | "community" | "custom";
  enabled: boolean;
  transport: "stdio" | "sse";
  authType: string;
  toolCount: number;
  healthStatus: "healthy" | "degraded" | "disconnected" | "not_connected";
  lastError?: string;
  lastDiscoveredAt?: string;
}

interface DiscoveredTool {
  name: string;
  qualifiedName: string;
  description: string;
  server: string;
}

interface ListResponse {
  connections: Connection[];
  totalConnections: number;
  totalTools: number;
}

interface DiscoverResponse {
  connectionId: string;
  toolCount: number;
  tools: { name: string; qualifiedName: string; description: string }[];
  error?: string;
}

interface AllToolsResponse {
  tools: DiscoveredTool[];
  totalTools: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATUS_INDICATORS: Record<Connection["healthStatus"], string> = {
  healthy: "🟢",
  degraded: "🟡",
  disconnected: "🔴",
  not_connected: "⚪",
};

const STATUS_COLORS: Record<Connection["healthStatus"], string> = {
  healthy: "text-emerald-600 dark:text-emerald-400",
  degraded: "text-yellow-600 dark:text-yellow-400",
  disconnected: "text-red-600 dark:text-red-400",
  not_connected: "text-gray-500 dark:text-gray-400",
};

const TYPE_BADGE_COLORS: Record<Connection["type"], string> = {
  "built-in": "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  microsoft: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  community: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  custom: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

async function api<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/connections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    window.location.href = "/";
    throw new Error("Not authenticated");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

// ── Inline Components ──────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: Connection["type"] }) {
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium ${TYPE_BADGE_COLORS[type] ?? TYPE_BADGE_COLORS.custom}`}
    >
      {type}
    </span>
  );
}

function Spinner({ size = "sm" }: { size?: "sm" | "md" }) {
  const dim = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  return (
    <svg
      className={`animate-spin ${dim} text-current`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

// ── Connection Card ────────────────────────────────────────────────────────────

function ConnectionCard({
  conn,
  onDiscover,
  onRemove,
  discovering,
}: {
  conn: Connection;
  onDiscover: (id: string) => void;
  onRemove: (id: string) => void;
  discovering: string | null;
}) {
  const isBuiltIn = conn.type === "built-in";
  const isDiscovering = discovering === conn.id;

  return (
    <div
      className={`bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 ${
        isBuiltIn ? "border-l-4 border-l-blue-500 dark:border-l-blue-400" : ""
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg" title={conn.healthStatus}>
            {STATUS_INDICATORS[conn.healthStatus] ?? "⚪"}
          </span>
          <h3 className="font-semibold text-gray-900 dark:text-white truncate">{conn.name}</h3>
          <TypeBadge type={conn.type} />
        </div>
        <span className={`text-xs font-medium whitespace-nowrap ${STATUS_COLORS[conn.healthStatus]}`}>
          {conn.healthStatus.replace("_", " ")}
        </span>
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mb-3">
        <div className="text-gray-500 dark:text-gray-400">Transport</div>
        <div className="text-gray-900 dark:text-white font-mono text-xs">
          {conn.transport === "stdio" ? "stdio" : "HTTP/SSE"}
        </div>

        <div className="text-gray-500 dark:text-gray-400">Tools</div>
        <div className="text-gray-900 dark:text-white">
          {conn.toolCount > 0 ? `${conn.toolCount} tools` : "Not discovered yet"}
        </div>

        <div className="text-gray-500 dark:text-gray-400">Auth</div>
        <div className="text-gray-900 dark:text-white">{conn.authType || "none"}</div>

        {conn.lastDiscoveredAt ? (
          <>
            <div className="text-gray-500 dark:text-gray-400">Last discovered</div>
            <div className="text-gray-900 dark:text-white text-xs">
              {new Date(conn.lastDiscoveredAt).toLocaleString()}
            </div>
          </>
        ) : null}
      </div>

      {/* Error */}
      {conn.lastError ? (
        <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 rounded-lg px-3 py-2 mb-3 break-words">
          {conn.lastError}
        </div>
      ) : null}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onDiscover(conn.id)}
          disabled={isDiscovering}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
        >
          {isDiscovering ? <Spinner /> : "🔍"} Discover Tools
        </button>
        {!isBuiltIn ? (
          <button
            onClick={() => onRemove(conn.id)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-900 transition-colors"
          >
            🗑 Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ── Add Connection Form ────────────────────────────────────────────────────────

type AuthType = "none" | "api-key" | "bearer" | "env";

function AddConnectionForm({
  onSaved,
}: {
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [formError, setFormError] = useState("");

  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "sse">("stdio");
  const [command, setCommand] = useState("node");
  const [args, setArgs] = useState("");
  const [envVars, setEnvVars] = useState("");
  const [url, setUrl] = useState("");
  const [authType, setAuthType] = useState<AuthType>("none");
  const [headerName, setHeaderName] = useState("X-API-Key");
  const [apiKey, setApiKey] = useState("");
  const [bearerToken, setBearerToken] = useState("");
  const [authEnvVars, setAuthEnvVars] = useState("");

  function reset() {
    setName("");
    setTransport("stdio");
    setCommand("node");
    setArgs("");
    setEnvVars("");
    setUrl("");
    setAuthType("none");
    setHeaderName("X-API-Key");
    setApiKey("");
    setBearerToken("");
    setAuthEnvVars("");
    setFormError("");
    setTestResult(null);
  }

  function buildPayload() {
    if (!name.trim()) throw new Error("Name is required");

    const config: Record<string, unknown> = {};
    if (transport === "stdio") {
      config.command = command || "node";
      config.args = args
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (envVars.trim()) {
        const env: Record<string, string> = {};
        for (const line of envVars.split("\n")) {
          const eq = line.indexOf("=");
          if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
        }
        config.env = env;
      }
    } else {
      if (!url.trim()) throw new Error("URL is required for HTTP/SSE transport");
      config.url = url.trim();
    }

    let authConfig: Record<string, string> | undefined;
    if (authType === "api-key") {
      authConfig = { headerName: headerName || "X-API-Key", key: apiKey };
    } else if (authType === "bearer") {
      authConfig = { token: bearerToken };
    } else if (authType === "env") {
      authConfig = {};
      for (const line of authEnvVars.split("\n")) {
        const eq = line.indexOf("=");
        if (eq > 0) authConfig[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      }
    }

    return { name: name.trim(), transport, config, authType, authConfig };
  }

  async function handleTest() {
    setFormError("");
    setTestResult(null);
    setTesting(true);
    try {
      const payload = buildPayload();
      // Save temporarily, discover, then report
      const saveRes = await api<{ connectionId: string }>({ action: "add", ...payload });
      const discoverRes = await api<DiscoverResponse>({
        action: "discover",
        connectionId: saveRes.connectionId,
      });
      if (discoverRes.error) {
        setTestResult(`⚠️ Connected with issues: ${discoverRes.error}`);
      } else {
        setTestResult(`✅ Success! Found ${discoverRes.toolCount} tools`);
      }
      onSaved();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setFormError("");
    setSaving(true);
    try {
      const payload = buildPayload();
      await api<{ saved: boolean }>({ action: "add", ...payload });
      reset();
      setOpen(false);
      onSaved();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full py-3 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-blue-400 hover:text-blue-600 dark:hover:border-blue-500 dark:hover:text-blue-400 transition-colors font-medium"
      >
        ➕ Add MCP Server
      </button>
    );
  }

  const inputCls =
    "w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";
  const labelCls = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1";
  const selectCls = inputCls;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900 dark:text-white">➕ Add MCP Server</h3>
        <button
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg"
        >
          ✕
        </button>
      </div>

      <div className="space-y-4">
        {/* Name */}
        <div>
          <label className={labelCls}>Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My MCP Server"
            className={inputCls}
          />
        </div>

        {/* Transport */}
        <div>
          <label className={labelCls}>Transport</label>
          <select
            value={transport}
            onChange={(e) => setTransport(e.target.value as "stdio" | "sse")}
            className={selectCls}
          >
            <option value="stdio">stdio</option>
            <option value="sse">HTTP/SSE</option>
          </select>
        </div>

        {/* Transport-specific fields */}
        {transport === "stdio" ? (
          <div className="space-y-3 pl-3 border-l-2 border-gray-200 dark:border-gray-700">
            <div>
              <label className={labelCls}>Command</label>
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="node"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Args (comma-separated)</label>
              <input
                type="text"
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="dist/server.js, --port, 3001"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Environment Variables (key=value, one per line)</label>
              <textarea
                value={envVars}
                onChange={(e) => setEnvVars(e.target.value)}
                placeholder={"API_KEY=abc123\nNODE_ENV=production"}
                rows={3}
                className={inputCls}
              />
            </div>
          </div>
        ) : (
          <div className="pl-3 border-l-2 border-gray-200 dark:border-gray-700">
            <label className={labelCls}>URL *</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://mcp-server.example.com/sse"
              className={inputCls}
            />
          </div>
        )}

        {/* Auth Type */}
        <div>
          <label className={labelCls}>Auth Type</label>
          <select
            value={authType}
            onChange={(e) => setAuthType(e.target.value as AuthType)}
            className={selectCls}
          >
            <option value="none">None</option>
            <option value="api-key">API Key</option>
            <option value="bearer">Bearer Token</option>
            <option value="env">Env Variables</option>
          </select>
        </div>

        {/* Auth-specific fields */}
        {authType === "api-key" ? (
          <div className="space-y-3 pl-3 border-l-2 border-gray-200 dark:border-gray-700">
            <div>
              <label className={labelCls}>Header Name</label>
              <input
                type="text"
                value={headerName}
                onChange={(e) => setHeaderName(e.target.value)}
                placeholder="X-API-Key"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter API key"
                className={inputCls}
              />
            </div>
          </div>
        ) : null}

        {authType === "bearer" ? (
          <div className="pl-3 border-l-2 border-gray-200 dark:border-gray-700">
            <label className={labelCls}>Bearer Token</label>
            <input
              type="password"
              value={bearerToken}
              onChange={(e) => setBearerToken(e.target.value)}
              placeholder="Enter bearer token"
              className={inputCls}
            />
          </div>
        ) : null}

        {authType === "env" ? (
          <div className="pl-3 border-l-2 border-gray-200 dark:border-gray-700">
            <label className={labelCls}>Environment Variables (key=value, one per line)</label>
            <textarea
              value={authEnvVars}
              onChange={(e) => setAuthEnvVars(e.target.value)}
              placeholder={"SECRET_KEY=my-secret\nAPI_TOKEN=xyz"}
              rows={3}
              className={inputCls}
            />
          </div>
        ) : null}

        {/* Error / Test result */}
        {formError ? (
          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 rounded-lg px-3 py-2">
            {formError}
          </div>
        ) : null}

        {testResult ? (
          <div className="text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
            {testResult}
          </div>
        ) : null}

        {/* Buttons */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleTest}
            disabled={testing || saving}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
          >
            {testing ? <Spinner /> : null} Test Connection
          </button>
          <button
            onClick={handleSave}
            disabled={saving || testing}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5 transition-colors"
          >
            {saving ? <Spinner /> : null} Save
          </button>
          <button
            onClick={() => {
              reset();
              setOpen(false);
            }}
            className="px-4 py-2 text-sm font-medium rounded-lg text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Quick Add Templates ────────────────────────────────────────────────────────

interface Template {
  id: string;
  name: string;
  description: string;
  type: string;
  authNote: string;
  docsUrl: string;
}

function QuickAddTemplates({ onAdded }: { onAdded: () => void }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/connections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "templates" }),
        });
        if (res.ok) {
          const data = await res.json();
          setTemplates(data.templates ?? []);
        }
      } catch { /* ignore */ }
      setLoaded(true);
    })();
  }, []);

  if (!loaded || templates.length === 0) return null;

  const handleAdd = async (tmpl: Template) => {
    setAdding(tmpl.id);
    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add-from-template", templateId: tmpl.id }),
      });
      if (res.ok) {
        // Auto-discover after adding
        await fetch("/api/connections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "discover", connectionId: tmpl.id }),
        });
        onAdded();
      }
    } catch { /* ignore */ }
    setAdding(null);
  };

  const typeIcons: Record<string, string> = {
    microsoft: "🔷",
    community: "🌐",
    custom: "🔧",
  };

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">⚡ Quick Add</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {templates.map((tmpl) => (
          <div key={tmpl.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 flex flex-col">
            <div className="flex items-center gap-2 mb-1">
              <span>{typeIcons[tmpl.type] ?? "📦"}</span>
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{tmpl.name}</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 flex-1">{tmpl.description}</p>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">{tmpl.authNote}</p>
            <div className="flex gap-2">
              <button
                onClick={() => handleAdd(tmpl)}
                disabled={adding !== null}
                className="flex-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-white transition-colors"
              >
                {adding === tmpl.id ? "Adding..." : "➕ Add & Connect"}
              </button>
              <a
                href={tmpl.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-gray-300 dark:border-gray-700 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Docs
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Discovered Tools Section ───────────────────────────────────────────────────

function ToolsSection() {
  const [tools, setTools] = useState<DiscoveredTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [serverCount, setServerCount] = useState(0);

  const loadTools = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<AllToolsResponse>({ action: "all-tools" });
      setTools(res.tools);
      const servers = new Set(res.tools.map((t) => t.server));
      setServerCount(servers.size);
    } catch {
      // silently fail — tools section is supplementary
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTools();
  }, [loadTools]);

  const filtered = search.trim()
    ? tools.filter(
        (t) =>
          t.name.toLowerCase().includes(search.toLowerCase()) ||
          t.qualifiedName.toLowerCase().includes(search.toLowerCase()) ||
          t.description.toLowerCase().includes(search.toLowerCase()) ||
          t.server.toLowerCase().includes(search.toLowerCase())
      )
    : tools;

  // Group by server
  const grouped: Record<string, DiscoveredTool[]> = {};
  for (const tool of filtered) {
    const key = tool.server || "unknown";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(tool);
  }
  const serverKeys = Object.keys(grouped).sort();

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">🛠️ Discovered Tools</h2>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          📊 Total: {tools.length} tools from {serverCount} servers
        </span>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tools by name, server, or description…"
          className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 gap-2 text-gray-500 dark:text-gray-400">
          <Spinner size="md" /> Loading tools…
        </div>
      ) : tools.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
          No tools discovered yet. Click &quot;Discover Tools&quot; on a connection above.
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-6">
          No tools match &quot;{search}&quot;
        </p>
      ) : (
        <div className="space-y-4 max-h-[500px] overflow-y-auto">
          {serverKeys.map((server) => (
            <div key={server}>
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                {server} ({grouped[server].length})
              </h3>
              <div className="space-y-1">
                {grouped[server].map((tool) => (
                  <div
                    key={tool.qualifiedName}
                    className="flex items-start gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <span className="text-xs font-mono text-blue-600 dark:text-blue-400 whitespace-nowrap pt-0.5">
                      {tool.qualifiedName}
                    </span>
                    <span className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
                      {tool.description}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page Content (uses useSearchParams) ───────────────────────────────────

function ConnectionsPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [discovering, setDiscovering] = useState<string | null>(null);
  const [toolsKey, setToolsKey] = useState(0);

  const loadConnections = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api<ListResponse>({ action: "list" });
      // Sort: built-in first, then alphabetical
      const sorted = res.connections.sort((a, b) => {
        if (a.type === "built-in" && b.type !== "built-in") return -1;
        if (b.type === "built-in" && a.type !== "built-in") return 1;
        return a.name.localeCompare(b.name);
      });
      setConnections(sorted);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  async function handleDiscover(connectionId: string) {
    setDiscovering(connectionId);
    try {
      await api<DiscoverResponse>({ action: "discover", connectionId });
      await loadConnections();
      setToolsKey((k) => k + 1);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDiscovering(null);
    }
  }

  async function handleRemove(connectionId: string) {
    try {
      await api<{ deleted: boolean }>({ action: "remove", connectionId });
      await loadConnections();
      setToolsKey((k) => k + 1);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function handleSaved() {
    loadConnections();
    setToolsKey((k) => k + 1);
  }

  // Preserve query params for dashboard link
  const dashboardHref = `/dashboard${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <button
            onClick={() => router.push(dashboardHref)}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-3 inline-block"
          >
            ← Dashboard
          </button>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">🔌 MCP Connections</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Connect to external MCP servers to expand your tool library
          </p>
        </div>

        {/* Error Banner */}
        {error ? (
          <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-start justify-between">
            <span>{error}</span>
            <button onClick={() => setError("")} className="ml-3 text-red-400 hover:text-red-600">
              ✕
            </button>
          </div>
        ) : null}

        {/* Connections List */}
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-gray-500 dark:text-gray-400">
            <Spinner size="md" /> Loading connections…
          </div>
        ) : (
          <div className="space-y-3">
            {connections.map((conn) => (
              <ConnectionCard
                key={conn.id}
                conn={conn}
                onDiscover={handleDiscover}
                onRemove={handleRemove}
                discovering={discovering}
              />
            ))}
          </div>
        )}

        {/* Add Connection */}
        <AddConnectionForm onSaved={handleSaved} />

        {/* Quick Add Templates */}
        <QuickAddTemplates onAdded={handleSaved} />

        {/* Discovered Tools */}
        <ToolsSection key={toolsKey} />
      </div>
    </div>
  );
}

// ── Page Export (Suspense wrapper for useSearchParams) ──────────────────────────

export default function ConnectionsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
            <Spinner size="md" /> Loading…
          </div>
        </div>
      }
    >
      <ConnectionsPageContent />
    </Suspense>
  );
}
