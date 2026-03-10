"use client";

/**
 * Smart renderer for MCP tool results — turns JSON into readable tables,
 * metric cards, and lists instead of raw JSON dumps.
 */

interface ResultRendererProps {
  toolName: string;
  data: unknown;
}

export function ResultRenderer({ toolName, data }: ResultRendererProps) {
  if (!data || typeof data !== "object") {
    return <p className="text-sm text-gray-500">No data returned</p>;
  }

  const d = data as Record<string, unknown>;

  // Error response
  if (d.error) {
    return (
      <div className="rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-300">
        ⚠ {String(d.error)}
      </div>
    );
  }

  // Try tool-specific renderers first, then generic
  return (
    <div className="space-y-3 text-sm">
      <MetricsBar data={d} />
      <DataSection data={d} toolName={toolName} />
    </div>
  );
}

/** Top-level metric badges */
function MetricsBar({ data }: { data: Record<string, unknown> }) {
  const metrics: Array<{ label: string; value: string | number; color: string }> = [];

  if (data.currentScore !== undefined) {
    metrics.push({ label: "Score", value: `${data.currentScore}/${data.maxScore ?? "?"}`, color: "blue" });
  }
  if (data.percentageScore !== undefined) {
    metrics.push({ label: "Percentage", value: `${data.percentageScore}%`, color: Number(data.percentageScore) > 70 ? "green" : "yellow" });
  }
  if (data.alertCount !== undefined) metrics.push({ label: "Alerts", value: Number(data.alertCount), color: Number(data.alertCount) > 0 ? "red" : "green" });
  if (data.count !== undefined) metrics.push({ label: "Total", value: Number(data.count), color: "blue" });
  if (data.userCount !== undefined) metrics.push({ label: "Users", value: Number(data.userCount), color: "blue" });
  if (data.deviceCount !== undefined) metrics.push({ label: "Devices", value: Number(data.deviceCount), color: "blue" });
  if (data.recommendationCount !== undefined) metrics.push({ label: "Recommendations", value: Number(data.recommendationCount), color: "blue" });
  if (data.totalRecords !== undefined) metrics.push({ label: "Resources", value: Number(data.totalRecords), color: "blue" });

  // Summary sub-object
  if (data.summary && typeof data.summary === "object") {
    const s = data.summary as Record<string, unknown>;
    if (s.total !== undefined) metrics.push({ label: "Total", value: Number(s.total), color: "blue" });
    if (s.needsAttention !== undefined && Number(s.needsAttention) > 0) {
      metrics.push({ label: "Needs Attention", value: Number(s.needsAttention), color: "red" });
    }
    if (s.totalFindings !== undefined) metrics.push({ label: "Findings", value: Number(s.totalFindings), color: Number(s.totalFindings) > 0 ? "yellow" : "green" });
    if (s.adminsWithoutMfa !== undefined && Number(s.adminsWithoutMfa) > 0) {
      metrics.push({ label: "No MFA", value: Number(s.adminsWithoutMfa), color: "red" });
    }
  }

  if (metrics.length === 0) return null;

  const colorMap: Record<string, string> = {
    red: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    yellow: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    green: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    blue: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  };

  return (
    <div className="flex flex-wrap gap-2">
      {metrics.map((m, i) => (
        <span key={i} className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${colorMap[m.color] ?? colorMap.blue}`}>
          {m.label}: {m.value}
        </span>
      ))}
    </div>
  );
}

/** Render the main data arrays/objects */
function DataSection({ data, toolName }: { data: Record<string, unknown>; toolName: string }) {
  // Find the main data array — try common field names
  const arrayFields = ["topActions", "recommendations", "findings", "alerts", "value",
    "signIns", "users", "devices", "results", "workflows", "packages",
    "checks", "labels", "sensitiveInfoTypes"];

  for (const field of arrayFields) {
    const arr = data[field];
    if (Array.isArray(arr) && arr.length > 0) {
      return <ArrayTable items={arr} label={field} />;
    }
  }

  // Check for nested objects with array values (e.g., checks: { open_management_ports: [...] })
  for (const [key, val] of Object.entries(data)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const subObj = val as Record<string, unknown>;
      // Is it a checks-style object with named results?
      const hasArrayChildren = Object.values(subObj).some(v => Array.isArray(v));
      if (hasArrayChildren) {
        return <ChecksRenderer checks={subObj} />;
      }
    }
  }

  // Fallback: render key-value pairs for flat objects
  const simpleKeys = Object.entries(data).filter(([k, v]) =>
    !k.startsWith("_") && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
  );

  if (simpleKeys.length > 0) {
    return (
      <div className="grid grid-cols-2 gap-1">
        {simpleKeys.map(([k, v]) => (
          <div key={k} className="flex justify-between bg-gray-50 dark:bg-gray-800/50 rounded px-2 py-1">
            <span className="text-xs text-gray-500">{formatLabel(k)}</span>
            <span className="text-xs font-medium text-gray-900 dark:text-gray-100">{String(v)}</span>
          </div>
        ))}
      </div>
    );
  }

  return null;
}

/** Render an array of objects as a table */
function ArrayTable({ items, label }: { items: Array<Record<string, unknown>>; label: string }) {
  if (items.length === 0) return null;

  // Pick columns: use keys from first item, prioritize important ones
  const priorityKeys = ["name", "displayName", "title", "description", "severity", "status",
    "riskLevel", "score", "currentScore", "maxScore", "category", "userPrincipalName",
    "deviceName", "complianceState", "implementationStatus", "count"];

  const allKeys = Object.keys(items[0]).filter(k => !k.startsWith("_") && !k.startsWith("@"));
  const columns = [
    ...priorityKeys.filter(k => allKeys.includes(k)),
    ...allKeys.filter(k => !priorityKeys.includes(k)),
  ].slice(0, 6); // max 6 columns

  const maxRows = 15;
  const shown = items.slice(0, maxRows);

  return (
    <div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-medium">
        {formatLabel(label)} ({items.length} {items.length === 1 ? "item" : "items"})
      </p>
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800">
              {columns.map(col => (
                <th key={col} className="px-2 py-1.5 text-left font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">
                  {formatLabel(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {shown.map((item, i) => (
              <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                {columns.map(col => (
                  <td key={col} className="px-2 py-1.5 text-gray-700 dark:text-gray-300 max-w-48 truncate">
                    <CellValue value={item[col]} field={col} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length > maxRows ? (
        <p className="text-[11px] text-gray-400 mt-1">+{items.length - maxRows} more items</p>
      ) : null}
    </div>
  );
}

/** Render check results (e.g., infra security checks) */
function ChecksRenderer({ checks }: { checks: Record<string, unknown> }) {
  return (
    <div className="space-y-2">
      {Object.entries(checks).map(([name, val]) => {
        const items = Array.isArray(val) ? val : [];
        const count = (val as Record<string, unknown>)?.count ?? items.length;
        return (
          <div key={name} className="flex items-center justify-between bg-gray-50 dark:bg-gray-800/50 rounded-lg px-3 py-2">
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{formatLabel(name)}</span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
              Number(count) > 0
                ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300"
                : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
            }`}>
              {Number(count) > 0 ? `${count} found` : "✓ Clean"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Smart cell value rendering */
function CellValue({ value, field }: { value: unknown; field: string }) {
  if (value === null || value === undefined) return <span className="text-gray-400">—</span>;

  // Severity badges
  if (field === "severity" || field === "riskLevel") {
    const s = String(value).toLowerCase();
    const colors: Record<string, string> = {
      critical: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
      high: "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400",
      medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
      low: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
      informational: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
      none: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
    };
    return (
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${colors[s] ?? colors.informational}`}>
        {String(value)}
      </span>
    );
  }

  // Status badges
  if (field === "status" || field === "complianceState" || field === "implementationStatus") {
    const s = String(value).toLowerCase();
    const isGood = ["compliant", "resolved", "completed", "implemented", "success"].some(g => s.includes(g));
    const isBad = ["noncompliant", "active", "failed", "notimplemented"].some(b => s.includes(b));
    return (
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
        isGood ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
        : isBad ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
        : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
      }`}>
        {String(value)}
      </span>
    );
  }

  // Score values
  if (field === "score" || field === "currentScore" || field === "maxScore") {
    return <span className="font-mono font-semibold">{String(value)}</span>;
  }

  // Arrays → count
  if (Array.isArray(value)) return <span>{value.length} items</span>;

  // Objects → summary
  if (typeof value === "object") return <span className="text-gray-400">{Object.keys(value as object).length} fields</span>;

  // Truncate long strings
  const str = String(value);
  if (str.length > 80) return <span title={str}>{str.substring(0, 77)}…</span>;

  return <span>{str}</span>;
}

/** Convert camelCase/snake_case to Title Case */
function formatLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^\w/, c => c.toUpperCase())
    .trim();
}
