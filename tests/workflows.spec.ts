/**
 * Workflow E2E Tests — runs all 22 built-in workflows via the dashboard.
 *
 * Prerequisites:
 *   - `az login` completed
 *   - MCP server built (`npm run build` in security-scanner-sample)
 *   - Dashboard dev server running or auto-started via playwright.config
 *   - App registration with credentials stored in dashboard DB
 *
 * Run:
 *   npx playwright test
 *   npx playwright test --headed          # watch in Edge
 *   npx playwright test -g "alert-triage" # single workflow
 */
import { test, expect, type Page } from "@playwright/test";

// All 22 workflow IDs from the catalog
const WORKFLOWS = [
  // Incident Response
  { id: "alert-triage", name: "Alert Triage & Prioritization", category: "incident-response" },
  { id: "investigate-incident", name: "Full Incident Investigation", category: "incident-response" },
  { id: "insider-threat-investigation", name: "Insider Threat Deep-Dive", category: "incident-response" },
  { id: "phishing-response", name: "Phishing Email Response", category: "incident-response" },
  { id: "ransomware-containment", name: "Ransomware Containment", category: "incident-response" },
  // Identity & Access
  { id: "user-risk-assessment", name: "User Risk Assessment", category: "identity-access" },
  { id: "privileged-access-review", name: "Privileged Access Review", category: "identity-access" },
  { id: "access-certification", name: "Access Certification Campaign", category: "identity-access" },
  { id: "suspicious-signin-analysis", name: "Suspicious Sign-in Analysis", category: "identity-access" },
  // Compliance & Posture
  { id: "compliance-assessment", name: "Framework Compliance Check", category: "compliance-posture" },
  { id: "secure-score-improvement", name: "Secure Score Improvement Plan", category: "compliance-posture" },
  { id: "infrastructure-audit", name: "OWASP Infrastructure Assessment", category: "compliance-posture" },
  { id: "policy-gap-analysis", name: "Security Policy Gap Analysis", category: "compliance-posture" },
  // Device & Endpoint
  { id: "device-compliance-audit", name: "Device Compliance Report", category: "device-endpoint" },
  { id: "device-policy-conflicts", name: "Policy Conflict Detection", category: "device-endpoint" },
  { id: "stale-device-cleanup", name: "Stale Device Identification", category: "device-endpoint" },
  // Data Protection
  { id: "dlp-triage", name: "DLP Alert Triage", category: "data-protection" },
  { id: "data-security-posture", name: "Data Security Posture Review", category: "data-protection" },
  { id: "sensitive-data-discovery", name: "Sensitive Data Classification Review", category: "data-protection" },
  // Reporting
  { id: "executive-report", name: "Executive Security Report", category: "reporting" },
  { id: "threat-hunt-report", name: "Proactive Threat Hunt", category: "reporting" },
  { id: "attack-path-analysis", name: "Attack Path Visualization", category: "reporting" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Call the workflows API directly (faster than clicking through UI) */
async function apiCall(page: Page, action: string, body: Record<string, unknown> = {}) {
  const response = await page.request.post("/api/workflows", {
    data: { action, ...body },
  });
  expect(response.ok(), `API ${action} failed: ${response.status()}`).toBeTruthy();
  return response.json();
}

/** Execute a single workflow step via API */
async function executeStep(
  page: Page,
  toolName: string,
  params: Record<string, unknown>
): Promise<{ ok: boolean; data?: unknown; error?: string; durationMs: number }> {
  const start = Date.now();
  try {
    const result = await apiCall(page, "execute-step", { toolName, params });
    return {
      ok: !result?.error,
      data: result,
      error: result?.error,
      durationMs: Date.now() - start,
    };
  } catch (e: unknown) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - start,
    };
  }
}

// ---------------------------------------------------------------------------
// Test: Assess Environment (runs first, verifies tenant connectivity)
// ---------------------------------------------------------------------------

