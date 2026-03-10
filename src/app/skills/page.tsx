"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  Suspense,
} from "react";
import { useSearchParams, useRouter } from "next/navigation";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SkillQuery {
  id?: string;
  name: string;
  description?: string;
  query: string;
  target?: string;
  mitreTactics?: string[];
  mitreTechniques?: string[];
}

interface SkillRemediation {
  finding: string;
  severity?: string;
  description: string;
  scripts: Array<{ type: string; label: string; command: string }>;
  verification?: string;
  docUrl?: string;
}

interface SkillDetectionRule {
  name: string;
  description?: string;
  severity?: string;
  query: string;
  tactics?: string[];
}

interface Skill {
  id: string;
  skillId?: string;
  name: string;
  description: string;
  category: string;
  tags?: string[];
  source?: string;
  requiredTools?: string[];
  requiredLicenses?: string[];
  queries?: SkillQuery[];
  instructions?: string;
  remediation?: SkillRemediation[];
  detectionRules?: SkillDetectionRule[];
  applicableWorkflows?: string[];
  author?: string;
  version?: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CATEGORY_ICONS: Record<string, string> = {
  "threat-hunting": "🎯",
  "incident-response": "🚨",
  compliance: "📋",
  "identity-security": "🔐",
  "data-protection": "🛡️",
  infrastructure: "🏗️",
  detection: "🔔",
  remediation: "🔧",
  general: "📦",
};

const CATEGORIES = [
  { id: "all", label: "All" },
  { id: "threat-hunting", label: "Threat Hunting" },
  { id: "incident-response", label: "Incident Response" },
  { id: "identity-security", label: "Identity Security" },
  { id: "data-protection", label: "Data Protection" },
  { id: "compliance", label: "Compliance" },
  { id: "infrastructure", label: "Infrastructure" },
  { id: "detection", label: "Detection" },
  { id: "remediation", label: "Remediation" },
  { id: "general", label: "General" },
];

const SOURCE_FILTERS = [
  { id: "all", label: "All" },
  { id: "built-in", label: "Built-in" },
  { id: "custom", label: "Custom" },
];

const EXAMPLE_PROMPTS = [
  "Detect lateral movement via RDP",
  "Hunt for data exfiltration to USB devices",
  "Investigate OAuth app consent abuse",
  "HIPAA compliance checking queries",
];

/* ------------------------------------------------------------------ */
/*  useApi hook                                                        */
/* ------------------------------------------------------------------ */

function useApi() {
  const router = useRouter();
  return useCallback(
    async (action: string, body: Record<string, unknown> = {}) => {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      if (res.status === 401) {
        router.push("/");
        throw new Error("Not authenticated");
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? `Request failed (${res.status})`);
      }
      return res.json();
    },
    [router],
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function categoryIcon(category: string): string {
  return CATEGORY_ICONS[category] ?? "📦";
}

function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

/* ------------------------------------------------------------------ */
/*  CodeBlock — code display with Copy button                          */
/* ------------------------------------------------------------------ */

function CodeBlock({
  code,
  language,
  label,
}: {
  code: string;
  language: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    copyToClipboard(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="mt-2">
      {label ? (
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
          {label}
        </p>
      ) : null}
      <div className="relative group">
        <pre className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3 text-xs overflow-x-auto font-mono text-gray-800 dark:text-gray-200 border border-gray-200 dark:border-gray-700">
          <code>{code}</code>
        </pre>
        <button
          onClick={handleCopy}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 text-xs px-2 py-1 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600"
        >
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ContentIndicators                                                  */
/* ------------------------------------------------------------------ */

function ContentIndicators({ skill }: { skill: Skill }) {
  const indicators: string[] = [];

  const queryCount = skill.queries?.length ?? 0;
  if (queryCount > 0) indicators.push(`${queryCount} quer${queryCount === 1 ? "y" : "ies"}`);

  const scriptCount = (skill.remediation ?? []).length;
  if (scriptCount > 0) indicators.push(`${scriptCount} remediation`);

  if (skill.instructions) indicators.push("instructions");

  const ruleCount = skill.detectionRules?.length ?? 0;
  if (ruleCount > 0) indicators.push(`${ruleCount} rule${ruleCount === 1 ? "" : "s"}`);

  if (indicators.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {indicators.map((ind) => (
        <span
          key={ind}
          className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
        >
          {ind}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SkillDetails — expanded detail view                                */
/* ------------------------------------------------------------------ */

function SkillDetails({ skill }: { skill: Skill }) {
  return (
    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-4">
      {/* KQL / Queries */}
      {skill.queries && (skill.queries ?? []).length > 0 ? (
        <div>
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
            📊 Queries
          </h4>
          {(skill.queries ?? []).map((q, i) => (
            <CodeBlock
              key={i}
              code={q.query}
              language="kql"
              label={`${q.name}${q.description ? ` — ${q.description}` : ""}${q.mitreTactics?.length ? ` [${q.mitreTactics.join(", ")}]` : ""}`}
            />
          ))}
        </div>
      ) : null}

      {/* Investigation Instructions */}
      {skill.instructions ? (
        <div>
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
            📝 Investigation Instructions
          </h4>
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap border border-gray-200 dark:border-gray-700">
            {skill.instructions}
          </div>
        </div>
      ) : null}

      {/* Remediation Scripts */}
      {(skill.remediation ?? []).length > 0 ? (
        <div>
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
            🔧 Remediation Scripts
          </h4>
          {(skill.remediation ?? []).map((r, i) => (
            <div key={i} className="mb-3">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                {r.finding} ({r.severity ?? "medium"})
              </p>
              <p className="text-xs text-gray-500 mb-1">{r.description}</p>
              {(r.scripts ?? []).map((s, j) => (
                <CodeBlock
                  key={j}
                  code={s.command}
                  language={s.type === "azure-cli" ? "bash" : s.type}
                  label={s.label}
                />
              ))}
              {r.docUrl ? (
                <a href={r.docUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-500 hover:underline">
                  📖 {r.docUrl.split("/").pop()}
                </a>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* Detection Rules */}
      {(skill.detectionRules ?? []).length > 0 ? (
        <div>
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
            🔔 Detection Rules
          </h4>
          {(skill.detectionRules ?? []).map((r, i) => (
            <CodeBlock
              key={i}
              code={r.query}
              language="kql"
              label={`${r.name}${r.severity ? ` (${r.severity})` : ""}${r.tactics?.length ? ` [${r.tactics.join(", ")}]` : ""}`}
            />
          ))}
        </div>
      ) : null}

      {/* Applicable Workflows */}
      {skill.applicableWorkflows && (skill.applicableWorkflows ?? []).length > 0 ? (
        <div>
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
            ⚡ Applicable Workflows
          </h4>
          <ul className="list-disc list-inside text-sm text-gray-600 dark:text-gray-400 space-y-1">
            {(skill.applicableWorkflows ?? []).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SkillCard                                                          */
/* ------------------------------------------------------------------ */

function SkillCard({
  skill,
  onDelete,
}: {
  skill: Skill;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const isCustom = skill.source === "custom";
  const icon = categoryIcon(skill.category);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-md transition-shadow flex flex-col">
      <div className="p-5 flex-1 flex flex-col">
        {/* Header row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xl flex-shrink-0">{icon}</span>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
              {skill.name}
            </h3>
          </div>
          <span
            className={`flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
              isCustom
                ? "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"
                : "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
            }`}
          >
            {isCustom ? "Custom" : "Built-in"}
          </span>
        </div>

        {/* Description */}
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400 line-clamp-3">
          {skill.description}
        </p>

        {/* Tags */}
        {(skill.tags ?? []).length > 0 ? (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {(skill.tags ?? []).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        {/* Content indicators */}
        <ContentIndicators skill={skill} />

        {/* Required tools + licenses */}
        {(skill.requiredTools ?? []).length > 0 || (skill.requiredLicenses ?? []).length > 0 ? (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {(skill.requiredTools ?? []).map((t) => (
              <span
                key={`tool-${t}`}
                className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
              >
                🔧 {t}
              </span>
            ))}
            {(skill.requiredLicenses ?? []).map((l) => (
              <span
                key={`lic-${l}`}
                className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
              >
                🪪 {l}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Actions */}
      <div className="px-5 pb-4 flex items-center gap-2 mt-auto">
        <button
          onClick={() => setExpanded((prev) => !prev)}
          className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
        >
          {expanded ? "Hide Details" : "View Details"}
        </button>
        {isCustom ? (
          <button
            onClick={() => onDelete(skill.id)}
            className="ml-auto text-sm text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 transition-colors"
          >
            🗑 Delete
          </button>
        ) : null}
      </div>

      {/* Expanded details */}
      {expanded ? (
        <div className="px-5 pb-5">
          <SkillDetails skill={skill} />
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  NLCreatorModal                                                     */
/* ------------------------------------------------------------------ */

function NLCreatorModal({
  onClose,
  api,
  onSaved,
}: {
  onClose: () => void;
  api: (action: string, body?: Record<string, unknown>) => Promise<unknown>;
  onSaved: () => void;
}) {
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [generated, setGenerated] = useState<Skill | null>(null);
  const [skillName, setSkillName] = useState("");
  const [saving, setSaving] = useState(false);

  const handleGenerate = async () => {
    if (!description.trim()) return;
    setLoading(true);
    setError("");
    try {
      const result = (await api("create-from-nl", { description })) as {
        skill: Skill;
      };
      setGenerated(result.skill);
      setSkillName(result.skill.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!generated) return;
    setSaving(true);
    setError("");
    try {
      const toSave = { ...generated, name: skillName || generated.name };
      await api("save", { skill: toSave });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-2xl">
        {/* Modal header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            ✨ Create Skill from Description
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors text-xl leading-none"
          >
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Input phase */}
          {!generated ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Describe the security skill you want to create…
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g., Detect lateral movement via RDP sessions across the network"
                  rows={4}
                  className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>

              {/* Example chips */}
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  Try an example:
                </p>
                <div className="flex flex-wrap gap-2">
                  {EXAMPLE_PROMPTS.map((ex) => (
                    <button
                      key={ex}
                      onClick={() => setDescription(ex)}
                      className="text-xs px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-950 dark:hover:text-indigo-400 transition-colors"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>

              {error ? (
                <p className="text-sm text-red-600 dark:text-red-400">
                  {error}
                </p>
              ) : null}

              <button
                onClick={handleGenerate}
                disabled={loading || !description.trim()}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Generating…
                  </>
                ) : (
                  "Generate Skill"
                )}
              </button>
            </>
          ) : (
            /* Preview phase */
            <>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
                  Preview
                </h3>

                {/* Editable name */}
                <div className="mb-3">
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    Skill Name
                  </label>
                  <input
                    type="text"
                    value={skillName}
                    onChange={(e) => setSkillName(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                {/* Preview card (read-only) */}
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">
                      {categoryIcon(generated.category)}
                    </span>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300 capitalize">
                      {generated.category.replace("-", " ")}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {generated.description}
                  </p>

                  {(generated.tags ?? []).length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {(generated.tags ?? []).map((tag) => (
                        <span
                          key={tag}
                          className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <SkillDetails skill={generated} />
                </div>
              </div>

              {error ? (
                <p className="text-sm text-red-600 dark:text-red-400">
                  {error}
                </p>
              ) : null}

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setGenerated(null);
                    setError("");
                  }}
                  className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium py-2.5 px-4 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  ← Back
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {saving ? (
                    <>
                      <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Saving…
                    </>
                  ) : (
                    "Save to Catalog"
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SkillsContent — main page body (needs useSearchParams)             */
/* ------------------------------------------------------------------ */

function SkillsContent() {
  const searchParams = useSearchParams();
  const api = useApi();

  const tenantId = searchParams.get("tenantId") ?? "";
  const subscriptionId = searchParams.get("subscriptionId") ?? "";

  const dashboardHref = (() => {
    const parts: string[] = [];
    if (tenantId) parts.push(`tenantId=${encodeURIComponent(tenantId)}`);
    if (subscriptionId)
      parts.push(`subscriptionId=${encodeURIComponent(subscriptionId)}`);
    return parts.length > 0 ? `/dashboard?${parts.join("&")}` : "/dashboard";
  })();

  /* ---- state ---- */
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [search, setSearch] = useState("");

  const [showCreator, setShowCreator] = useState(false);

  /* ---- load catalog ---- */
  const loadSkills = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const data = (await api("list")) as { skills: Skill[] };
      setSkills(data.skills ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load skills");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  /* ---- delete handler ---- */
  const handleDelete = async (skillId: string) => {
    if (!confirm("Delete this custom skill?")) return;
    try {
      await api("delete", { skillId });
      setSkills((prev) => prev.filter((s) => s.id !== skillId));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  };

  /* ---- filtering ---- */
  const filtered = skills.filter((s) => {
    if (categoryFilter !== "all" && s.category !== categoryFilter) return false;
    if (sourceFilter !== "all" && s.source !== sourceFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const haystack = `${s.name} ${s.description} ${(s.tags ?? []).join(" ")}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  /* ---- render ---- */
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <a
                href={dashboardHref}
                className="text-sm text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
              >
                ← Dashboard
              </a>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              🧠 AI Skills
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Specialized knowledge packs for security analysis
            </p>
          </div>
          <button
            onClick={() => setShowCreator(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-4 py-2.5 rounded-lg transition-colors flex items-center gap-2 self-start sm:self-auto"
          >
            ✨ Create Skill
          </button>
        </div>
      </header>

      {/* Filter Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-5 space-y-3">
        {/* Category pills */}
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategoryFilter(cat.id)}
              className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                categoryFilter === cat.id
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
              }`}
            >
              {cat.id !== "all" ? `${categoryIcon(cat.id)} ` : ""}
              {cat.label}
            </button>
          ))}
        </div>

        {/* Search + Source filter row */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <span className="absolute inset-y-0 left-3 flex items-center text-gray-400 pointer-events-none">
              🔍
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search skills by name, description, or tags…"
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex gap-1">
            {SOURCE_FILTERS.map((sf) => (
              <button
                key={sf.id}
                onClick={() => setSourceFilter(sf.id)}
                className={`text-sm px-3 py-2 rounded-lg border transition-colors ${
                  sourceFilter === sf.id
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                {sf.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Loading state */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <div
                key={n}
                className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 animate-pulse"
              >
                <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-3" />
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-full mb-2" />
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-5/6 mb-4" />
                <div className="flex gap-2">
                  <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded-full w-14" />
                  <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded-full w-16" />
                </div>
              </div>
            ))}
          </div>
        ) : loadError ? (
          /* Error state */
          <div className="text-center py-16">
            <p className="text-red-600 dark:text-red-400 text-sm mb-3">
              {loadError}
            </p>
            <button
              onClick={loadSkills}
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          /* Empty state */
          <div className="text-center py-16">
            <p className="text-4xl mb-3">🧠</p>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              {skills.length === 0
                ? "No skills in the catalog yet."
                : "No skills match your filters."}
            </p>
            {skills.length === 0 ? (
              <button
                onClick={() => setShowCreator(true)}
                className="mt-3 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                Create your first skill →
              </button>
            ) : null}
          </div>
        ) : (
          /* Skills grid */
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </main>

      {/* NL Creator Modal */}
      {showCreator ? (
        <NLCreatorModal
          onClose={() => setShowCreator(false)}
          api={api}
          onSaved={loadSkills}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page — Suspense boundary for useSearchParams                       */
/* ------------------------------------------------------------------ */

export default function SkillsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
          <span className="inline-block w-6 h-6 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <SkillsContent />
    </Suspense>
  );
}
