import { test, expect } from "@playwright/test";

test.describe("Workspace management", () => {
  test.beforeEach(async ({ page }) => {
    // Login with real credentials
    await page.goto("/login");
    await page.getByPlaceholder("3-32位字母、数字或下划线").fill("admin");
    await page.getByPlaceholder("至少6位").fill("246813");
    await page.locator('form').getByRole("button", { name: "登录" }).click();

    // Should redirect to workspaces
    await expect(page).toHaveURL(/\/workspaces/, { timeout: 10_000 });
  });

  test("workspace list page shows heading and create option", async ({ page }) => {
    await expect(page.getByText("我的灵感空间")).toBeVisible();
    await expect(page.getByText("选择一个空间开始探索")).toBeVisible();
    await expect(page.getByText("新建空间")).toBeVisible();
    await expect(page.getByText("加入空间")).toBeVisible();
  });

  test("create workspace modal opens and closes", async ({ page }) => {
    // Click create workspace card
    await page.getByText("新建空间").click();

    // Modal should appear
    await expect(page.getByText("新建灵感空间")).toBeVisible();
    await expect(page.getByPlaceholder("输入空间名称...")).toBeVisible();

    // Close modal by pressing Escape
    await page.keyboard.press("Escape");

    // Modal should be gone
    await expect(page.getByText("新建灵感空间")).not.toBeVisible();
  });

  test("create workspace requires name", async ({ page }) => {
    await page.getByText("新建空间").click();
    await expect(page.getByText("新建灵感空间")).toBeVisible();

    // Try to submit without name — button should be disabled or form won't submit
    const createBtn = page.getByRole("button", { name: "创建" });
    await createBtn.click();

    // Modal should still be open (validation failed)
    await expect(page.getByText("新建灵感空间")).toBeVisible();
  });

  test("create a new workspace", async ({ page }) => {
    const wsName = `测试空间_${Date.now()}`;

    await page.getByText("新建空间").click();
    await page.getByPlaceholder("输入空间名称...").fill(wsName);
    await page.getByRole("button", { name: "创建" }).click();

    // Modal should close and new workspace appears in list
    await expect(page.getByText("新建灵感空间")).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(wsName)).toBeVisible({ timeout: 10_000 });
  });

  test("join workspace modal opens", async ({ page }) => {
    await page.getByText("加入空间").click();

    await expect(page.getByText("加入空间").last()).toBeVisible();
    await expect(page.getByPlaceholder("输入6位邀请码")).toBeVisible();
  });

  test("navigate into workspace by clicking", async ({ page }) => {
    // Wait for workspace list to load
    await expect(page.getByText("我的灵感空间")).toBeVisible();

    // Find the first workspace card (not the "新建空间" or "加入空间" cards)
    const workspaceCards = page.locator(".group.relative.cursor-pointer");
    const count = await workspaceCards.count();

    if (count > 0) {
      // Click the first workspace
      await workspaceCards.first().click();

      // Should navigate to workspace detail page
      await expect(page).toHaveURL(/\/workspaces\/[a-f0-9-]+/, { timeout: 10_000 });
    }
  });

  test("settings button navigates to settings", async ({ page }) => {
    await page.getByTitle("模型设置").click();
    await expect(page).toHaveURL(/\/settings\/models/);
  });

  test("profile button navigates to profile", async ({ page }) => {
    await page.getByText("个人中心").click();
    await expect(page).toHaveURL(/\/profile/);
  });
});
