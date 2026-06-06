import { test, expect } from "@playwright/test";

test.describe("Authentication flow", () => {
  test.beforeEach(async ({ page }) => {
    // Clear auth state
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("token"));
  });

  test("unauthenticated user sees login page", async ({ page }) => {
    await page.goto("/");

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);

    // Login page should show app branding
    await expect(page.getByText("MindCard")).toBeVisible();
    await expect(page.getByText("灵感卡片管理平台")).toBeVisible();
  });

  test("login form shows validation on empty submit", async ({ page }) => {
    await page.goto("/login");

    // Click submit without filling in fields
    await page.locator('form').getByRole("button", { name: "登录" }).click();

    // HTML5 validation prevents submit — form should still be visible
    await expect(page.getByPlaceholder("3-32位字母、数字或下划线")).toBeVisible();
  });

  test("login form accepts input", async ({ page }) => {
    await page.goto("/login");

    // Fill in credentials
    await page.getByPlaceholder("3-32位字母、数字或下划线").fill("testuser");
    await page.getByPlaceholder("至少6位").fill("password123");

    // Verify input values
    await expect(page.getByPlaceholder("3-32位字母、数字或下划线")).toHaveValue("testuser");
    await expect(page.getByPlaceholder("至少6位")).toHaveValue("password123");
  });

  test("login with wrong credentials shows error", async ({ page }) => {
    await page.goto("/login");

    await page.getByPlaceholder("3-32位字母、数字或下划线").fill("nonexistent");
    await page.getByPlaceholder("至少6位").fill("wrongpassword");
    await page.locator('form').getByRole("button", { name: "登录" }).click();

    // Should show error message (either from server or network)
    await expect(page.locator(".text-danger, [class*='red']")).toBeVisible({ timeout: 10_000 });
  });

  test("login with valid credentials redirects to workspaces", async ({ page }) => {
    await page.goto("/login");

    await page.getByPlaceholder("3-32位字母、数字或下划线").fill("admin");
    await page.getByPlaceholder("至少6位").fill("246813");
    await page.locator('form').getByRole("button", { name: "登录" }).click();

    // Should redirect to workspaces
    await expect(page).toHaveURL(/\/workspaces/, { timeout: 10_000 });
  });
});
