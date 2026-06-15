# Web Frontend Tests

## 运行命令

```bash
cd web
pnpm test          # Vitest 单元测试
pnpm test:watch    # Vitest 监听模式
pnpm test:e2e      # Playwright E2E 测试（需后端运行）
```

## Vitest 单元测试 (`__tests__/`)

| 文件 | 测试数 | 覆盖内容 |
|------|--------|----------|
| `lib/utils.test.ts` | 7 | `cn()` 类名合并、Tailwind 冲突处理 |
| `lib/latex.test.ts` | 9 | `[TOC]` 转换、flow/seq → mermaid、LaTeX 定界符 |
| `lib/markdown-display.test.ts` | 25 | AI 格式修复、HTML 标签转义、空表格移除、引用链接化 |
| `lib/markdown-normalize.test.ts` | 13 | 简化版 markdown 规范化 |
| `lib/store.test.ts` | 6 | Zustand auth store — token 设置/清除 |
| `lib/workspace-layout-store.test.ts` | 12 | 面板布局 store — toggle、appendToEditor、hydrate |
| `lib/api.test.ts` | 11 | API client — auth header、URL 构建、请求体、错误处理 |

**总计**: 83 个测试用例

## Playwright E2E 测试 (`e2e/`)

需要后端服务运行（`cd server && uv run uvicorn app.main:app`）。

### `auth.spec.ts` — 认证流程（5 个测试）

- 未登录访问首页 → 重定向到 /login，显示品牌标识
- 空表单提交触发 HTML5 验证
- 表单输入填入和值验证
- 错误凭证登录 → 显示错误提示
- 正确凭证登录 → 跳转到工作区列表

### `workspace.spec.ts` — 工作区管理（8 个测试）

- 登录 → 跳转到工作区列表
- 工作区列表页显示标题和新建/加入选项
- 新建空间弹窗打开/关闭（Escape 键）
- 新建空间表单验证（空名称不提交）
- 创建新工作区 → 出现在列表中
- 加入空间弹窗打开
- 点击工作区卡片 → 导航到详情页
- 设置按钮/个人中心按钮导航

### `chat.spec.ts` — 工作区详情交互（11 个测试）

- 三栏布局加载（左侧面板、右侧面板）
- 左侧面板折叠/展开切换
- 右侧 AI 面板折叠/展开切换
- 状态筛选按钮（全部/收藏/临时/永久）
- 关键词搜索输入
- 排序选择器切换
- 新建卡片弹窗打开/关闭
- 新建卡片表单验证（内容必填）
- 创建新卡片 → 出现在列表中
- 情绪标签选择
- 侧边栏导航（洞察/图谱/动态）
- 成员面板打开
