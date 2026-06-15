import { test, expect } from "@playwright/test";

test.describe("Workspace detail interactions", () => {
  test.beforeEach(async ({ page }) => {
    // Login with real credentials
    await page.goto("/login");
    await page.getByPlaceholder("3-32位字母、数字或下划线").fill("admin");
    await page.getByPlaceholder("至少6位").fill("246813");
    await page.locator('form').getByRole("button", { name: "登录" }).click();
    await expect(page).toHaveURL(/\/workspaces/, { timeout: 10_000 });

    // Navigate into the first workspace
    const workspaceCards = page.locator(".group.relative.cursor-pointer");
    const count = await workspaceCards.count();
    test.skip(count === 0, "No workspaces available");

    await workspaceCards.first().click();
    await expect(page).toHaveURL(/\/workspaces\/[a-f0-9-]+/, { timeout: 10_000 });
  });

  test("workspace layout has three panels", async ({ page }) => {
    // Left panel: card list area
    await expect(page.getByTitle("收起卡片列表")).toBeVisible();

    // Right panel: AI chat area
    await expect(page.getByTitle("收起AI对话")).toBeVisible();
  });

  test("toggle left panel collapse", async ({ page }) => {
    // Collapse left panel
    await page.getByTitle("收起卡片列表").click();

    // Button should change to expand
    await expect(page.getByTitle("展开卡片列表")).toBeVisible();

    // Expand it back
    await page.getByTitle("展开卡片列表").click();
    await expect(page.getByTitle("收起卡片列表")).toBeVisible();
  });

  test("toggle right panel collapse", async ({ page }) => {
    // Collapse right panel
    await page.getByTitle("收起AI对话").click();

    // Should show expand button
    await expect(page.getByTitle("展开AI对话")).toBeVisible();

    // Expand back
    await page.getByTitle("展开AI对话").click();
    await expect(page.getByTitle("收起AI对话")).toBeVisible();
  });

  test("status filter buttons work", async ({ page }) => {
    // Click filter buttons
    await page.getByText("收藏").click();
    // Should still be on the same page
    await expect(page).toHaveURL(/\/workspaces\//);

    await page.getByText("临时").click();
    await expect(page).toHaveURL(/\/workspaces\//);

    await page.getByText("永久").click();
    await expect(page).toHaveURL(/\/workspaces\//);

    // Reset to all
    await page.getByText("全部").first().click();
    await expect(page).toHaveURL(/\/workspaces\//);
  });

  test("keyword search input works", async ({ page }) => {
    const searchInput = page.getByPlaceholder("按关键词筛选...");
    await expect(searchInput).toBeVisible();

    await searchInput.fill("测试关键词");
    await expect(searchInput).toHaveValue("测试关键词");

    // Clear search
    await searchInput.clear();
    await expect(searchInput).toHaveValue("");
  });

  test("sort selector works", async ({ page }) => {
    const sortSelect = page.getByRole("combobox").first();
    await expect(sortSelect).toBeVisible();

    // Change sort option
    await sortSelect.selectOption("updated_at-desc");
    await expect(sortSelect).toHaveValue("updated_at-desc");

    await sortSelect.selectOption("title-asc");
    await expect(sortSelect).toHaveValue("title-asc");
  });

  test("create card modal opens and closes", async ({ page }) => {
    // Click create card button
    await page.getByText("新建卡片").click();

    // Modal should appear
    await expect(page.getByText("新建灵感卡片")).toBeVisible();
    await expect(page.getByPlaceholder("给灵感起个标题...")).toBeVisible();
    await expect(page.getByPlaceholder("记录你的灵感...")).toBeVisible();

    // Close with Escape
    await page.keyboard.press("Escape");
    await expect(page.getByText("新建灵感卡片")).not.toBeVisible();
  });

  test("create card requires content", async ({ page }) => {
    await page.getByText("新建卡片").click();
    await expect(page.getByText("新建灵感卡片")).toBeVisible();

    // Try to submit without content
    await page.getByRole("button", { name: "创建" }).click();

    // Modal should still be open
    await expect(page.getByText("新建灵感卡片")).toBeVisible();
  });

  test("create a new card", async ({ page }) => {
    const cardTitle = `测试卡片_${Date.now()}`;

    await page.getByText("新建卡片").click();
    await page.getByPlaceholder("给灵感起个标题...").fill(cardTitle);
    await page.getByPlaceholder("记录你的灵感...").fill("这是一张通过自动化测试创建的卡片");
    await page.getByPlaceholder("关键词1, 关键词2, ...").fill("测试,自动化");
    await page.getByRole("button", { name: "创建" }).click();

    // Modal should close and card appears in list
    await expect(page.getByText("新建灵感卡片")).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(cardTitle)).toBeVisible({ timeout: 10_000 });
  });

  test("emotion tag filters in create modal", async ({ page }) => {
    await page.getByText("新建卡片").click();

    // Click an emotion tag
    await page.getByText("开心").click();

    // Modal should still be open (tag selected, not a submit action)
    await expect(page.getByText("新建灵感卡片")).toBeVisible();

    await page.keyboard.press("Escape");
  });

  test("navigation links in sidebar", async ({ page }) => {
    // Click navigation items
    await page.getByText("洞察").click();
    await expect(page).toHaveURL(/\/insights/);

    await page.getByText("图谱").click();
    await expect(page).toHaveURL(/\/knowledge-graph/);

    await page.getByText("动态").click();
    await expect(page).toHaveURL(/\/activities/);
  });

  test("members panel opens", async ({ page }) => {
    await page.getByText("成员").click();

    await expect(page.getByText("空间成员")).toBeVisible();
  });
});
