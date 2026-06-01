"use client";

import { useParams, useRouter, usePathname } from "next/navigation";
import useSWR, { mutate } from "swr";
import { useState, useEffect } from "react";
import { workspaceApi, authApi, type Workspace } from "@/lib/api";
import { toast } from "@/lib/toast";
import { Modal } from "@/components/Modal";
import { FormField } from "@/components/FormField";
import { IconPicker, WorkspaceIcon, SPACE_ICON_KEYS } from "@/components/IconPicker";
import { ColorPicker, SPACE_COLORS } from "@/components/ColorPicker";
import { ErrorState } from "@/components/ErrorState";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Breadcrumb, type BreadcrumbItem } from "@/components/Breadcrumb";
import { Menu, X, Settings, Users, Search, Sparkles, Lightbulb, Network, Activity, GitBranch, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import { SearchModal } from "@/components/SearchModal";
import { AiChatPanel } from "@/components/AiChatPanel";
import { EditorPanel } from "@/components/EditorPanel";
import { NotificationBell } from "@/components/NotificationBell";
import { usePanelStore } from "@/lib/workspace-layout-store";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params.id as string;

  const pathname = usePathname();
  const { data: workspace, error, isLoading, mutate: revalidate } = useSWR(
    workspaceId ? `workspace-${workspaceId}` : null,
    () => workspaceApi.get(workspaceId)
  );

  const [showEdit, setShowEdit] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showAiChat, setShowAiChat] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Cmd+K / Ctrl+K to open search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowSearch(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Build breadcrumb items
  const breadcrumbs: BreadcrumbItem[] = [
    { label: "我的空间", href: "/workspaces" },
  ];
  const wsName = workspace?.name || "空间";
  const isCardDetail = pathname.includes("/card/");
  if (isCardDetail) {
    breadcrumbs.push({ label: wsName, href: `/workspaces/${workspaceId}` });
    breadcrumbs.push({ label: "卡片详情" });
  } else if (pathname.endsWith("/insights")) {
    breadcrumbs.push({ label: wsName, href: `/workspaces/${workspaceId}` });
    breadcrumbs.push({ label: "洞察" });
  } else if (pathname.endsWith("/network")) {
    breadcrumbs.push({ label: wsName, href: `/workspaces/${workspaceId}` });
    breadcrumbs.push({ label: "关联网络" });
  } else if (pathname.endsWith("/knowledge-graph")) {
    breadcrumbs.push({ label: wsName, href: `/workspaces/${workspaceId}` });
    breadcrumbs.push({ label: "知识图谱" });
  } else {
    breadcrumbs.push({ label: wsName });
  }

  // AI chat only available on card list and card detail pages
  const wsBase = `/workspaces/${workspaceId}`;
  const canShowAiChat = pathname === wsBase || pathname.startsWith(`${wsBase}/card/`);

  // Close AI chat when navigating to a page that doesn't support it
  useEffect(() => {
    if (!canShowAiChat) setShowAiChat(false);
  }, [canShowAiChat]);

  const navItems = [
    ...(canShowAiChat
      ? [{ label: "AI 问答", href: null, highlight: true, icon: <Sparkles size={14} />, toggle: "aiChat" as const }]
      : []),
    { label: "洞察", href: `/workspaces/${workspaceId}/insights`, highlight: false, icon: <Lightbulb size={14} /> },
    { label: "网络", href: `/workspaces/${workspaceId}/network`, highlight: false, icon: <Network size={14} /> },
    { label: "图谱", href: `/workspaces/${workspaceId}/knowledge-graph`, highlight: false, icon: <GitBranch size={14} /> },
    { label: "动态", href: `/workspaces/${workspaceId}/activities`, highlight: false, icon: <Activity size={14} /> },
  ];

  const navigate = (href: string) => {
    router.push(href);
    setMenuOpen(false);
  };

  return (
    <div className="flex h-screen flex-col bg-bg">
      {/* Top nav */}
      <nav className="sticky top-0 z-10 border-b border-border bg-surface/80 backdrop-blur-sm">
        <div className="flex items-center justify-between px-4 py-3">
          {/* Left: breadcrumb */}
          <div className="flex items-center gap-3">
            <span className="text-gray-600">
              <WorkspaceIcon icon={workspace?.icon || "lightbulb"} size={22} />
            </span>
            <Breadcrumb items={breadcrumbs} />
          </div>

          {/* Right: desktop nav (hidden on mobile) */}
          <div className="hidden items-center gap-2 md:flex">
            <button
              onClick={() => setShowSearch(true)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-text-secondary transition hover:border-primary/30 hover:bg-gray-50"
            >
              <Search size={14} />
              <span className="hidden lg:inline">⌘K</span>
            </button>
            <NotificationBell workspaceId={workspaceId} />
            {workspace?.member_role === "owner" && (
              <button
                onClick={() => setShowEdit(true)}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-text-secondary hover:bg-gray-100"
              >
                <Settings size={14} /> 编辑
              </button>
            )}
            <button
              onClick={() => setShowMembers(true)}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-text-secondary hover:bg-gray-100"
            >
              <Users size={14} /> 成员
            </button>
            {navItems.map((item) => (
              <button
                key={item.label}
                onClick={() => {
                  if ("toggle" in item && item.toggle === "aiChat") {
                    setShowAiChat((v) => !v);
                  } else {
                    navigate(item.href!);
                  }
                }}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm ${
                  "toggle" in item && item.toggle === "aiChat" && showAiChat
                    ? "bg-primary text-white"
                    : item.highlight
                      ? "bg-primary/10 font-medium text-primary-dark"
                      : "text-text-secondary hover:bg-gray-100"
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>

          {/* Right: mobile nav */}
          <div className="flex items-center gap-1 md:hidden">
            <NotificationBell workspaceId={workspaceId} />
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:bg-gray-100"
            >
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {/* Mobile dropdown menu */}
        {menuOpen && (
          <div className="border-t border-border bg-surface px-4 py-2 md:hidden">
            <div className="flex gap-2 py-2">
              <button
                onClick={() => { setShowSearch(true); setMenuOpen(false); }}
                className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:bg-gray-100"
              >
                <Search size={14} /> 搜索
              </button>
              {workspace?.member_role === "owner" && (
                <button
                  onClick={() => { setShowEdit(true); setMenuOpen(false); }}
                  className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:bg-gray-100"
                >
                  <Settings size={14} /> 编辑
                </button>
              )}
              <button
                onClick={() => { setShowMembers(true); setMenuOpen(false); }}
                className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:bg-gray-100"
              >
                <Users size={14} /> 成员
              </button>
            </div>
            {navItems.map((item) => (
              <button
                key={item.label}
                onClick={() => {
                  if ("toggle" in item && item.toggle === "aiChat") {
                    setShowAiChat((v) => !v);
                    setMenuOpen(false);
                  } else {
                    navigate(item.href!);
                  }
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                  "toggle" in item && item.toggle === "aiChat" && showAiChat
                    ? "bg-primary text-white"
                    : item.highlight
                      ? "bg-primary/10 font-medium text-primary-dark"
                      : "text-text-secondary hover:bg-gray-100"
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        )}
      </nav>

      {/* Error state for workspace data */}
      {error && !isLoading && (
        <ErrorState message={error.message} onRetry={revalidate} />
      )}

      <div className="flex flex-1 overflow-hidden">
        <PanelLayout
          workspaceId={workspaceId}
          canShowAiChat={canShowAiChat}
          showAiChat={showAiChat}
          onToggleAiChat={() => setShowAiChat((v) => !v)}
        >
          {children}
        </PanelLayout>
      </div>

      {/* Edit workspace modal */}
      {showEdit && workspace && (
        <EditWorkspaceModal
          workspace={workspace}
          onClose={() => setShowEdit(false)}
          workspaceId={workspaceId}
        />
      )}

      {/* Members panel */}
      {showMembers && (
        <MembersPanel
          workspaceId={workspaceId}
          onClose={() => setShowMembers(false)}
          myRole={workspace?.member_role || null}
        />
      )}

      {/* Search modal */}
      {showSearch && (
        <SearchModal
          workspaceId={workspaceId}
          onClose={() => setShowSearch(false)}
        />
      )}
    </div>
  );
}

function EditWorkspaceModal({
  workspace,
  onClose,
  workspaceId,
}: {
  workspace: Workspace;
  onClose: () => void;
  workspaceId: string;
}) {
  const [name, setName] = useState(workspace.name);
  const [icon, setIcon] = useState(workspace.icon);
  const [color, setColor] = useState(workspace.color);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await workspaceApi.update(workspaceId, { name: name.trim(), icon, color });
      mutate(`workspace-${workspaceId}`);
      onClose();
    } catch (e: any) {
      toast("保存失败: " + e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="编辑空间"
      onClose={onClose}
      onConfirm={handleSave}
      confirmText="保存"
      confirmDisabled={!name.trim()}
      loading={saving}
      size="sm"
    >
      <FormField label="名称">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary"
        />
      </FormField>
      <FormField label="图标">
        <IconPicker value={icon} onChange={setIcon} />
      </FormField>
      <FormField label="配色">
        <ColorPicker value={color} onChange={setColor} colors={SPACE_COLORS} />
      </FormField>
    </Modal>
  );
}

const ROLE_LABELS: Record<string, string> = {
  owner: "创建者",
  admin: "管理员",
  editor: "编辑者",
  viewer: "浏览者",
  pending: "待审批",
};

const ROLE_COLORS: Record<string, string> = {
  owner: "bg-primary/10 text-primary-dark",
  admin: "bg-blue-100 text-blue-700",
  editor: "bg-gray-200 text-text-secondary",
  viewer: "bg-gray-100 text-gray-500",
  pending: "bg-amber-100 text-amber-700",
};

function MembersPanel({
  workspaceId,
  onClose,
  myRole,
}: {
  workspaceId: string;
  onClose: () => void;
  myRole: string | null;
}) {
  const { data: currentUser } = useSWR("me", () => authApi.me());
  const { data: members, isLoading, mutate: revalidateMembers } = useSWR(
    workspaceId ? `members-${workspaceId}` : null,
    () => workspaceApi.members(workspaceId)
  );

  const [removeTarget, setRemoveTarget] = useState<{ userId: string; nickname: string } | null>(null);
  const canManage = myRole === "owner" || myRole === "admin";

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      await workspaceApi.updateMemberRole(workspaceId, userId, newRole);
      revalidateMembers();
    } catch (e: any) {
      toast("修改失败: " + e.message, "error");
    }
  };

  const handleRemove = (userId: string, nickname: string) => {
    setRemoveTarget({ userId, nickname });
  };

  const confirmRemove = async () => {
    if (!removeTarget) return;
    try {
      await workspaceApi.removeMember(workspaceId, removeTarget.userId);
      revalidateMembers();
    } catch (e: any) {
      toast("移除失败: " + e.message, "error");
    }
    setRemoveTarget(null);
  };

  return (
    <Modal title="空间成员" onClose={onClose} size="sm">
      {isLoading && <p className="py-4 text-center text-sm text-text-secondary">加载中...</p>}

      {members && members.length > 0 && (
        <div className="flex flex-col gap-2">
          {members.map((m) => (
            <div
              key={m.user_id}
              className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary-dark">
                  {m.nickname?.charAt(0) || "?"}
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text">
                      {m.nickname || "未知用户"}
                    </span>
                    {currentUser && m.user_id === currentUser.id && (
                      <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-white">
                        我
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${ROLE_COLORS[m.role] || ROLE_COLORS.editor}`}
                >
                  {ROLE_LABELS[m.role] || m.role}
                </span>
                {/* Role selector: owner can change anyone (except owner), admin can change editor/viewer/pending */}
                {canManage && m.role !== "owner" && !(myRole === "admin" && m.role === "admin") && (
                  <select
                    value={m.role}
                    onChange={(e) => handleRoleChange(m.user_id, e.target.value)}
                    className="rounded-lg border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] text-text-secondary outline-none focus:border-primary"
                  >
                    {myRole === "owner" && <option value="admin">管理员</option>}
                    <option value="editor">编辑者</option>
                    <option value="viewer">浏览者</option>
                  </select>
                )}
                {canManage && m.role !== "owner" && !(myRole === "admin" && m.role === "admin") && (
                  <button
                    onClick={() => handleRemove(m.user_id, m.nickname)}
                    className="rounded-full px-2 py-0.5 text-[10px] text-red-400 hover:bg-red-50 hover:text-red-600"
                  >
                    移除
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {members && members.length === 0 && (
        <p className="text-sm text-text-secondary">暂无成员</p>
      )}

      {removeTarget && (
        <ConfirmModal
          title="移除成员"
          message={`确定移除成员「${removeTarget.nickname || "未知用户"}」？`}
          confirmText="移除"
          danger
          onConfirm={confirmRemove}
          onCancel={() => setRemoveTarget(null)}
        />
      )}
    </Modal>
  );
}

// --- Three-Panel Layout ---

function PanelLayout({
  workspaceId,
  canShowAiChat,
  showAiChat,
  onToggleAiChat,
  children,
}: {
  workspaceId: string;
  canShowAiChat: boolean;
  showAiChat: boolean;
  onToggleAiChat: () => void;
  children: React.ReactNode;
}) {
  const { leftCollapsed, rightCollapsed, toggleLeft, toggleRight } = usePanelStore();

  // Compute widths
  const leftW = leftCollapsed ? 25 : 50;
  const rightW = rightCollapsed ? 25 : 50;
  const showEditor = leftCollapsed || rightCollapsed;
  const editorW = showEditor ? 100 - leftW - rightW : 0;

  // If AI chat not available, left takes full width
  if (!canShowAiChat || !showAiChat) {
    return (
      <div className="flex h-full w-full">
        <div className="h-full overflow-y-auto" style={{ width: "100%", transition: "width 300ms cubic-bezier(0.4,0,0.2,1)" }}>
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full">
      {/* Left Panel - Card List */}
      <div
        className="relative h-full overflow-hidden border-r border-border"
        style={{ width: `${leftW}%`, transition: "width 300ms cubic-bezier(0.4,0,0.2,1)", willChange: "width" }}
      >
        <button
          onClick={toggleLeft}
          className="absolute right-2 top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-surface/80 text-text-secondary shadow-sm backdrop-blur-sm transition hover:bg-surface hover:text-foreground"
          title={leftCollapsed ? "展开卡片列表" : "收起卡片列表"}
        >
          {leftCollapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
        </button>
        <div className="h-full overflow-y-auto">{children}</div>
      </div>

      {/* Middle Panel - Editor */}
      {showEditor && (
        <div
          className="h-full overflow-hidden border-r border-border"
          style={{ width: `${editorW}%`, transition: "width 300ms cubic-bezier(0.4,0,0.2,1), opacity 200ms ease", willChange: "width" }}
        >
          <EditorPanel workspaceId={workspaceId} />
        </div>
      )}

      {/* Right Panel - AI Chat */}
      <div
        className="relative h-full overflow-hidden"
        style={{ width: `${rightW}%`, transition: "width 300ms cubic-bezier(0.4,0,0.2,1)", willChange: "width" }}
      >
        <button
          onClick={toggleRight}
          className="absolute left-2 top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-surface/80 text-text-secondary shadow-sm backdrop-blur-sm transition hover:bg-surface hover:text-foreground"
          title={rightCollapsed ? "展开AI对话" : "收起AI对话"}
        >
          {rightCollapsed ? <PanelRightOpen size={13} /> : <PanelRightClose size={13} />}
        </button>
        <AiChatPanel workspaceId={workspaceId} onClose={onToggleAiChat} />
      </div>
    </div>
  );
}