test.describe("Environment Assessment", () => {
  test("should assess environment and detect licenses", async ({ page }) => {
    const result = await apiCall(page, "assess", { forceRefresh: true });

    expect(result.tenantId).toBeTruthy();
    expect(result.licenses).toBeDefined();
    expect(result.openIssues).toBeDefined();
    expect(result.assessedAt).toBeTruthy();

    // Log what we found
    const licenses = result.licenses;
    const issues = result.openIssues;
    console.log("\n═══ Environment Assessment ═══");
    console.log(`Tenant: ${result.tenantId}`);
    console.log(`Licenses: ${Object.entries(licenses).filter(([, v]) => v).map(([k]) => k).join(", ") || "none detected"}`);
    console.log(`Open Issues: ${JSON.stringify(issues, null, 2)}`);

    // Attach to report
    test.info().annotations.push({
      type: "environment",
      description: JSON.stringify({ licenses, issues }, null, 2),
    });
  });

  test("should suggest workflows based on environment", async ({ page }) => {
    const result = await apiCall(page, "suggest");

    console.log(`\n═══ Suggested Workflows (${result.suggestionsCount ?? 0}) ═══`);
    if (result.suggestions) {
      for (const s of result.suggestions) {
        console.log(`  ${s.rank}. [P${s.priority}] ${s.name} — ${s.reason}`);
      }
    }

    expect(result.suggestionsCount).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Test: Run Each Workflow
// ---------------------------------------------------------------------------

test.describe("Workflow Execution", () => {
  for (const wf of WORKFLOWS) {
    test(`${wf.id}: ${wf.name}`, async ({ page }) => {
      test.info().annotations.push({ type: "category", description: wf.category });

      // Step 1: Generate execution plan
      console.log(`\n─── ${wf.name} ───`);
      const plan = await apiCall(page, "generate", { workflowId: wf.id });

      const steps = plan.steps ?? [];
      const skipped = plan.skippedSteps ?? [];

      console.log(`  Plan: ${steps.length} steps, ${skipped.length} skipped`);

      if (skipped.length > 0) {
        for (const s of skipped) {
          console.log(`  ⏭️  ${s.stepName}: ${s.reason}`);
        }
      }

      // Step 2: Execute each step
      const results: Array<{
        step: string;
        tool: string;
        status: string;
        durationMs: number;
        summary: string;
      }> = [];

      for (const step of steps) {
        const params = { ...step.resolvedParams };
        // Remove internal metadata
        delete params.__dynamicParams;

        console.log(`  🔄 ${step.name} → ${step.tool}`);
        const result = await executeStep(page, step.tool, params);

        const summary = result.ok
          ? summarizeResult(step.tool, result.data)
          : `ERROR: ${result.error?.substring(0, 100)}`;

        const icon = result.ok ? "✅" : "❌";
        console.log(`  ${icon} ${step.name} (${(result.durationMs / 1000).toFixed(1)}s) — ${summary}`);

        results.push({
          step: step.name,
          tool: step.tool,
          status: result.ok ? "success" : "failed",
          durationMs: result.durationMs,
          summary,
        });
      }

      // Step 3: Report
      const succeeded = results.filter((r) => r.status === "success").length;
      const failed = results.filter((r) => r.status === "failed").length;
      const totalMs = results.reduce((a, r) => a + r.durationMs, 0);

      console.log(`  ── Result: ${succeeded}/${results.length} passed, ${failed} failed, ${(totalMs / 1000).toFixed(1)}s total`);

      // Attach results to HTML report
      test.info().annotations.push({
        type: "workflow-results",
        description: JSON.stringify({ steps: results, skipped }, null, 2),
      });

      // At least some steps should succeed (we don't fail the test if
      // individual steps fail due to missing licenses — that's expected)
      if (steps.length > 0) {
        expect(
          succeeded,
          `Expected at least 1 step to succeed in ${wf.name}`
        ).toBeGreaterThanOrEqual(1);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Test: Workflow Catalog
// ---------------------------------------------------------------------------

test.describe("Workflow Catalog", () => {
  test("should return all 22 workflows", async ({ page }) => {
    const result = await apiCall(page, "catalog");
    expect(result.totalWorkflows).toBe(22);
    expect(result.byCategory).toBeDefined();

    const categories = Object.keys(result.byCategory);
    expect(categories).toContain("incident-response");
    expect(categories).toContain("identity-access");
    expect(categories).toContain("compliance-posture");
    expect(categories).toContain("device-endpoint");
    expect(categories).toContain("data-protection");
    expect(categories).toContain("reporting");
  });

  test("should filter by category", async ({ page }) => {
    const result = await apiCall(page, "catalog", { category: "incident-response" });
    expect(result.totalWorkflows).toBe(5);
  });

  test("should filter by complexity", async ({ page }) => {
    const result = await apiCall(page, "catalog", { complexity: "high" });
    expect(result.totalWorkflows).toBeGreaterThan(0);
    const allHigh = Object.values(result.byCategory)
      .flat()
      .every((w: any) => w.complexity === "high");
    expect(allHigh).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Test: NL Workflow Creator
// ---------------------------------------------------------------------------

test.describe("NL Workflow Creator", () => {
  test("should generate workflow from natural language", async ({ page }) => {
    const result = await apiCall(page, "create-from-nl", {
      description: "Check all admin accounts for MFA gaps and show their last sign-in date",
    });

    expect(result.workflow).toBeDefined();
    expect(result.workflow.name).toBeTruthy();
    expect(result.workflow.steps).toBeDefined();
    expect(result.workflow.steps.length).toBeGreaterThan(0);

    console.log(`\n═══ NL Generated Workflow ═══`);
    console.log(`  Name: ${result.workflow.name}`);
    console.log(`  Steps: ${result.workflow.steps.length}`);
    for (const s of result.workflow.steps) {
      console.log(`    - ${s.name} → ${s.tool}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Test: UI — Workflows Page Loads
// ---------------------------------------------------------------------------

test.describe("Workflows Page UI", () => {
  test("should load workflows page with catalog", async ({ page }) => {
    await page.goto("/workflows");

    // Wait for catalog to load
    await expect(page.getByText("Security Workflows")).toBeVisible({ timeout: 10_000 });

    // Should show workflow cards
    const cards = page.locator("[class*='rounded-xl']").filter({ hasText: "▶ Run Workflow" });
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });

    const count = await cards.count();
    console.log(`\n  Workflows page: ${count} workflow cards rendered`);
    expect(count).toBeGreaterThanOrEqual(10); // at least some should render
  });

  test("should filter workflows by category", async ({ page }) => {
    await page.goto("/workflows");
    await expect(page.getByText("Security Workflows")).toBeVisible({ timeout: 10_000 });

    // Click "Identity & Access" filter
    const filterBtn = page.getByRole("button", { name: /identity/i });
    if (await filterBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await filterBtn.click();
      await page.waitForTimeout(500);

      // Cards should be filtered
      const cards = page.locator("[class*='rounded-xl']").filter({ hasText: "▶ Run Workflow" });
      const count = await cards.count();
      console.log(`  After filter: ${count} identity workflow cards`);
      expect(count).toBeLessThanOrEqual(4); // 4 identity workflows
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summarizeResult(tool: string, data: unknown): string {
  if (!data || typeof data !== "object") return "No data";
  const d = data as Record<string, unknown>;
  if (d.error) return `⚠ ${String(d.error).substring(0, 80)}`;
  if (d.alertCount !== undefined) return `${d.alertCount} alerts`;
  if (d.incidentCount !== undefined) return `${d.incidentCount} incidents`;
  if (d.userCount !== undefined) return `${d.userCount} users`;
  if (d.deviceCount !== undefined) return `${d.deviceCount} devices`;
  if (d.recordCount !== undefined) return `${d.recordCount} records`;
  if (d.currentScore !== undefined) return `Score: ${d.currentScore}/${d.maxScore}`;
  if (d.recommendationCount !== undefined) return `${d.recommendationCount} recommendations`;
  if (d.findings && Array.isArray(d.findings)) return `${d.findings.length} findings`;
  if (d.totalRecords !== undefined) return `${d.totalRecords} resources`;
  if (d.summary && typeof d.summary === "object") {
    const s = d.summary as Record<string, unknown>;
    return `${s.total ?? "?"} total`;
  }
  const val = d.value ?? d.alerts ?? d.users ?? d.devices ?? d.signIns ?? d.results;
  if (Array.isArray(val)) return `${val.length} items`;
  const keys = Object.keys(d).filter((k) => !k.startsWith("_")).slice(0, 3);
  return keys.join(", ") || "ok";
}
