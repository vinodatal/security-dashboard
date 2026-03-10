"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorkflowStep {
  id: string;
  name: string;
  tool: string;
  description?: string;
  params?: Record<string, unknown>;
  forEach?: string;
  maxIterations?: number;
  humanGate?: boolean;
  onEmpty?: string;
}

interface Workflow {
  id: string;
  name: string;
  description: string;
  category: string;
  complexity: "low" | "medium" | "high";
  estimatedDuration: string;
  tags: string[];
  requiredLicenses: string[];
  requiredTools: string[];
  steps: WorkflowStep[];
  triggerConditions?: string[];
  stepsCount?: number;
  source?: string; // "built-in" | "nl-generated" | "user"
}

interface ExecutionStep {
  id: string;
  name: string;
  tool: string;
  resolvedParams: Record<string, unknown>;
  status: string;
  result?: unknown;
  error?: string;
  duration?: number;
  forEach?: string;
  maxIterations?: number;
  humanGate?: boolean;
  onEmpty?: string;
}

interface ExecutionPlan {
  executionId: string;
  workflowId: string;
  workflowName: string;
  steps: ExecutionStep[];
  skippedSteps: Array<{ stepId: string; stepName: string; reason: string }>;
  estimatedDuration: string;
  instructions: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORY_ICONS: Record<string, string> = {
  "incident-response": "🚨",
  "identity-access": "🔐",
  "compliance-posture": "📋",
  "device-endpoint": "💻",
  "data-protection": "🛡️",
  reporting: "📊",
};

const CATEGORY_LABELS: Record<string, string> = {
  "incident-response": "Incident Response",
  "identity-access": "Identity & Access",
  "compliance-posture": "Compliance & Posture",
  "device-endpoint": "Device & Endpoint",
  "data-protection": "Data Protection",
  reporting: "Reporting",
};

const CATEGORY_FILTERS = [
  { key: "all", label: "All", icon: "" },
  { key: "incident-response", label: "Incident Response", icon: "🚨" },
  { key: "identity-access", label: "Identity & Access", icon: "🔐" },
  { key: "compliance-posture", label: "Compliance", icon: "📋" },
  { key: "device-endpoint", label: "Device & Endpoint", icon: "💻" },
  { key: "data-protection", label: "Data Protection", icon: "🛡️" },
  { key: "reporting", label: "Reporting", icon: "📊" },
];

const COMPLEXITY_STYLES: Record<string, string> = {
  low: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  high: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

const EXAMPLE_PROMPTS = [
  "Check all admin accounts for MFA gaps and stale sessions",
  "Investigate a specific user's activity across all sources",
  "Find all publicly exposed Azure resources",
  "Audit DLP policy coverage for HIPAA compliance",
];

// ---------------------------------------------------------------------------
// Helper: API caller
// ---------------------------------------------------------------------------

function useApi() {
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ComplexityBadge({ complexity }: { complexity: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${COMPLEXITY_STYLES[complexity] ?? COMPLEXITY_STYLES.low}`}
    >
      {complexity.charAt(0).toUpperCase() + complexity.slice(1)}
    </span>
  );
}

function StepStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "success":
      return <span className="text-green-500">✅</span>;
    case "error":
      return <span className="text-red-500">❌</span>;
    case "running":
      return <span className="animate-spin inline-block">🔄</span>;
    default:
      return <span className="text-gray-400">⬜</span>;
  }
}

// ---------------------------------------------------------------------------
// Workflow Card
// ---------------------------------------------------------------------------

function WorkflowCard({
  workflow,
  onRun,
  onDelete,
}: {
  workflow: Workflow;
  onRun: (w: Workflow) => void;
  onDelete?: (w: Workflow) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const icon = CATEGORY_ICONS[workflow.category] ?? "🔧";
  const label = CATEGORY_LABELS[workflow.category] ?? workflow.category;
  const stepCount = workflow.stepsCount ?? workflow.steps?.length ?? 0;
  const isCustom = workflow.source && workflow.source !== "built-in";

  return (
    <div className="flex flex-col bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-md transition-shadow">
      {/* Card header */}
      <div className="p-5 flex-1">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <span className="text-2xl" role="img" aria-label={label}>
              {icon}
            </span>
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 leading-snug">
              {workflow.name}
            </h3>
            {isCustom ? (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                CUSTOM
              </span>
            ) : null}
          </div>
          <ComplexityBadge complexity={workflow.complexity} />
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-3 mb-3">
          {workflow.description}
        </p>

        {/* Tags */}
        {workflow.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {workflow.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:text-gray-400"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-gray-500">
          <span title="Estimated duration">⏱ {workflow.estimatedDuration}</span>
          <span title="Number of steps">📋 {stepCount} steps</span>
        </div>

        {/* Required licenses */}
        {workflow.requiredLicenses.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {workflow.requiredLicenses.map((lic) => (
              <span
                key={lic}
                className="rounded bg-indigo-50 dark:bg-indigo-950 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600 dark:text-indigo-400"
              >
                {lic}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Card actions */}
      <div className="border-t border-gray-100 dark:border-gray-800 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onRun(workflow)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-sm font-medium text-white transition-colors"
          >
            ▶ Run Workflow
          </button>
          {isCustom && onDelete ? (
            <button
              onClick={() => onDelete(workflow)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 px-3 py-2 text-sm font-medium text-red-700 dark:text-red-400 transition-colors"
            >
              🗑 Delete
            </button>
          ) : null}
        </div>
        <button
          onClick={() => setDetailsOpen((prev) => !prev)}
          className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        >
          {detailsOpen ? "▲ Hide" : "ℹ Details"}
        </button>
      </div>

      {/* Expandable details */}
      {detailsOpen ? (
        <div className="border-t border-gray-100 dark:border-gray-800 px-5 py-4 text-sm space-y-3 bg-gray-50 dark:bg-gray-950 rounded-b-xl">
          {/* Steps list */}
          {workflow.steps.length > 0 ? (
            <div>
              <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Steps ({workflow.steps.length})
              </h4>
              <div className="space-y-2">
                {workflow.steps.map((step, idx) => (
                  <div
                    key={step.id}
                    className="flex items-start gap-3 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-3"
                  >
                    <span className="text-xs font-mono text-gray-400 mt-0.5 w-5 shrink-0">{idx + 1}.</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{step.name}</span>
                        <code className="text-xs bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 rounded px-1.5 py-0.5 text-indigo-600 dark:text-indigo-400">
                          {step.tool}
                        </code>
                        {step.forEach ? (
                          <span className="text-xs text-purple-500 dark:text-purple-400">⟳ forEach (max {step.maxIterations ?? "∞"})</span>
                        ) : null}
                        {step.humanGate ? (
                          <span className="text-xs text-yellow-500 dark:text-yellow-400">⚠ approval required</span>
                        ) : null}
                        {step.onEmpty ? (
                          <span className="text-xs text-gray-400">empty → {step.onEmpty}</span>
                        ) : null}
                      </div>
                      {step.params && Object.keys(step.params).length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {Object.entries(step.params).map(([k, v]) => (
                            <span key={k} className="text-xs text-gray-500 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 rounded px-1.5 py-0.5">
                              {k}={typeof v === "string" ? v : JSON.stringify(v)}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Trigger conditions */}
          {workflow.triggerConditions && workflow.triggerConditions.length > 0 ? (
            <div>
              <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-1">
                Trigger Conditions
              </h4>
              <ul className="list-disc list-inside space-y-0.5 text-gray-600 dark:text-gray-400">
                {workflow.triggerConditions.map((cond, i) => (
                  <li key={i}>{cond}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Required tools */}
          {workflow.requiredTools.length > 0 ? (
            <div>
              <h4 className="font-semibold text-gray-700 dark:text-gray-300 mb-1">
                Required MCP Tools
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {workflow.requiredTools.map((tool) => (
                  <code
                    key={tool}
                    className="text-xs bg-gray-200 dark:bg-gray-800 rounded px-1.5 py-0.5 text-gray-700 dark:text-gray-300"
                  >
                    {tool}
                  </code>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Execution Panel (inline on the page when a workflow is running)
// ---------------------------------------------------------------------------

function ExecutionPanel({
  plan,
  onBack,
  api,
}: {
  plan: ExecutionPlan;
  onBack: () => void;
  api: (action: string, body?: Record<string, unknown>) => Promise<unknown>;
}) {
  const [steps, setSteps] = useState<ExecutionStep[]>(plan.steps ?? []);
  const [runningAll, setRunningAll] = useState(false);
  const abortRef = useRef(false);

  const completedCount = steps.filter((s) => s.status === "success").length;
  const failedCount = steps.filter((s) => s.status === "error" || s.status === "failed").length;
  const totalSteps = steps.length;
  const allDone = totalSteps > 0 && completedCount + failedCount === totalSteps;

  const executeStep = useCallback(
    async (stepIndex: number) => {
      const step = steps[stepIndex];
      if (!step || step.status === "success" || step.status === "running") return;

      setSteps((prev) =>
        prev.map((s, i) => (i === stepIndex ? { ...s, status: "running" } : s)),
      );

      const start = Date.now();
      try {
        const result = await api("execute-step", {
          toolName: step.tool,
          params: step.resolvedParams,
        });
        setSteps((prev) =>
          prev.map((s, i) =>
            i === stepIndex
              ? { ...s, status: "success", result, duration: Date.now() - start }
              : s,
          ),
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setSteps((prev) =>
          prev.map((s, i) =>
            i === stepIndex
              ? { ...s, status: "error", error: message, duration: Date.now() - start }
              : s,
          ),
        );
      }
    },
    [steps, api],
  );

  const executeAll = useCallback(async () => {
    setRunningAll(true);
    abortRef.current = false;
    for (let i = 0; i < steps.length; i++) {
      if (abortRef.current) break;
      if (steps[i].status === "success") continue;
      if (steps[i].humanGate) continue;
      await executeStep(i);
    }
    setRunningAll(false);
  }, [steps, executeStep]);

  const progressPct = totalSteps > 0 ? (completedCount / totalSteps) * 100 : 0;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            {plan.workflowName}
          </h2>
          <button
            onClick={onBack}
            className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          >
            ← Back to catalog
          </button>
        </div>

        {/* Progress bar */}
        <div className="w-full h-2 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden mb-2">
          <div
            className="h-full bg-indigo-600 transition-all duration-300 rounded-full"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>
            {completedCount}/{totalSteps} steps completed
            {failedCount > 0 ? ` · ${failedCount} failed` : ""}
          </span>
          <span>{plan.estimatedDuration}</span>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 mt-3">
          {!allDone ? (
            <button
              onClick={executeAll}
              disabled={runningAll}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-2 text-sm font-medium text-white transition-colors"
            >
              {runningAll ? (
                <>
                  <span className="animate-spin inline-block">🔄</span> Running…
                </>
              ) : (
                "▶ Run All Steps"
              )}
            </button>
          ) : null}
          {completedCount > 0 ? (
            <button
              onClick={() => {
                const report = steps
                  .filter((s) => s.status === "success")
                  .map(
                    (s) =>
                      `## ${s.name}\nTool: ${s.tool}\n\`\`\`json\n${JSON.stringify(s.result, null, 2).slice(0, 500)}\n\`\`\``,
                  )
                  .join("\n\n");
                navigator.clipboard.writeText(
                  `# ${plan.workflowName} Report\n\n${report}`,
                );
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              📋 Copy Report
            </button>
          ) : null}
        </div>
      </div>

      {/* Steps */}
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {steps.map((step, idx) => (
          <StepRow
            key={step.id}
            step={step}
            index={idx}
            onRun={() => executeStep(idx)}
            isRunningAll={runningAll}
          />
        ))}
      </div>

      {/* Skipped steps */}
      {plan.skippedSteps.length > 0 ? (
        <div className="p-5 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950">
          <h4 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">
            Skipped Steps
          </h4>
          <ul className="space-y-1 text-xs text-gray-500 dark:text-gray-500">
            {plan.skippedSteps.map((s) => (
              <li key={s.stepId}>
                <span className="font-medium">{s.stepName}</span> — {s.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function StepRow({
  step,
  index,
  onRun,
  isRunningAll,
}: {
  step: ExecutionStep;
  index: number;
  onRun: () => void;
  isRunningAll: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = step.status === "running";
  const isDone = step.status === "success" || step.status === "error";

  return (
    <div className="px-5 py-3">
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-400 w-5 text-right">{index + 1}</span>
        <StepStatusIcon status={step.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {step.name}
            </span>
            <code className="hidden sm:inline text-[11px] bg-gray-100 dark:bg-gray-800 rounded px-1.5 py-0.5 text-indigo-600 dark:text-indigo-400 flex-shrink-0">
              {step.tool}
            </code>
          </div>
          {step.forEach ? (
            <span className="text-[11px] text-gray-400">
              ↻ forEach: {step.forEach}
            </span>
          ) : null}
          {step.humanGate ? (
            <span className="text-[11px] text-amber-500">⚠ Manual approval required</span>
          ) : null}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {step.duration ? (
            <span className="text-[11px] text-gray-400">
              {(step.duration / 1000).toFixed(1)}s
            </span>
          ) : null}
          {!isDone && !isRunning ? (
            <button
              onClick={onRun}
              disabled={isRunningAll}
              className="rounded-md bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 px-2.5 py-1 text-xs font-medium hover:bg-indigo-100 dark:hover:bg-indigo-900 disabled:opacity-40 transition-colors"
            >
              Run
            </button>
          ) : null}
          {isDone ? (
            <button
              onClick={() => setExpanded((p) => !p)}
              className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              {expanded ? "▲" : "▼"}
            </button>
          ) : null}
        </div>
      </div>

      {expanded && isDone ? (
        <div className="mt-2 ml-10 text-xs">
          {step.status === "error" ? (
            <div className="rounded-md bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-2 text-red-700 dark:text-red-300">
              {step.error}
            </div>
          ) : (
            <pre className="rounded-md bg-gray-100 dark:bg-gray-800 p-2 overflow-x-auto max-h-48 text-gray-700 dark:text-gray-300">
              {JSON.stringify(step.result, null, 2)?.slice(0, 2000)}
            </pre>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NL Workflow Creator Modal
// ---------------------------------------------------------------------------

function NLCreatorModal({
  onClose,
  api,
  onRunGenerated,
  onSaved,
}: {
  onClose: () => void;
  api: (action: string, body?: Record<string, unknown>) => Promise<unknown>;
  onRunGenerated: (workflow: Workflow) => void;
  onSaved: () => void;
}) {
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [generatedWorkflow, setGeneratedWorkflow] = useState<Workflow | null>(null);
  const [customName, setCustomName] = useState("");
  const [customCategory, setCustomCategory] = useState("reporting");
  const [saved, setSaved] = useState(false);

  const handleGenerate = async () => {
    if (!description.trim()) return;
    setLoading(true);
    setError("");
    setGeneratedWorkflow(null);

    try {
      const result = (await api("create-from-nl", { description: description.trim() })) as Record<string, unknown>;
      const wf = (result.workflow ?? result) as Workflow;
      // Ensure steps array exists
      if (!wf.steps) wf.steps = [];
      if (!wf.tags) wf.tags = [];
      if (!wf.requiredLicenses) wf.requiredLicenses = [];
      if (!wf.requiredTools) wf.requiredTools = wf.steps.map((s: WorkflowStep) => s.tool);
      setGeneratedWorkflow(wf);
      setCustomName(wf.name || "");
      setCustomCategory(wf.category || "reporting");
      setSaved(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-2xl">
        {/* Modal header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            ✨ Create Custom Workflow
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl transition-colors"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Description input */}
          <div>
            <label
              htmlFor="nl-description"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Describe what you want to investigate or automate…
            </label>
            <textarea
              id="nl-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition"
              placeholder="e.g., Check all admin accounts for MFA gaps and stale sessions"
              disabled={loading}
            />
          </div>

          {/* Example prompts */}
          {!generatedWorkflow ? (
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                Try an example:
              </p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => setDescription(prompt)}
                    disabled={loading}
                    className="rounded-full bg-gray-100 dark:bg-gray-800 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-indigo-50 dark:hover:bg-indigo-950 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* Generate button */}
          {!generatedWorkflow ? (
            <button
              onClick={handleGenerate}
              disabled={loading || !description.trim()}
              className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-4 py-3 text-sm font-semibold text-white transition-colors"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <span className="animate-spin inline-block">🔄</span>
                  Generating workflow…
                </span>
              ) : (
                "Generate Workflow"
              )}
            </button>
          ) : null}

          {/* Error */}
          {error ? (
            <div className="rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          ) : null}

          {/* Generated workflow preview */}
          {generatedWorkflow ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/50 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">
                    {CATEGORY_ICONS[generatedWorkflow.category] ?? "🔧"}
                  </span>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                    {generatedWorkflow.name}
                  </h3>
                  <ComplexityBadge complexity={generatedWorkflow.complexity} />
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  {generatedWorkflow.description}
                </p>

                {/* Steps preview */}
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Steps ({(generatedWorkflow.steps ?? []).length})
                </h4>
                <ol className="list-decimal list-inside space-y-1 text-sm text-gray-600 dark:text-gray-400">
                  {(generatedWorkflow.steps ?? []).map((step: WorkflowStep, idx: number) => (
                    <li key={step.id ?? idx}>
                      {step.name}{" "}
                      <code className="text-[11px] bg-white/50 dark:bg-gray-800 rounded px-1 text-indigo-600 dark:text-indigo-400">
                        {step.tool}
                      </code>
                    </li>
                  ))}
                </ol>

                {/* Meta */}
                <div className="flex gap-4 mt-3 text-xs text-gray-500 dark:text-gray-400">
                  <span>⏱ {generatedWorkflow.estimatedDuration}</span>
                  <span>
                    📋 {generatedWorkflow.stepsCount ?? (generatedWorkflow.steps ?? []).length}{" "}
                    steps
                  </span>
                </div>
              </div>

              {/* Editable fields */}
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Workflow Name</label>
                  <input
                    type="text"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-indigo-500"
                    placeholder="Give your workflow a name"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Category</label>
                  <select
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-indigo-500"
                  >
                    <option value="incident-response">🚨 Incident Response</option>
                    <option value="identity-access">🔐 Identity & Access</option>
                    <option value="compliance-posture">📋 Compliance & Posture</option>
                    <option value="device-endpoint">💻 Device & Endpoint</option>
                    <option value="data-protection">🛡️ Data Protection</option>
                    <option value="reporting">📊 Reporting</option>
                  </select>
                </div>
              </div>

              {saved ? (
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 p-3 text-sm text-emerald-700 dark:text-emerald-300">
                  ✅ Saved to catalog! You can find it alongside built-in workflows.
                </div>
              ) : null}

              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    setSaving(true);
                    try {
                      const wfToSave = {
                        ...generatedWorkflow,
                        name: customName || generatedWorkflow.name,
                        category: customCategory,
                        id: generatedWorkflow.id || `custom-${Date.now()}`,
                        source: "nl-generated",
                      };
                      await api("save", { workflow: wfToSave });
                      setSaved(true);
                      onSaved();
                    } catch (err: unknown) {
                      setError(err instanceof Error ? err.message : String(err));
                    } finally {
                      setSaving(false);
                    }
                  }}
                  disabled={saving || saved || !customName.trim()}
                  className="flex-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 px-4 py-3 text-sm font-semibold text-white transition-colors"
                >
                  {saving ? "Saving…" : saved ? "✓ Saved" : "💾 Save to Catalog"}
                </button>
                <button
                  onClick={() => {
                    const wfToRun = {
                      ...generatedWorkflow,
                      name: customName || generatedWorkflow.name,
                      category: customCategory,
                    };
                    onRunGenerated(wfToRun);
                    onClose();
                  }}
                  className="flex-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-4 py-3 text-sm font-semibold text-white transition-colors"
                >
                  ▶ Run Now
                </button>
                <button
                  onClick={() => {
                    setGeneratedWorkflow(null);
                    setDescription("");
                    setCustomName("");
                    setSaved(false);
                  }}
                  className="rounded-lg border border-gray-300 dark:border-gray-700 px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Start Over
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

function WorkflowsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const api = useApi();

  const tenantId = searchParams.get("tenantId") ?? "";
  const subscriptionId = searchParams.get("subscriptionId") ?? "";

  // Build dashboard URL preserving query params
  const dashboardHref = (() => {
    const parts: string[] = [];
    if (tenantId) parts.push(`tenantId=${encodeURIComponent(tenantId)}`);
    if (subscriptionId)
      parts.push(`subscriptionId=${encodeURIComponent(subscriptionId)}`);
    return parts.length > 0 ? `/dashboard?${parts.join("&")}` : "/dashboard";
  })();

  // --- Catalog state ---
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");

  // Reload catalog (called on mount and after save/delete)
  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError("");
    try {
      const [catalogData, customData] = await Promise.all([
        api("catalog") as Promise<{ byCategory?: Record<string, Workflow[]> }>,
        api("list-custom") as Promise<{ workflows?: Array<Record<string, unknown>> }>,
      ]);

      const flat: Workflow[] = [];
      if (catalogData?.byCategory) {
        for (const cat of Object.keys(catalogData.byCategory)) {
          for (const w of catalogData.byCategory[cat]) {
            flat.push({
              ...w,
              category: w.category ?? cat,
              tags: w.tags ?? [],
              requiredLicenses: w.requiredLicenses ?? [],
              requiredTools: w.requiredTools ?? [],
              steps: w.steps ?? [],
              source: "built-in",
            });
          }
        }
      }

      if (customData?.workflows) {
        for (const cw of customData.workflows) {
          const def = (cw.definition ?? {}) as Record<string, unknown>;
          flat.push({
            id: (cw.workflowId as string) ?? (def.id as string) ?? `custom-${cw.id}`,
            name: (cw.name as string) ?? (def.name as string) ?? "Custom Workflow",
            description: (cw.description as string) ?? (def.description as string) ?? "",
            category: (cw.category as string) ?? "reporting",
            complexity: ((cw.complexity as string) ?? "medium") as Workflow["complexity"],
            estimatedDuration: (cw.estimatedDuration as string) ?? "5-15 min",
            tags: [...((cw.tags as string[]) ?? []), "custom"],
            requiredLicenses: (def.requiredLicenses as string[]) ?? [],
            requiredTools: (def.requiredTools as string[]) ?? [],
            steps: (def.steps as WorkflowStep[]) ?? [],
            source: (cw.source as string) ?? "user",
          });
        }
      }

      setWorkflows(flat);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCatalogError(msg);
    } finally {
      setCatalogLoading(false);
    }
  }, [api]);

  // --- Filters ---
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [complexityFilter, setComplexityFilter] = useState("all");
  const [search, setSearch] = useState("");

  // --- Modals & execution ---
  const [showCreator, setShowCreator] = useState(false);
  const [activePlan, setActivePlan] = useState<ExecutionPlan | null>(null);
  const [generatingPlan, setGeneratingPlan] = useState<string | null>(null);
  const [planError, setPlanError] = useState("");

  // ---------------------------------------------------------------------------
  // Load catalog on mount
  // ---------------------------------------------------------------------------
  // Load catalog on mount
  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  // ---------------------------------------------------------------------------
  // Run workflow
  // ---------------------------------------------------------------------------
  const handleRun = useCallback(
    async (workflow: Workflow) => {
      setGeneratingPlan(workflow.id);
      setPlanError("");
      setActivePlan(null);

      try {
        const isCustom = workflow.source && workflow.source !== "built-in";

        // For custom workflows, pass the full definition to MCP so it gets
        // environment-aware treatment (tenantId injection, condition eval)
        const genArgs: Record<string, unknown> = isCustom
          ? { definition: JSON.stringify(workflow) }
          : { workflowId: workflow.id };

        const raw = (await api("generate", genArgs)) as Record<string, unknown>;
        const plan: ExecutionPlan = {
          executionId: (raw.executionId as string) ?? "",
          workflowId: (raw.workflowId as string) ?? workflow.id,
          workflowName: (raw.workflowName as string) ?? workflow.name,
          steps: ((raw.steps as ExecutionStep[]) ?? []).map((s) => ({
            ...s,
            status: s.status ?? "pending",
          })),
          skippedSteps: (raw.skippedSteps as ExecutionPlan["skippedSteps"]) ?? [],
          estimatedDuration: (raw.estimatedDuration as string) ?? "",
          instructions: (raw.instructions as string) ?? "",
        };
        setActivePlan(plan);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setPlanError(msg);
      } finally {
        setGeneratingPlan(null);
      }
    },
    [api],
  );

  const handleRunGenerated = useCallback(
    (workflow: Workflow) => {
      handleRun(workflow);
    },
    [handleRun],
  );

  const handleDelete = useCallback(
    async (workflow: Workflow) => {
      if (!confirm(`Delete custom workflow "${workflow.name}"?`)) return;
      try {
        await api("delete-custom", { workflowId: workflow.id });
        await loadCatalog();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setCatalogError(msg);
      }
    },
    [api, loadCatalog],
  );

  // ---------------------------------------------------------------------------
  // Filter workflows
  // ---------------------------------------------------------------------------
  const filtered = workflows.filter((w) => {
    if (categoryFilter !== "all" && w.category !== categoryFilter) return false;
    if (complexityFilter !== "all" && w.complexity !== complexityFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const nameMatch = w.name.toLowerCase().includes(q);
      const descMatch = w.description.toLowerCase().includes(q);
      const tagMatch = w.tags.some((t) => t.toLowerCase().includes(q));
      if (!nameMatch && !descMatch && !tagMatch) return false;
    }
    return true;
  });

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // If an execution plan is active, show the execution panel full-width
  if (activePlan) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <ExecutionPanel
            plan={activePlan}
            onBack={() => setActivePlan(null)}
            api={api}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <a
                  href={dashboardHref}
                  className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
                >
                  ← Dashboard
                </a>
              </div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                🔧 Security Workflows
              </h1>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {catalogLoading
                  ? "Loading workflows…"
                  : `${workflows.length} automated workflows for security operations`}
              </p>
            </div>
            <button
              onClick={() => setShowCreator(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors self-start sm:self-auto"
            >
              ✨ Create Custom Workflow
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Filter bar */}
        <div className="space-y-4">
          {/* Category pills */}
          <div className="flex flex-wrap gap-2">
            {CATEGORY_FILTERS.map((cat) => {
              const isActive = categoryFilter === cat.key;
              return (
                <button
                  key={cat.key}
                  onClick={() => setCategoryFilter(cat.key)}
                  className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-700"
                  }`}
                >
                  {cat.icon ? `${cat.icon} ` : ""}
                  {cat.label}
                </button>
              );
            })}
          </div>

          {/* Second row: complexity + search */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Complexity */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500 dark:text-gray-400 mr-1">
                Complexity:
              </span>
              {["all", "low", "medium", "high"].map((level) => {
                const isActive = complexityFilter === level;
                return (
                  <button
                    key={level}
                    onClick={() => setComplexityFilter(level)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                      isActive
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-700"
                    }`}
                  >
                    {level.charAt(0).toUpperCase() + level.slice(1)}
                  </button>
                );
              })}
            </div>

            {/* Search */}
            <div className="flex-1 min-w-[200px]">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search workflows…"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3.5 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition"
              />
            </div>
          </div>
        </div>

        {/* Plan generation error */}
        {planError ? (
          <div className="rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-4 text-sm text-red-700 dark:text-red-300">
            <strong>Failed to generate execution plan:</strong> {planError}
          </div>
        ) : null}

        {/* Loading state */}
        {catalogLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 animate-pulse"
              >
                <div className="h-5 w-3/4 bg-gray-200 dark:bg-gray-800 rounded mb-3" />
                <div className="h-4 w-full bg-gray-200 dark:bg-gray-800 rounded mb-2" />
                <div className="h-4 w-2/3 bg-gray-200 dark:bg-gray-800 rounded mb-4" />
                <div className="flex gap-2">
                  <div className="h-6 w-16 bg-gray-200 dark:bg-gray-800 rounded-full" />
                  <div className="h-6 w-20 bg-gray-200 dark:bg-gray-800 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* Error state */}
        {!catalogLoading && catalogError ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">⚠️</p>
            <p className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
              Failed to load workflows
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {catalogError}
            </p>
            <button
              onClick={() => {
                setCatalogError("");
                setCatalogLoading(true);
                api("catalog")
                  .then((data) => {
                    const d = data as { byCategory?: Record<string, Workflow[]> };
                    const flat: Workflow[] = [];
                    if (d?.byCategory) {
                      for (const cat of Object.keys(d.byCategory)) {
                        for (const w of d.byCategory[cat]) {
                          flat.push({
                            ...w,
                            category: w.category ?? cat,
                            tags: w.tags ?? [],
                            requiredLicenses: w.requiredLicenses ?? [],
                            requiredTools: w.requiredTools ?? [],
                            steps: w.steps ?? [],
                          });
                        }
                      }
                    }
                    setWorkflows(flat);
                  })
                  .catch((e: unknown) =>
                    setCatalogError(e instanceof Error ? e.message : String(e)),
                  )
                  .finally(() => setCatalogLoading(false));
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-sm font-medium text-white transition-colors"
            >
              🔄 Retry
            </button>
          </div>
        ) : null}

        {/* Empty state */}
        {!catalogLoading && !catalogError && filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">🔍</p>
            <p className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
              No workflows match your filters
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Try adjusting the category, complexity, or search text.
            </p>
          </div>
        ) : null}

        {/* Workflow cards grid */}
        {!catalogLoading && !catalogError && filtered.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {filtered.map((w) => (
              <div key={w.id} className="relative">
                <WorkflowCard workflow={w} onRun={handleRun} onDelete={handleDelete} />
                {/* Generating overlay */}
                {generatingPlan === w.id ? (
                  <div className="absolute inset-0 rounded-xl bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm flex items-center justify-center">
                    <div className="flex items-center gap-2 text-sm font-medium text-indigo-600 dark:text-indigo-400">
                      <span className="animate-spin inline-block text-lg">🔄</span>
                      Generating plan…
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </main>

      {/* NL Creator Modal */}
      {showCreator ? (
        <NLCreatorModal
          onClose={() => setShowCreator(false)}
          api={api}
          onRunGenerated={handleRunGenerated}
          onSaved={loadCatalog}
        />
      ) : null}
    </div>
  );
}

export default function WorkflowsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center"><p className="text-gray-400">Loading workflows...</p></div>}>
      <WorkflowsContent />
    </Suspense>
  );
}
