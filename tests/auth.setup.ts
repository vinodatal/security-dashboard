/**
 * Auth setup — signs in via Azure CLI and creates a session cookie.
 * Runs once before all workflow tests. Saves browser state to reuse.
 *
 * Login flow: Sign In → pick tenant → "Connect to Tenant →" → "View Dashboard →"
 */
import { test as setup, expect } from "@playwright/test";
import { mkdirSync } from "fs";

const AUTH_FILE = "test-results/.auth/state.json";

setup("authenticate via Azure CLI", async ({ page }) => {
  mkdirSync("test-results/.auth", { recursive: true });

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // If already on dashboard (session still valid), just save state
  if (page.url().includes("/dashboard")) {
    await page.context().storageState({ path: AUTH_FILE });
    return;
  }

  // Step 1: Click "Sign In"
  const signInBtn = page.getByRole("button", { name: /sign in/i });
  await expect(signInBtn).toBeVisible({ timeout: 10_000 });
  await signInBtn.click();

  // Step 2: Wait for tenant selector to appear
  await expect(page.locator("select").first()).toBeVisible({ timeout: 20_000 });

  // Step 3: Click "Connect to Tenant →"
  const connectBtn = page.getByRole("button", { name: /connect to tenant/i });
  await expect(connectBtn).toBeVisible({ timeout: 5_000 });
  await connectBtn.click();

  // Step 4: Wait for "View Dashboard →" button (ready state)
  const viewDashBtn = page.getByRole("button", { name: /view dashboard/i });
  await expect(viewDashBtn).toBeVisible({ timeout: 30_000 });
  await viewDashBtn.click();

  // Step 5: Wait for dashboard to load
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
  await page.waitForTimeout(3_000);

  await page.context().storageState({ path: AUTH_FILE });
});
