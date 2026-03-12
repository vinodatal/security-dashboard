"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Workflow {
  id: string;
  name: string;
  description: string;
  category: string;
  complexity?: "low" | "medium" | "high";
  steps?: Array<{ id: string }>;
  stepsCount?: number;
  source?: string;
  createdAt?: string;
  lastRunAt?: string;
}

interface SkillQuery {
  name: string;
  query: string;
}

interface SkillRemediation {
  finding: string;
  description: string;
  scripts: Array<{ type: string; label: string; command: string }>;
}

interface Skill {
  id: string;
  skillId?: string;
  name: string;
  description: string;
  category: string;
  source?: string;
  queries?: SkillQuery[];
  instructions?: string;
  remediation?: SkillRemediation[];
  createdAt?: string;
}

interface ParsedUpload {
  name: string;
  category: string;
  description: string;
  queries: SkillQuery[];
  remediation: SkillRemediation[];
  instructions: string;
  filename: string;
  rawContent: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const WORKFLOW_CATEGORY_ICONS: Record<string, string> = {
  "incident-response": "🚨",
  "identity-access": "🔐",
  "compliance-posture": "📋",
  "device-endpoint": "💻",
  "data-protection": "🛡️",
  reporting: "📊",
};

const SKILL_CATEGORY_ICONS: Record<string, string> = {
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

/* ------------------------------------------------------------------ */
/*  useApi hooks                                                       */
/* ------------------------------------------------------------------ */

function useWorkflowApi() {
  const router = useRouter();
  return useCallback(
    async (action: string, body: Record<string, unknown> = {}) => {
      const res = await fetch("/api/workflows", {
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

function useSkillApi() {
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
/*  Workflow Card                                                      */
/* ------------------------------------------------------------------ */

function WorkflowCard({
  workflow,
  onDelete,
  queryString,
}: {
  workflow: Workflow;
  onDelete: (id: string) => void;
  queryString: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const icon = WORKFLOW_CATEGORY_ICONS[workflow.category] ?? "🔧";
  const stepCount = workflow.stepsCount ?? workflow.steps?.length ?? 0;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-md transition-shadow flex flex-col">
      <div className="p-5 flex-1 flex flex-col">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xl flex-shrink-0">{icon}</span>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
              {workflow.name}
            </h3>
          </div>
          <span className="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
            CUSTOM
          </span>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mb-3">
          {workflow.description}
        </p>

        <div className="flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400 mt-auto">
          <span className="inline-flex items-center gap-1 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
            📋 {stepCount} step{stepCount !== 1 ? "s" : ""}
          </span>
          {workflow.createdAt ? (
            <span className="inline-flex items-center gap-1 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
              📅 {new Date(workflow.createdAt).toLocaleDateString()}
            </span>
          ) : null}
          {workflow.lastRunAt ? (
            <span className="inline-flex items-center gap-1 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full">
              ▶ Last run {new Date(workflow.lastRunAt).toLocaleDateString()}
            </span>
          ) : null}
        </div>
      </div>

      <div className="px-5 pb-4 pt-2 border-t border-gray-100 dark:border-gray-800 flex items-center gap-2">
        <a
          href={`/workflows${queryString ? `?${queryString}` : ""}`}
          className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors"
        >
          ▶ Run
        </a>
        <span className="flex-1" />
        {confirming ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-red-600 dark:text-red-400">Delete?</span>
            <button
              onClick={() => { onDelete(workflow.id); setConfirming(false); }}
              className="text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-800 px-2 py-1 rounded-md hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
            >
              Yes
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="text-xs font-medium text-gray-500 hover:text-gray-700 px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              No
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="text-sm text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
            title="Delete workflow"
          >
            🗑
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Skill Card                                                         */
/* ------------------------------------------------------------------ */

function SkillCard({
  skill,
  onDelete,
  queryString,
}: {
  skill: Skill;
  onDelete: (id: string) => void;
  queryString: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const icon = SKILL_CATEGORY_ICONS[skill.category] ?? "📦";
  const queryCount = skill.queries?.length ?? 0;
  const remediationCount = skill.remediation?.length ?? 0;
  const hasInstructions = Boolean(skill.instructions);
  const isUploaded = skill.source === "uploaded";

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-md transition-shadow flex flex-col">
      <div className="p-5 flex-1 flex flex-col">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xl flex-shrink-0">{icon}</span>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
              {skill.name}
            </h3>
          </div>
          <span
            className={`flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
              isUploaded
                ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
                : "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 border border-purple-200 dark:border-purple-800"
            }`}
          >
            {isUploaded ? "UPLOADED" : "NL-GENERATED"}
          </span>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mb-3">
          {skill.description}
        </p>

        <div className="flex flex-wrap gap-1.5 mt-auto">
          {queryCount > 0 ? (
            <span className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
              {queryCount} quer{queryCount === 1 ? "y" : "ies"}
            </span>
          ) : null}
          {hasInstructions ? (
            <span className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
              instructions
            </span>
          ) : null}
          {remediationCount > 0 ? (
            <span className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
              {remediationCount} remediation
            </span>
          ) : null}
          {skill.createdAt ? (
            <span className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
              📅 {new Date(skill.createdAt).toLocaleDateString()}
            </span>
          ) : null}
        </div>
      </div>

      <div className="px-5 pb-4 pt-2 border-t border-gray-100 dark:border-gray-800 flex items-center gap-2">
        <a
          href={`/skills${queryString ? `?${queryString}` : ""}`}
          className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors"
        >
          View
        </a>
        <span className="flex-1" />
        {confirming ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-red-600 dark:text-red-400">Delete?</span>
            <button
              onClick={() => { onDelete(skill.id); setConfirming(false); }}
              className="text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-800 px-2 py-1 rounded-md hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
            >
              Yes
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="text-xs font-medium text-gray-500 hover:text-gray-700 px-2 py-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              No
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="text-sm text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
            title="Delete skill"
          >
            🗑
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Upload Zone                                                        */
/* ------------------------------------------------------------------ */

function UploadZone({
  onParsed,
  uploadHistory,
  queryString,
  onDeleteSkill,
}: {
  onParsed: (parsed: ParsedUpload) => void;
  uploadHistory: Skill[];
  queryString: string;
  onDeleteSkill: (id: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const skillApi = useSkillApi();

  const processFile = useCallback(
    async (file: File) => {
      if (!file.name.endsWith(".md")) {
        setUploadError("Only .md (Markdown) files are supported");
        return;
      }
      setUploading(true);
      setUploadError("");

      try {
        const content = await file.text();
        const data = await skillApi("upload-md", { content, filename: file.name });
        onParsed({ ...data.skill, filename: file.name, rawContent: content });
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [skillApi, onParsed],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer?.files[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [processFile],
  );

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
          dragging
            ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950"
            : "border-gray-300 dark:border-gray-700 hover:border-indigo-400 dark:hover:border-indigo-600 hover:bg-gray-50 dark:hover:bg-gray-900"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".md"
          onChange={handleFileSelect}
          className="hidden"
        />
        <div className="space-y-2">
          <span className="text-3xl">{uploading ? "⏳" : "📄"}</span>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {uploading
              ? "Parsing file…"
              : dragging
                ? "Drop your .md file here"
                : "Drag & drop a .md file or click to browse"}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Markdown files with KQL queries, remediation scripts, and investigation instructions
          </p>
        </div>
      </div>

      {uploadError ? (
        <div className="rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {uploadError}
        </div>
      ) : null}

      {/* Upload history */}
      {uploadHistory.length > 0 ? (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            📥 Previously Uploaded
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {uploadHistory.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                onDelete={onDeleteSkill}
                queryString={queryString}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Upload Preview                                                     */
/* ------------------------------------------------------------------ */

function UploadPreview({
  parsed,
  onSave,
  onCancel,
  saving,
}: {
  parsed: ParsedUpload;
  onSave: (name: string) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [editName, setEditName] = useState(parsed.name);
  const queryCount = parsed.queries?.length ?? 0;
  const remediationCount = parsed.remediation?.length ?? 0;
  const hasInstructions = Boolean(parsed.instructions);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-indigo-200 dark:border-indigo-800 shadow-md p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          📄 Parsed Preview
        </h3>
        <span className="text-xs text-gray-500">{parsed.filename}</span>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Skill Name
        </label>
        <input
          type="text"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
          <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{parsed.category}</p>
          <p className="text-xs text-gray-500">Category</p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
          <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{queryCount}</p>
          <p className="text-xs text-gray-500">Queries</p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
          <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{remediationCount}</p>
          <p className="text-xs text-gray-500">Remediations</p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
          <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{hasInstructions ? "✓" : "—"}</p>
          <p className="text-xs text-gray-500">Instructions</p>
        </div>
      </div>

      {parsed.description ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">{parsed.description}</p>
      ) : null}

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={() => onSave(editName)}
          disabled={saving || !editName.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? "Saving…" : "💾 Save to Catalog"}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Stats Bar                                                          */
/* ------------------------------------------------------------------ */

function StatsBar({
  workflowCount,
  skillCount,
  uploadedCount,
}: {
  workflowCount: number;
  skillCount: number;
  uploadedCount: number;
}) {
  const total = workflowCount + skillCount + uploadedCount;

  return (
    <div className="flex flex-wrap items-center gap-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 px-5 py-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{total}</span>
        <span className="text-sm text-gray-500 dark:text-gray-400">total items</span>
      </div>
      <div className="hidden sm:block w-px h-6 bg-gray-200 dark:bg-gray-700" />
      <div className="flex flex-wrap gap-3 text-sm text-gray-600 dark:text-gray-400">
        <span>{workflowCount} workflow{workflowCount !== 1 ? "s" : ""}</span>
        <span>·</span>
        <span>{skillCount} skill{skillCount !== 1 ? "s" : ""}</span>
        <span>·</span>
        <span>{uploadedCount} uploaded</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section Header                                                     */
/* ------------------------------------------------------------------ */

function SectionHeader({
  icon,
  title,
  count,
}: {
  icon: string;
  title: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="text-xl">{icon}</span>
      <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{title}</h2>
      <span className="inline-flex items-center justify-center min-w-[24px] h-6 rounded-full bg-gray-200 dark:bg-gray-700 text-xs font-semibold text-gray-700 dark:text-gray-300 px-2">
        {count}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Content                                                       */
/* ------------------------------------------------------------------ */

function MyCatalogContent() {
  const searchParams = useSearchParams();
  const workflowApi = useWorkflowApi();
  const skillApi = useSkillApi();

  const queryString = searchParams.toString();

  // State
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [parsedUpload, setParsedUpload] = useState<ParsedUpload | null>(null);
  const [saving, setSaving] = useState(false);

  // Load all data
  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [wfData, skData] = await Promise.all([
        workflowApi("list-custom").catch(() => ({ workflows: [] })),
        skillApi("list").catch(() => ({ skills: [] })),
      ]);
      setWorkflows(wfData.workflows ?? []);
      const allSkills: Skill[] = skData.skills ?? [];
      setSkills(allSkills.filter((s: Skill) => s.source !== "built-in"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load catalog");
    } finally {
      setLoading(false);
    }
  }, [workflowApi, skillApi]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Derived data
  const customSkills = skills.filter((s) => s.source !== "uploaded");
  const uploadedSkills = skills.filter((s) => s.source === "uploaded");

  // Handlers
  const handleDeleteWorkflow = useCallback(
    async (id: string) => {
      try {
        await workflowApi("delete-custom", { workflowId: id });
        setWorkflows((prev) => prev.filter((w) => w.id !== id));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete workflow");
      }
    },
    [workflowApi],
  );

  const handleDeleteSkill = useCallback(
    async (id: string) => {
      try {
        await skillApi("delete", { skillId: id });
        setSkills((prev) => prev.filter((s) => s.id !== id));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete skill");
      }
    },
    [skillApi],
  );

  const handleSaveUpload = useCallback(
    async (name: string) => {
      if (!parsedUpload) return;
      setSaving(true);
      try {
        await skillApi("save", {
          skill: {
            name,
            category: parsedUpload.category,
            description: parsedUpload.description,
            queries: parsedUpload.queries,
            remediation: parsedUpload.remediation,
            instructions: parsedUpload.instructions,
            source: "uploaded",
          },
        });
        setParsedUpload(null);
        await loadData();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save skill");
      } finally {
        setSaving(false);
      }
    },
    [parsedUpload, skillApi, loadData],
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <a
                href={`/dashboard${queryString ? `?${queryString}` : ""}`}
                className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 mb-1 inline-block transition-colors"
              >
                ← Dashboard
              </a>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                📁 My Catalog
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Your custom workflows, skills, and uploaded content
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <a
                href={`/workflows${queryString ? `?${queryString}` : ""}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
              >
                🔧 New Workflow
              </a>
              <a
                href={`/skills${queryString ? `?${queryString}` : ""}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
              >
                🧠 New Skill
              </a>
              <button
                onClick={() => {
                  const uploadSection = document.getElementById("upload-section");
                  if (uploadSection) uploadSection.scrollIntoView({ behavior: "smooth" });
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950 transition-colors"
              >
                📄 Upload File
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-8">
        {/* Error banner */}
        {error ? (
          <div className="rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300 flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={() => setError("")}
              className="text-red-500 hover:text-red-700 ml-4"
            >
              ✕
            </button>
          </div>
        ) : null}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <div className="animate-spin text-4xl">🔄</div>
            <p className="text-gray-500 dark:text-gray-400">Loading your catalog…</p>
          </div>
        ) : (
          <>
            {/* Stats bar */}
            <StatsBar
              workflowCount={workflows.length}
              skillCount={customSkills.length}
              uploadedCount={uploadedSkills.length}
            />

            {/* Section 1: Custom Workflows */}
            <section>
              <SectionHeader icon="🔧" title="Custom Workflows" count={workflows.length} />
              {workflows.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                  {workflows.map((w) => (
                    <WorkflowCard
                      key={w.id}
                      workflow={w}
                      onDelete={handleDeleteWorkflow}
                      queryString={queryString}
                    />
                  ))}
                </div>
              ) : (
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
                  <span className="text-3xl mb-3 inline-block">🔧</span>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    No custom workflows yet — create one from natural language on the{" "}
                    <a
                      href={`/workflows${queryString ? `?${queryString}` : ""}`}
                      className="text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      Workflows page
                    </a>
                  </p>
                </div>
              )}
            </section>

            {/* Section 2: Custom Skills */}
            <section>
              <SectionHeader icon="🧠" title="Custom Skills" count={customSkills.length} />
              {customSkills.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                  {customSkills.map((s) => (
                    <SkillCard
                      key={s.id}
                      skill={s}
                      onDelete={handleDeleteSkill}
                      queryString={queryString}
                    />
                  ))}
                </div>
              ) : (
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
                  <span className="text-3xl mb-3 inline-block">🧠</span>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    No custom skills yet — create from natural language or upload a .md file
                  </p>
                </div>
              )}
            </section>

            {/* Section 3: Upload File */}
            <section id="upload-section">
              <SectionHeader icon="📄" title="Upload File" count={uploadedSkills.length} />

              {parsedUpload ? (
                <UploadPreview
                  parsed={parsedUpload}
                  onSave={handleSaveUpload}
                  onCancel={() => setParsedUpload(null)}
                  saving={saving}
                />
              ) : (
                <UploadZone
                  onParsed={setParsedUpload}
                  uploadHistory={uploadedSkills}
                  queryString={queryString}
                  onDeleteSkill={handleDeleteSkill}
                />
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page Export — Suspense boundary for useSearchParams                 */
/* ------------------------------------------------------------------ */

export default function MyCatalogPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
          <div className="animate-spin text-4xl">🔄</div>
        </div>
      }
    >
      <MyCatalogContent />
    </Suspense>
  );
}
