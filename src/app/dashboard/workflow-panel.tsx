"use client";

import { useState, useCallback } from "react";

interface LicenseInfo {
  hasDefender: boolean;
  hasSentinel: boolean;
  hasIntune: boolean;
  hasPurview: boolean;
  hasEntraP2: boolean;
  hasDefenderForCloud: boolean;
}

interface OpenIssues {
  highSeverityAlerts: number;
  riskyUsers: number;
  nonCompliantDevices: number;
  dlpViolations: number;
  insiderRiskAlerts: number;
  secureScorePercent: number;
  secureScoreGap: number;
  staleAdmins: number;
  adminsWithoutMFA: number;
  policyConflicts: number;
  infraFindings: number;
}

interface EnvironmentContext {
  licenses: LicenseInfo;
  openIssues: OpenIssues;
  tenantId: string;
  assessedAt: string;
  _cached?: boolean;
}

interface SuggestedWorkflow {
  rank: number;
  workflowId: string;
  name: string;
  description: string;
  priority: number;
  reason: string;
  estimatedDuration: string;
  complexity: string;
  stepsCount: number;
  category: string;
  tags: string[];
}

interface ExecutionStep {
  id: string;
  name: string;
  tool: string;
  resolvedParams: Record<string, unknown>;
  status: string;
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

interface StepResult {
  stepId: string;
  status: "success" | "failed" | "skipped" | "running";
  data?: unknown;
  error?: string;
  durationMs?: number;
}

const COMPLEXITY_COLORS: Record<string, string> = {
  low: "text-green-400 bg-green-400/10 border-green-400/20",
  medium: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20",
  high: "text-red-400 bg-red-400/10 border-red-400/20",
};

const CATEGORY_ICONS: Record<string, string> = {
  "incident-response": "🚨",
  "identity-access": "🔐",
  "compliance-posture": "📋",
  "device-endpoint": "💻",
  "data-protection": "🛡️",
  reporting: "📊",
};

function LicenseBadge({ name, active }: { name: string; active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
        active
          ? "bg-emerald-400/10 text-emerald-400 border-emerald-400/20"
          : "bg-gray-500/10 text-gray-500 border-gray-500/20"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-emerald-400" : "bg-gray-500"}`} />
      {name}
    </span>
  );
}

function IssueStat({ label, count, icon, severity }: { label: string; count: number; icon: string; severity: "critical" | "warning" | "info" }) {
  if (count === 0) return null;
  const colors = {
    critical: "text-red-400",
    warning: "text-yellow-400",
    info: "text-blue-400",
  };
  return (
    <div className={`flex items-center gap-2 ${colors[severity]}`}>
      <span>{icon}</span>
      <span className="font-mono font-bold text-lg">{count}</span>
      <span className="text-xs text-gray-400">{label}</span>
    </div>
  );
}

export function WorkflowPanel() {
  const [context, setContext] = useState<EnvironmentContext | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestedWorkflow[]>([]);
  const [assessing, setAssessing] = useState(false);
  const [plan, setPlan] = useState<ExecutionPlan | null>(null);
  const [generating, setGenerating] = useState(false);
  const [stepResults, setStepResults] = useState<Map<string, StepResult>>(new Map());
  const [executingStep, setExecutingStep] = useState<string | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);
  const [catalog, setCatalog] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  const api = useCallback(async (action: string, body: Record<string, unknown> = {}) => {
    const res = await fetch("/api/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || `API error ${res.status}`);
    }
    return res.json();
  }, []);

