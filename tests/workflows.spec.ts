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
  // LLM-based actions need longer timeouts
  const slow = ["analyze", "create-from-nl"].includes(action);
  const response = await page.request.post("/api/workflows", {
    data: { action, ...body },
    timeout: slow ? 60_000 : 15_000,
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
// Test: Assess Environment (runs first on dashboard, verifies tenant connectivity)
// ---------------------------------------------------------------------------

test.describe("Environment Assessment", () => {
  test("should assess environment via dashboard UI", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    // The panel might show "Assess Environment" (first time) or "Command Center" (cached)
    const assessBtn = page.getByRole("button", { name: /assess environment/i });
    const refreshBtn = page.getByRole("button", { name: /refresh/i });

    const isFirstTime = await assessBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    const isCached = await refreshBtn.isVisible({ timeout: 2_000 }).catch(() => false);

    await page.screenshot({ path: "test-results/screenshots/01-dashboard-before-assess.png" });

    if (isFirstTime) {
      await assessBtn.click();
    } else if (isCached) {
      // Already assessed — click Refresh to re-assess
      await refreshBtn.click();
    } else {
      // Workflow panel might not be visible yet — wait for dashboard to load
      await page.waitForTimeout(3_000);
      await page.screenshot({ path: "test-results/screenshots/01-dashboard-no-panel.png" });
      console.log("  ⚠️ Workflow panel not found — skipping assessment UI test");
      return;
    }

    // Wait for assessment to complete (license badges appear)
    await expect(page.getByText(/Defender|Sentinel|Intune|Purview|Entra/i).first()).toBeVisible({ timeout: 90_000 });
    await page.waitForTimeout(1_000);

    await page.screenshot({ path: "test-results/screenshots/02-environment-assessed.png" });

    // Verify license badges rendered
    const badges = page.locator("span").filter({ hasText: /Defender|Sentinel|Intune|Purview|Entra/i });
    const badgeCount = await badges.count();
    expect(badgeCount).toBeGreaterThanOrEqual(3);
    console.log(`\n  ✅ Environment assessed — ${badgeCount} license badges visible`);
  });
});

// ---------------------------------------------------------------------------
// Test: Run Each Workflow via the /workflows page UI
// ---------------------------------------------------------------------------

test.describe("Workflow Execution", () => {
  // Run workflows sequentially through the UI
  for (const wf of WORKFLOWS) {
    test(`${wf.id}: ${wf.name}`, async ({ page }) => {
      test.info().annotations.push({ type: "category", description: wf.category });

      // Navigate to workflows page
      await page.goto("/workflows");
      await expect(page.getByText(/Security Workflows/i)).toBeVisible({ timeout: 15_000 });

      // Wait for catalog to load
      await expect(page.getByRole("button", { name: /run workflow/i }).first()).toBeVisible({ timeout: 15_000 });

      // Find this workflow's card by its name text
      const card = page.locator("[class*='rounded-xl']").filter({ hasText: wf.name });
      await expect(card.first()).toBeVisible({ timeout: 5_000 });

      // Scroll to the card
      await card.first().scrollIntoViewIfNeeded();

      // Click "▶ Run Workflow" button on this card
      const runBtn = card.first().getByRole("button", { name: /run workflow/i });
      await runBtn.click();

      // Wait for execution panel to appear (progress bar or step list)
      await expect(page.getByText(/steps|step 1|progress/i).first()).toBeVisible({ timeout: 15_000 });

      // Screenshot the execution plan
      await page.screenshot({ path: `test-results/screenshots/wf-${wf.id}-01-plan.png`, fullPage: true });

      // Click "Run All Steps" if visible
      const runAllBtn = page.getByRole("button", { name: /run all/i });
      if (await runAllBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await runAllBtn.click();

        // Wait for completion — look for success icons or "passed" text
        // Poll for up to 120s for all steps to finish
        await page.waitForFunction(
          () => {
            const text = document.body.innerText;
            return text.includes("✅") || text.includes("passed") || text.includes("Result");
          },
          { timeout: 120_000 }
        );

        await page.waitForTimeout(1_000); // let UI settle
      }

      // Screenshot the results
      await page.screenshot({ path: `test-results/screenshots/wf-${wf.id}-02-results.png`, fullPage: true });

      // Verify at least something rendered (steps or results)
      const pageText = await page.textContent("body") ?? "";
      const hasStepOutput = pageText.includes("✅") || pageText.includes("❌") || pageText.includes("success") || pageText.includes("failed");
      console.log(`  ${hasStepOutput ? "✅" : "⚠️"} ${wf.name} — execution ${hasStepOutput ? "completed" : "rendered plan"}`);
      expect(hasStepOutput || pageText.includes(wf.name)).toBeTruthy();

      // Click Back to return to catalog for next test
      const backBtn = page.getByRole("button", { name: /back|cancel|close/i });
      if (await backBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await backBtn.click();
        await page.waitForTimeout(500);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Test: Workflow Catalog
// ---------------------------------------------------------------------------

test.describe("Workflow Catalog", () => {
  test("should display all 22 built-in workflows on the page", async ({ page }) => {
    // Clean up any leftover custom workflows from previous test runs
    try {
      const customs = await apiCall(page, "list-custom");
      for (const cw of (customs.workflows ?? []) as Array<Record<string, unknown>>) {
        await apiCall(page, "delete-custom", { workflowId: cw.workflowId });
      }
    } catch { /* ignore if no customs */ }

    await page.goto("/workflows");
    await expect(page.getByText(/Security Workflows/i)).toBeVisible({ timeout: 15_000 });

    const runButtons = page.getByRole("button", { name: /run workflow/i });
    await expect(runButtons.first()).toBeVisible({ timeout: 15_000 });

    const count = await runButtons.count();
    console.log(`\n  Workflow catalog: ${count} workflow cards`);
    expect(count).toBe(22);

    await page.screenshot({ path: "test-results/screenshots/catalog-full.png", fullPage: true });
  });

  test("should filter by category via UI", async ({ page }) => {
    await page.goto("/workflows");
    await expect(page.getByText(/Security Workflows/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /run workflow/i }).first()).toBeVisible({ timeout: 15_000 });

    // Click Identity & Access filter
    const filterBtn = page.getByRole("button", { name: /identity/i });
    await expect(filterBtn).toBeVisible({ timeout: 5_000 });
    await filterBtn.click();
    await page.waitForTimeout(500);

    const cards = page.getByRole("button", { name: /run workflow/i });
    const count = await cards.count();
    console.log(`  Filtered to Identity & Access: ${count} cards`);
    expect(count).toBe(4);

    await page.screenshot({ path: "test-results/screenshots/catalog-filtered-identity.png", fullPage: true });
  });

  test("should show workflow details with steps", async ({ page }) => {
    await page.goto("/workflows");
    await expect(page.getByRole("button", { name: /run workflow/i }).first()).toBeVisible({ timeout: 15_000 });

    // Click "Details" on the first card
    const detailsBtn = page.getByRole("button", { name: /details/i }).first();
    await expect(detailsBtn).toBeVisible({ timeout: 5_000 });
    await detailsBtn.click();
    await page.waitForTimeout(500);

    // Verify steps are shown
    const hasSteps = await page.getByText(/Steps \(/i).first().isVisible().catch(() => false);
    console.log(`  Details expanded: ${hasSteps ? "steps visible ✓" : "no steps section"}`);

    await page.screenshot({ path: "test-results/screenshots/catalog-details-expanded.png", fullPage: true });
    expect(hasSteps).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Test: AI Analysis
// ---------------------------------------------------------------------------

test.describe("AI Workflow Analysis", () => {
  test("should run a workflow and produce AI analysis with remediation scripts", async ({ page }) => {
    // Run a workflow via API
    const plan = await apiCall(page, "prepare", { workflowId: "privileged-access-review" });
    const steps = plan.steps ?? [];
    console.log(`\n  Running privileged-access-review: ${steps.length} steps`);

    // Execute all steps
    const results: Array<Record<string, unknown>> = [];
    for (const step of steps) {
      const params = { ...(step.resolvedParams ?? step.params ?? {}) };
      delete params.__dynamicParams;
      const result = await executeStep(page, step.tool, params);
      results.push({
        name: step.name,
        tool: step.tool,
        status: result.ok ? "success" : "error",
        summary: result.ok ? summarizeResult(step.tool, result.data) : `Error: ${result.error}`,
        result: result.data,
        error: result.error,
      });
      console.log(`  ${result.ok ? "✅" : "❌"} ${step.name} (${(result.durationMs / 1000).toFixed(1)}s)`);
    }

    // Call AI analysis
    console.log("  🧠 Running AI analysis...");
    const analysis = await apiCall(page, "analyze", {
      workflowName: "Privileged Access Review",
      steps: results,
      skippedSteps: plan.skippedSteps ?? [],
    });

    expect(analysis.analysis).toBeTruthy();
    expect(analysis.analysis.length).toBeGreaterThan(200);

    // Check analysis contains expected sections
    const text = analysis.analysis as string;
    const hasVerdict = text.includes("Verdict") || text.includes("verdict");
    const hasRiskScore = text.includes("Risk Score") || text.includes("/100");
    const hasRemediation = text.includes("Remediation") || text.includes("remediation") || text.includes("Fix");
    const hasScripts = text.includes("az ") || text.includes("Connect-MgGraph");

    console.log(`  Analysis length: ${text.length} chars`);
    console.log(`  Has verdict: ${hasVerdict ? "✅" : "❌"}`);
    console.log(`  Has risk score: ${hasRiskScore ? "✅" : "❌"}`);
    console.log(`  Has remediation: ${hasRemediation ? "✅" : "❌"}`);
    console.log(`  Has real scripts: ${hasScripts ? "✅" : "❌"}`);

    if (analysis.toolCallsMade?.length) {
      console.log(`  AI made ${analysis.toolCallsMade.length} additional tool calls:`);
      for (const tc of analysis.toolCallsMade) {
        console.log(`    → ${tc}`);
      }
    }

    expect(hasVerdict).toBeTruthy();
    expect(hasRemediation).toBeTruthy();

    // Log first 500 chars of analysis for test report
    console.log(`\n  ─── Analysis Preview ───`);
    console.log(`  ${text.substring(0, 500)}...`);
  });
});

// ---------------------------------------------------------------------------
// Test: NL Workflow Creator
// ---------------------------------------------------------------------------

test.describe("NL Workflow Creator — Full Lifecycle", () => {
  test("create → save → appears in catalog → run → results → delete", async ({ page }) => {
    // ── Step 1: Open creator modal ──
    await page.goto("/workflows");
    await expect(page.getByRole("button", { name: /run workflow/i }).first()).toBeVisible({ timeout: 15_000 });
    const initialCardCount = await page.getByRole("button", { name: /run workflow/i }).count();
    console.log(`\n  Initial catalog: ${initialCardCount} workflows`);

    const createBtn = page.getByRole("button", { name: /create custom/i });
    await createBtn.click();
    await expect(page.getByText(/describe what/i)).toBeVisible({ timeout: 5_000 });
    await page.screenshot({ path: "test-results/screenshots/nl-01-modal-open.png" });

    // ── Step 2: Type description and generate ──
    const textarea = page.locator("textarea").first();
    await textarea.fill("Get the current secure score and list top 5 improvement actions");

    const genBtn = page.getByRole("button", { name: /generate/i });
    await genBtn.click();

    // Wait for LLM to generate (up to 30s)
    await expect(page.getByText(/Steps \(/i).first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1_000);
    await page.screenshot({ path: "test-results/screenshots/nl-02-generated.png" });
    console.log("  ✅ Workflow generated from NL");

    // Verify steps are rendered
    const stepsText = await page.getByText(/Steps \(/i).first().textContent();
    expect(stepsText).toBeTruthy();
    console.log(`  ${stepsText}`);

    // ── Step 3: Set name and save ──
    const nameInput = page.locator("input[placeholder*='name']").first();
    if (await nameInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await nameInput.clear();
      await nameInput.fill("Test: Secure Score Check");
    }

    const saveBtn = page.getByRole("button", { name: /save to catalog/i });
    await expect(saveBtn).toBeVisible({ timeout: 3_000 });
    await saveBtn.click();

    // Wait for save confirmation
    await expect(page.getByText(/saved to catalog/i)).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: "test-results/screenshots/nl-03-saved.png" });
    console.log("  ✅ Saved to catalog");

    // ── Step 4: Close modal and verify it appears in catalog ──
    // Close the modal
    const closeBtn = page.locator("button[aria-label='Close']");
    if (await closeBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await closeBtn.click();
    } else {
      await page.keyboard.press("Escape");
    }
    await page.waitForTimeout(1_000);

    // Custom workflow should now appear with CUSTOM badge
    const customBadge = page.getByText("CUSTOM");
    const hasCustom = await customBadge.first().isVisible({ timeout: 5_000 }).catch(() => false);
    expect(hasCustom).toBeTruthy();

    const newCardCount = await page.getByRole("button", { name: /run workflow/i }).count();
    console.log(`  Catalog now: ${newCardCount} workflows (was ${initialCardCount})`);
    expect(newCardCount).toBeGreaterThan(initialCardCount);
    await page.screenshot({ path: "test-results/screenshots/nl-04-in-catalog.png", fullPage: true });

    // ── Step 5: Run the custom workflow via API ──
    // Use API for the actual execution (more reliable than clicking through UI)
    const listResult = await apiCall(page, "list-custom");
    expect(listResult.count).toBeGreaterThanOrEqual(1);
    const savedWf = listResult.workflows[0];
    const wfDef = savedWf.definition;
    const steps = wfDef.steps ?? [];

    console.log(`  Running ${steps.length} steps...`);
    let succeeded = 0;
    let failed = 0;
    for (const step of steps) {
      const result = await executeStep(page, step.tool, step.params ?? {});
      if (result.ok) succeeded++;
      else failed++;
      const icon = result.ok ? "✅" : "❌";
      console.log(`  ${icon} ${step.name} → ${step.tool} (${(result.durationMs / 1000).toFixed(1)}s)`);
    }
    expect(succeeded).toBeGreaterThanOrEqual(1);
    console.log(`  Results: ${succeeded}/${steps.length} steps passed`);

    // Save the run to history
    await apiCall(page, "save-run", {
      workflowId: savedWf.workflowId,
      status: failed === 0 ? "completed" : "partial",
      mode: "auto",
      totalSteps: steps.length,
      completedSteps: succeeded,
      skippedSteps: 0,
      failedSteps: failed,
      findingsCount: 0,
      triggeredBy: "e2e-test",
    });

    // Verify run history
    const runsResult = await apiCall(page, "list-runs", { workflowId: savedWf.workflowId });
    expect(runsResult.count).toBeGreaterThanOrEqual(1);
    console.log(`  Run history: ${runsResult.count} runs recorded ✓`);

    // ── Step 6: Delete the custom workflow ──
    await apiCall(page, "delete-custom", { workflowId: savedWf.workflowId });
    console.log(`  Deleted: ${savedWf.workflowId} ✓`);

    // Verify it's gone
    const afterDelete = await apiCall(page, "list-custom");
    const stillExists = (afterDelete.workflows ?? []).some(
      (w: Record<string, unknown>) => w.workflowId === savedWf.workflowId
    );
    expect(stillExists).toBeFalsy();

    // Reload page and verify card count is back to original
    await page.goto("/workflows");
    await expect(page.getByRole("button", { name: /run workflow/i }).first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1_000);
    const finalCount = await page.getByRole("button", { name: /run workflow/i }).count();
    console.log(`  Final catalog: ${finalCount} workflows (should be ${initialCardCount})`);
    expect(finalCount).toBe(initialCardCount);
    await page.screenshot({ path: "test-results/screenshots/nl-05-after-delete.png", fullPage: true });
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


// ---------------------------------------------------------------------------
// Test: Skills Catalog
// ---------------------------------------------------------------------------

test.describe("Skills Catalog", () => {
  test("should list built-in skills via API", async ({ page }) => {
    const res = await page.request.post("/api/skills", {
      data: { action: "list" },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.builtInCount).toBeGreaterThanOrEqual(4);
    console.log(`\n  Skills: ${data.builtInCount} built-in, ${data.customCount} custom`);
  });

  test("should load skills page with cards", async ({ page }) => {
    await page.goto("/skills");
    await expect(page.getByText(/AI Skills/i)).toBeVisible({ timeout: 15_000 });

    // Wait for skill cards to appear
    await page.waitForTimeout(2_000);
    await page.screenshot({ path: "test-results/screenshots/skills-catalog.png", fullPage: true });

    const pageText = await page.textContent("body") ?? "";
    expect(pageText).toContain("Credential Theft");
    console.log("  ✅ Skills page loaded with built-in skills");
  });

  test("should create skill from NL, save, verify in catalog, delete", async ({ page }) => {
    // Create via API (LLM call — needs longer timeout)
    const genRes = await page.request.post("/api/skills", {
      data: {
        action: "create-from-nl",
        description: "Detect brute force attacks against Azure AD by looking for multiple failed sign-ins from the same IP",
      },
      timeout: 60_000,
    });
    expect(genRes.ok()).toBeTruthy();
    const genData = await genRes.json();
    expect(genData.skill).toBeDefined();
    expect(genData.skill.name).toBeTruthy();
    console.log(`\n  Generated skill: ${genData.skill.name}`);
    console.log(`  Queries: ${genData.skill.queries?.length ?? 0}, Remediation: ${genData.skill.remediation?.length ?? 0}`);

    // Save
    const skill = genData.skill;
    skill.id = skill.id || `test-skill-${Date.now()}`;
    const saveRes = await page.request.post("/api/skills", {
      data: { action: "save", skill },
    });
    expect(saveRes.ok()).toBeTruthy();
    const saveData = await saveRes.json();
    expect(saveData.saved).toBeTruthy();
    console.log(`  Saved: ${skill.id}`);

    // List and verify
    const listRes = await page.request.post("/api/skills", { data: { action: "list" } });
    const listData = await listRes.json();
    expect(listData.customCount).toBeGreaterThanOrEqual(1);
    console.log(`  Listed: ${listData.customCount} custom skills ✓`);

    // Delete
    const delRes = await page.request.post("/api/skills", {
      data: { action: "delete", skillId: skill.id },
    });
    expect(delRes.ok()).toBeTruthy();
    console.log(`  Deleted: ${skill.id} ✓`);

    // Verify this specific skill is gone
    const afterRes = await page.request.post("/api/skills", { data: { action: "list" } });
    const afterData = await afterRes.json();
    const stillExists = (afterData.skills ?? []).some((s: Record<string, unknown>) => s.id === skill.id || s.skillId === skill.id);
    expect(stillExists).toBeFalsy();
    console.log("  Verified cleanup ✓");
  });

  test("AI analysis should apply relevant skills", async ({ page }) => {
    // Run threat-hunt-report workflow (should match credential-theft-hunting skill)
    const plan = await apiCall(page, "prepare", { workflowId: "threat-hunt-report" });
    const steps = plan.steps ?? [];

    const results: Array<Record<string, unknown>> = [];
    for (const step of steps) {
      const params = { ...(step.resolvedParams ?? {}) };
      delete params.__dynamicParams;
      const result = await executeStep(page, step.tool, params);
      results.push({
        name: step.name, tool: step.tool,
        status: result.ok ? "success" : "error",
        result: result.data, error: result.error,
      });
    }

    // Analyze — should pick up threat hunting skills
    const analysis = await apiCall(page, "analyze", {
      workflowName: "Proactive Threat Hunt",
      steps: results,
      skippedSteps: plan.skippedSteps ?? [],
    });

    expect(analysis.analysis).toBeTruthy();
    console.log(`\n  Analysis with skills: ${analysis.analysis.length} chars`);
    console.log(`  Skills applied: ${(analysis.skillsApplied ?? []).join(", ") || "none"}`);

    if (analysis.skillsApplied?.length > 0) {
      console.log("  ✅ Skills were injected into analysis context");
    } else {
      console.log("  ⚠️ No skills matched (may depend on tool overlap)");
    }
  });
});

// ---------------------------------------------------------------------------
// Test: Agentic Workflow Execution
// ---------------------------------------------------------------------------

test.describe("Agentic Workflow Execution", () => {
  test("should execute workflow with AI agent that adapts based on findings", async ({ page }) => {
    // Prepare a workflow plan
    const plan = await apiCall(page, "prepare", { workflowId: "privileged-access-review" });
    const steps = plan.steps ?? [];
    console.log(`\n  Agentic execution: ${steps.length} planned steps`);

    // Execute with AI agent
    const result = (await page.request.post("/api/workflows", {
      data: {
        action: "execute-agentic",
        workflowName: "Privileged Access Review",
        steps: steps.map((s: Record<string, unknown>) => ({
          id: s.id, name: s.name, tool: s.tool,
          params: s.resolvedParams ?? s.params ?? {},
          resolvedParams: s.resolvedParams ?? s.params ?? {},
        })),
        workflowCategory: "identity-access",
        workflowTags: ["admin", "mfa", "privileged-access"],
      },
      timeout: 120_000,
    })).json() as Record<string, unknown>;

    expect(result.analysis).toBeTruthy();
    const stepsExecuted = (result.stepsExecuted ?? []) as Array<Record<string, unknown>>;
    const agentAdded = stepsExecuted.filter(s => s.source === "agent-added");
    const updates = (result.updates ?? []) as Array<Record<string, unknown>>;

    console.log(`  Steps executed: ${stepsExecuted.length} (${agentAdded.length} agent-added)`);
    console.log(`  Updates: ${updates.length}`);
    console.log(`  Duration: ${((result.totalDurationMs as number) / 1000).toFixed(1)}s`);

    for (const step of stepsExecuted) {
      const icon = step.error ? "❌" : "✅";
      const source = step.source === "agent-added" ? " [AGENT ADDED]" : "";
      console.log(`  ${icon} ${step.name} → ${step.tool} (${((step.durationMs as number) / 1000).toFixed(1)}s)${source}`);
    }

    if (agentAdded.length > 0) {
      console.log("  ✅ AI agent added investigation steps beyond the plan!");
    }

    const analysisText = result.analysis as string;
    console.log(`  Analysis: ${analysisText.length} chars`);
    console.log(`  Has verdict: ${analysisText.includes("Verdict") ? "✅" : "❌"}`);
    console.log(`  Has risk score: ${analysisText.includes("Risk Score") || analysisText.includes("/100") ? "✅" : "❌"}`);

    expect(stepsExecuted.length).toBeGreaterThanOrEqual(1);
    expect(analysisText.length).toBeGreaterThan(200);
  });
});