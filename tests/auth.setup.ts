/**
 * Auth setup — signs in via Azure CLI and creates a session cookie.
 * Runs once before all workflow tests. Saves browser state to reuse.
 */
import { test as setup, expect } from "@playwright/test";
import { mkdirSync } from "fs";

const AUTH_FILE = "test-results/.auth/state.json";

setup("authenticate via Azure CLI", async ({ page }) => {
  mkdirSync("test-results/.auth", { recursive: true });

  // Step 1: Hit login page
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();

  // Step 2: Click sign in
  const signInBtn = page.getByRole("button", { name: /sign in/i });
  await expect(signInBtn).toBeVisible({ timeout: 10_000 });
  await signInBtn.click();

  // Step 3: Wait for tenant picker to appear (Azure CLI is assumed logged in)
  // The login API calls `az account show` and returns tenants
  await page.waitForResponse(
    (res) => res.url().includes("/api/login") && res.status() === 200,
    { timeout: 15_000 }
  );

  // Step 4: Wait for tenant selector to be visible, then pick the first/default tenant
  const tenantSelect = page.locator("select").first();
  await expect(tenantSelect).toBeVisible({ timeout: 10_000 });

  // Click "Continue" or similar button to select tenant
  const continueBtn = page.getByRole("button", { name: /continue|next|select/i });
  if (await continueBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await continueBtn.click();
  }

  // Step 5: Wait for subscriptions/app detection to load
  await page.waitForResponse(
    (res) => res.url().includes("/api/login") && res.request().method() === "POST",
    { timeout: 15_000 }
  );

  // Step 6: Click "View Dashboard" or equivalent
  // The button might say different things depending on state
  await page.waitForTimeout(2_000); // let UI settle
  const dashBtn = page.getByRole("button", { name: /dashboard|view|launch/i });
  if (await dashBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await dashBtn.click();
  }

  // Step 7: Wait for dashboard to load (session cookie is now set)
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
  await expect(page.locator("body")).toBeVisible();

  // Wait for dashboard data to start loading
  await page.waitForTimeout(3_000);

  // Save auth state (cookies + localStorage)
  await page.context().storageState({ path: AUTH_FILE });
});