  const handleAssess = useCallback(async (forceRefresh = false) => {
    setAssessing(true);
    setError(null);
    setPlan(null);
    setStepResults(new Map());
    try {
      const ctx = await api("assess", { forceRefresh });
      setContext(ctx);
      const sug = await api("suggest", { context: ctx });
      setSuggestions(sug.suggestions || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAssessing(false);
    }
  }, [api]);

  const handleStartWorkflow = useCallback(async (workflowId: string) => {
    setGenerating(true);
    setError(null);
    setStepResults(new Map());
    try {
      const result = await api("generate", { workflowId, context });
      setPlan(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }, [api, context]);

  const handleExecuteStep = useCallback(async (step: ExecutionStep) => {
    setExecutingStep(step.id);
    const newResults = new Map(stepResults);
    newResults.set(step.id, { stepId: step.id, status: "running" });
    setStepResults(newResults);

    const startTime = Date.now();
    try {
      const params = { ...step.resolvedParams };
      delete params.__dynamicParams;
      const data = await api("execute-step", { toolName: step.tool, params });
      const durationMs = Date.now() - startTime;
      const updatedResults = new Map(stepResults);
      updatedResults.set(step.id, { stepId: step.id, status: "success", data, durationMs });
      setStepResults(updatedResults);
    } catch (e: unknown) {
      const durationMs = Date.now() - startTime;
      const updatedResults = new Map(stepResults);
      updatedResults.set(step.id, {
        stepId: step.id,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
        durationMs,
      });
      setStepResults(updatedResults);
    } finally {
      setExecutingStep(null);
    }
  }, [api, stepResults]);

  const handleExecuteAll = useCallback(async () => {
    if (!plan) return;
    for (const step of plan.steps) {
      if (step.humanGate) continue;
      const existing = stepResults.get(step.id);
      if (existing?.status === "success") continue;
      await handleExecuteStep(step);
    }
  }, [plan, stepResults, handleExecuteStep]);

  const handleShowCatalog = useCallback(async () => {
    try {
      const result = await api("catalog");
      setCatalog(result);
      setShowCatalog(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api]);

  // Not assessed yet — show the assess button
  if (!context && !assessing) {
    return (
      <div className="bg-gradient-to-r from-indigo-950/50 via-purple-950/50 to-indigo-950/50 rounded-2xl border border-indigo-500/20 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              ⚡ Adaptive Workflow Engine
            </h2>
            <p className="text-gray-400 text-sm mt-1">
              Assess your environment to get AI-powered workflow suggestions ranked by priority
            </p>
          </div>
          <button
            onClick={() => handleAssess()}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors"
          >
            🔍 Assess Environment
          </button>
        </div>
      </div>
    );
  }

  // Assessing...
  if (assessing) {
    return (
      <div className="bg-gradient-to-r from-indigo-950/50 via-purple-950/50 to-indigo-950/50 rounded-2xl border border-indigo-500/20 p-6">
        <div className="flex items-center gap-3">
          <div className="animate-spin w-5 h-5 border-2 border-indigo-400 border-t-transparent rounded-full" />
          <div>
            <h2 className="text-lg font-bold text-white">Assessing Environment...</h2>
            <p className="text-gray-400 text-sm">Probing Defender, Entra, Intune, Purview APIs to detect licenses and count open issues</p>
          </div>
        </div>
      </div>
    );
  }

  // Active execution plan
  if (plan) {
    const completedCount = Array.from(stepResults.values()).filter(r => r.status === "success").length;
    const failedCount = Array.from(stepResults.values()).filter(r => r.status === "failed").length;
    const progress = plan.steps.length > 0 ? Math.round(((completedCount + failedCount) / plan.steps.length) * 100) : 0;

    return (
      <div className="bg-gradient-to-r from-indigo-950/50 via-purple-950/50 to-indigo-950/50 rounded-2xl border border-indigo-500/20 p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">▶ {plan.workflowName}</h2>
            <p className="text-gray-400 text-sm">
              {completedCount}/{plan.steps.length} steps completed
              {plan.skippedSteps.length > 0 && ` · ${plan.skippedSteps.length} skipped`}
              {failedCount > 0 && ` · ${failedCount} failed`}
              {` · ${plan.estimatedDuration}`}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleExecuteAll}
              disabled={!!executingStep || completedCount === plan.steps.length}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              ▶ Run All Steps
            </button>
            <button
              onClick={() => { setPlan(null); setStepResults(new Map()); }}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
            >
              ← Back
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-gray-800 rounded-full h-2">
          <div
            className="bg-indigo-500 h-2 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Steps */}
        <div className="space-y-2">
          {plan.steps.map((step, i) => {
            const result = stepResults.get(step.id);
            const isRunning = result?.status === "running";
            const isDone = result?.status === "success";
            const isFailed = result?.status === "failed";

            return (
              <div
                key={step.id}
                className={`rounded-lg border p-3 ${
                  isDone
                    ? "border-emerald-500/30 bg-emerald-950/20"
                    : isFailed
                      ? "border-red-500/30 bg-red-950/20"
                      : isRunning
                        ? "border-indigo-500/30 bg-indigo-950/20"
                        : "border-gray-700/50 bg-gray-900/50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-mono text-gray-500 w-6">{i + 1}.</span>
                    <span className="text-sm">
                      {isRunning && <span className="animate-spin inline-block mr-1">🔄</span>}
                      {isDone && "✅ "}
                      {isFailed && "❌ "}
                      {!result && "⬜ "}
                    </span>
                    <div>
                      <span className="text-sm text-white font-medium">{step.name}</span>
                      <span className="text-xs text-gray-500 ml-2">→ {step.tool}</span>
                      {step.forEach && <span className="text-xs text-purple-400 ml-2">(forEach, max {step.maxIterations})</span>}
                      {step.humanGate && <span className="text-xs text-yellow-400 ml-2">⚠ requires approval</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {result?.durationMs && (
                      <span className="text-xs text-gray-500">{(result.durationMs / 1000).toFixed(1)}s</span>
                    )}
                    {!result && !isRunning && (
                      <button
                        onClick={() => handleExecuteStep(step)}
                        disabled={!!executingStep}
                        className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 text-white rounded text-xs font-medium transition-colors"
                      >
                        Run
                      </button>
                    )}
                  </div>
                </div>
                {isDone && result.data ? (
                  <details className="mt-2">
                    <summary className="text-xs text-indigo-400 cursor-pointer hover:text-indigo-300">View result</summary>
                    <pre className="mt-1 text-xs text-gray-400 bg-black/30 rounded p-2 overflow-x-auto max-h-40 overflow-y-auto">
                      {JSON.stringify(result.data as Record<string, unknown>, null, 2).substring(0, 2000)}
                    </pre>
                  </details>
                ) : null}
                {isFailed && result.error ? (
                  <p className="mt-1 text-xs text-red-400">{String(result.error)}</p>
                ) : null}
              </div>
            );
          })}

          {/* Skipped steps */}
          {plan.skippedSteps.length > 0 ? (
            <details className="mt-2">
              <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400">
                {plan.skippedSteps.length} steps skipped
              </summary>
              <div className="mt-1 space-y-1">
                {plan.skippedSteps.map((s) => (
                  <div key={s.stepId} className="text-xs text-gray-600 flex items-center gap-2">
                    <span>⏭️</span>
                    <span>{s.stepName}</span>
                    <span className="text-gray-700">— {s.reason}</span>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </div>

        {error ? <p className="text-red-400 text-sm">{error}</p> : null}
      </div>
    );
  }

  // Show environment assessment + suggestions
  return (
    <div className="bg-gradient-to-r from-indigo-950/50 via-purple-950/50 to-indigo-950/50 rounded-2xl border border-indigo-500/20 p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">⚡ Command Center</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={handleShowCatalog}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            📚 All Workflows ({suggestions.length > 0 ? "22" : "..."})
          </button>
          <button
            onClick={() => handleAssess(true)}
            className="text-xs text-gray-400 hover:text-white transition-colors"
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Environment Status */}
      {context && (
        <div className="space-y-3">
          {/* Licenses */}
          <div className="flex flex-wrap gap-2">
            <LicenseBadge name="Defender" active={context.licenses.hasDefender} />
            <LicenseBadge name="Sentinel" active={context.licenses.hasSentinel} />
            <LicenseBadge name="Intune" active={context.licenses.hasIntune} />
            <LicenseBadge name="Purview" active={context.licenses.hasPurview} />
            <LicenseBadge name="Entra P2" active={context.licenses.hasEntraP2} />
            <LicenseBadge name="Defender for Cloud" active={context.licenses.hasDefenderForCloud} />
          </div>

          {/* Open Issues Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            <IssueStat icon="🚨" label="High Alerts" count={context.openIssues.highSeverityAlerts} severity="critical" />
            <IssueStat icon="👤" label="Risky Users" count={context.openIssues.riskyUsers} severity="critical" />
            <IssueStat icon="🔓" label="Admins no MFA" count={context.openIssues.adminsWithoutMFA} severity="critical" />
            <IssueStat icon="💻" label="Non-Compliant" count={context.openIssues.nonCompliantDevices} severity="warning" />
            <IssueStat icon="📄" label="DLP Violations" count={context.openIssues.dlpViolations} severity="warning" />
            <IssueStat icon="🕵️" label="Insider Risks" count={context.openIssues.insiderRiskAlerts} severity="warning" />
            <IssueStat icon="👻" label="Stale Admins" count={context.openIssues.staleAdmins} severity="warning" />
            <IssueStat icon="⚠️" label="Policy Conflicts" count={context.openIssues.policyConflicts} severity="info" />
            {context.openIssues.secureScorePercent > 0 && (
              <div className="flex items-center gap-2 text-blue-400">
                <span>📊</span>
                <span className="font-mono font-bold text-lg">{context.openIssues.secureScorePercent}%</span>
                <span className="text-xs text-gray-400">Secure Score</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Suggested Workflows */}
      {suggestions.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
            Recommended Workflows
          </h3>
          <div className="grid gap-2">
            {suggestions.map((wf) => (
              <button
                key={wf.workflowId}
                onClick={() => handleStartWorkflow(wf.workflowId)}
                disabled={generating}
                className="w-full text-left p-3 rounded-lg border border-gray-700/50 bg-gray-900/50 hover:bg-gray-800/50 hover:border-indigo-500/30 transition-all group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-lg">{CATEGORY_ICONS[wf.category] ?? "📋"}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white">{wf.name}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${COMPLEXITY_COLORS[wf.complexity]}`}>
                          {wf.complexity}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 truncate">{wf.reason}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-gray-500">{wf.estimatedDuration}</span>
                    <span className="text-xs text-gray-500">{wf.stepsCount} steps</span>
                    <span className="text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity">▶</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : suggestions.length === 0 && context ? (
        <div className="text-center py-4">
          <p className="text-emerald-400 text-sm">✅ No urgent workflows — your environment looks healthy!</p>
          <button
            onClick={handleShowCatalog}
            className="mt-2 text-xs text-indigo-400 hover:text-indigo-300"
          >
            Browse all 22 workflows →
          </button>
        </div>
      ) : null}

      {/* Catalog modal */}
      {showCatalog && catalog ? (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowCatalog(false)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl max-w-3xl w-full max-h-[80vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">📚 Workflow Catalog</h2>
              <button onClick={() => setShowCatalog(false)} className="text-gray-400 hover:text-white text-lg">✕</button>
            </div>
            {Object.entries((catalog as Record<string, unknown>).byCategory as Record<string, Array<Record<string, unknown>>>).map(([cat, workflows]) => (
              <div key={cat} className="mb-4">
                <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-2">
                  {CATEGORY_ICONS[cat] ?? "📋"} {cat.replace(/-/g, " ")}
                </h3>
                <div className="space-y-1">
                  {workflows.map((wf: Record<string, unknown>) => (
                    <button
                      key={wf.id as string}
                      onClick={() => { setShowCatalog(false); handleStartWorkflow(wf.id as string); }}
                      className="w-full text-left p-2 rounded-lg hover:bg-gray-800 transition-colors flex items-center justify-between"
                    >
                      <div>
                        <span className="text-sm text-white">{wf.name as string}</span>
                        <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium border ${COMPLEXITY_COLORS[wf.complexity as string]}`}>
                          {wf.complexity as string}
                        </span>
                        <p className="text-xs text-gray-500">{wf.description as string}</p>
                      </div>
                      <span className="text-xs text-gray-500 shrink-0">{wf.estimatedDuration as string}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {error ? <p className="text-red-400 text-sm mt-2">⚠ {error}</p> : null}
    </div>
  );
}
