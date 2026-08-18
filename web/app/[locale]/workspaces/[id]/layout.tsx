"use client";

import { useParams, useRouter, usePathname } from "next/navigation";
import useSWR, { mutate } from "swr";
import { useState, useEffect, Component, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { workspaceApi, authApi, type Workspace } from "@/lib/api";
import { toast } from "@/lib/toast";
import { Modal } from "@/components/Modal";
import { FormField } from "@/components/FormField";
import { IconPicker, WorkspaceIcon, SPACE_ICON_KEYS } from "@/components/IconPicker";
import { ColorPicker, SPACE_COLORS } from "@/components/ColorPicker";
import { ErrorState } from "@/components/ErrorState";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Breadcrumb, type BreadcrumbItem } from "@/components/Breadcrumb";
import { Menu, X, Settings, Users, Search, Sparkles, Lightbulb, Network, Activity, GitBranch, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, FileText } from "lucide-react";
import { SearchModal } from "@/components/SearchModal";
import { AiChatPanel } from "@/components/AiChatPanel";
import { EditorPanel } from "@/components/EditorPanel";
import { NotificationBell } from "@/components/NotificationBell";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { usePanelStore } from "@/lib/workspace-layout-store";
import { translateBackendError } from "@/lib/backend-errors";
import { useAuthStore } from "@/lib/store";


class ChatErrorBoundary extends Component<{ children: ReactNode; errorLabel: string; resetLabel: string }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
          <p className="text-sm text-text-secondary">{this.props.errorLabel}</p>
          <button
            onClick={() => {
              Object.keys(localStorage)
                .filter((k) => k.startsWith("mindcard-active-chat-"))
                .forEach((k) => localStorage.removeItem(k));
              this.setState({ hasError: false });
            }}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-dark"
          >
            {this.props.resetLabel}
          </button>
        </div>
      );
    }
    return <div className="h-full">{this.props.children}</div>;
  }
}

class EditorErrorBoundary extends Component<{ children: ReactNode; errorLabel: string; retryLabel: string }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
          <p className="text-sm text-text-secondary">{this.props.errorLabel}</p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-dark"
          >
            {this.props.retryLabel}
          </button>
        </div>
      );
    }
    return <div className="h-full">{this.props.children}</div>;
  }
}

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params.id as string;
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [mounted, setMounted] = useState(false);

  const t = useTranslations("workspace");
  const tCommon = useTranslations("common");
  const tError = useTranslations("error");
  const tBackend = useTranslations("backendError");

  const pathname = usePathname();
  const { data: workspace, error, isLoading, mutate: revalidate } = useSWR(
    workspaceId ? `workspace-${workspaceId}` : null,
    () => workspaceApi.get(workspaceId)
  );

  const [showEdit, setShowEdit] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const showAiChat = usePanelStore((s) => s.showAiChat);
  const setShowAiChat = usePanelStore((s) => s.setShowAiChat);

  useEffect(() => { setMounted(true); }, []);

  // Hydrate panel state from localStorage after mount (avoids SSR hydration mismatch)
  useEffect(() => {
    usePanelStore.getState().hydrate();
  }, []);

  // Auth guard: redirect unauthenticated users to login
  useEffect(() => {
    if (mounted && !isAuthenticated) {
      router.replace("/login");
    }
  }, [mounted, isAuthenticated, router]);

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

  // SSR + initial client render: always render the same shell to avoid hydration mismatch
  if (!mounted) {
    return <div className="flex h-screen bg-bg" />;
  }

  if (!isAuthenticated) {
    return <div className="flex h-screen items-center justify-center text-text-secondary"><p>Redirecting…</p></div>;
  }

  // Build breadcrumb items
  const breadcrumbs: BreadcrumbItem[] = [
    { label: t("mySpacesBreadcrumb"), href: "/workspaces" },
  ];
  const wsName = workspace?.name || t("defaultSpaceName");
  const isCardDetail = pathname.includes("/card/");
  if (isCardDetail) {
    breadcrumbs.push({ label: wsName, href: `/workspaces/${workspaceId}` });
    breadcrumbs.push({ label: t("cardDetail") });
  } else if (pathname.endsWith("/insights")) {
    breadcrumbs.push({ label: wsName, href: `/workspaces/${workspaceId}` });
    breadcrumbs.push({ label: t("insights") });
  } else if (pathname.endsWith("/network")) {
    breadcrumbs.push({ label: wsName, href: `/workspaces/${workspaceId}` });
    breadcrumbs.push({ label: t("relatedNetwork") });
  } else if (pathname.endsWith("/knowledge-graph")) {
    breadcrumbs.push({ label: wsName, href: `/workspaces/${workspaceId}` });
    breadcrumbs.push({ label: t("knowledgeGraph") });
  } else if (pathname.endsWith("/activities")) {
    breadcrumbs.push({ label: wsName, href: `/workspaces/${workspaceId}` });
    breadcrumbs.push({ label: t("activities") });
  } else {
    breadcrumbs.push({ label: wsName });
  }

  // AI chat only available on card list and card detail pages
  const wsBase = `/workspaces/${workspaceId}`;
  const canShowAiChat = pathname === wsBase || pathname.startsWith(`${wsBase}/card/`);

  const navItems = [
    { label: t("insights"), href: `/workspaces/${workspaceId}/insights`, highlight: false, icon: <Lightbulb size={14} /> },
    { label: t("synthesis"), href: `/workspaces/${workspaceId}/synthesis`, highlight: false, icon: <Sparkles size={14} /> },
    { label: t("relatedNetwork"), href: `/workspaces/${workspaceId}/network`, highlight: false, icon: <Network size={14} /> },
    { label: t("knowledgeGraph"), href: `/workspaces/${workspaceId}/knowledge-graph`, highlight: false, icon: <GitBranch size={14} /> },
    { label: t("activities"), href: `/workspaces/${workspaceId}/activities`, highlight: false, icon: <Activity size={14} /> },
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
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-text-secondary transition hover:border-primary/30 hover:bg-muted/40"
            >
              <Search size={14} />
              <span className="hidden lg:inline">⌘K</span>
            </button>
            <LanguageSwitcher />
            <NotificationBell workspaceId={workspaceId} />
            {workspace?.member_role === "owner" && (
              <button
                onClick={() => setShowEdit(true)}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-text-secondary hover:bg-muted"
              >
                <Settings size={14} /> {tCommon("edit")}
              </button>
            )}
            <button
              onClick={() => setShowMembers(true)}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-text-secondary hover:bg-muted"
            >
              <Users size={14} /> {tCommon("member")}
            </button>
            {navItems.map((item) => (
              <button
                key={item.label}
                onClick={() => navigate(item.href!)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:bg-muted"
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>

          {/* Right: mobile nav */}
          <div className="flex items-center gap-1 md:hidden">
            <LanguageSwitcher />
            <NotificationBell workspaceId={workspaceId} />
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:bg-muted"
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
                className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:bg-muted"
              >
                <Search size={14} /> {tCommon("search")}
              </button>
              {workspace?.member_role === "owner" && (
                <button
                  onClick={() => { setShowEdit(true); setMenuOpen(false); }}
                  className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:bg-muted"
                >
                  <Settings size={14} /> {tCommon("edit")}
                </button>
              )}
              <button
                onClick={() => { setShowMembers(true); setMenuOpen(false); }}
                className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:bg-muted"
              >
                <Users size={14} /> {tCommon("member")}
              </button>
            </div>
            {navItems.map((item) => (
              <button
                key={item.label}
                onClick={() => navigate(item.href!)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-text-secondary hover:bg-muted"
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
          onToggleAiChat={() => setShowAiChat(!showAiChat)}
          errorLabels={{
            chatError: tError("chatPanelError"),
            resetChat: tError("resetChat"),
            editorError: tError("editorError"),
            resetEditor: tError("resetEditor"),
          }}
          panelLabels={{
            openAiChat: t("openAiChat"),
            expandCardList: t("expandCardList"),
            collapseCardList: t("collapseCardList"),
            expandAiChat: t("expandAiChat"),
            collapseAiChat: t("collapseAiChat"),
          }}
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

  const t = useTranslations("workspace");
  const tCommon = useTranslations("common");
  const tBackend = useTranslations("backendError");

  const handleSave = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await workspaceApi.update(workspaceId, { name: name.trim(), icon, color });
      mutate(`workspace-${workspaceId}`);
      onClose();
    } catch (e: any) {
      toast(t("editFailed", { error: translateBackendError(e.message, tBackend) }), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={t("editSpace")}
      onClose={onClose}
      onConfirm={handleSave}
      confirmText={tCommon("save")}
      confirmDisabled={!name.trim()}
      loading={saving}
      size="sm"
    >
      <FormField label={t("name")}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-text outline-none focus:border-primary"
        />
      </FormField>
      <FormField label={t("icon")}>
        <IconPicker value={icon} onChange={setIcon} />
      </FormField>
      <FormField label={t("color")}>
        <ColorPicker value={color} onChange={setColor} colors={SPACE_COLORS} />
      </FormField>
    </Modal>
  );
}

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

  const t = useTranslations("workspace");
  const tCommon = useTranslations("common");
  const tRole = useTranslations("role");
  const tBackend = useTranslations("backendError");

  const [removeTarget, setRemoveTarget] = useState<{ userId: string; nickname: string } | null>(null);
  const canManage = myRole === "owner" || myRole === "admin";

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      await workspaceApi.updateMemberRole(workspaceId, userId, newRole);
      revalidateMembers();
    } catch (e: any) {
      toast(t("editFailed", { error: translateBackendError(e.message, tBackend) }), "error");
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
      toast(t("removeFailed", { error: translateBackendError(e.message, tBackend) }), "error");
    }
    setRemoveTarget(null);
  };

  return (
    <Modal title={t("spaceMembers")} onClose={onClose} size="sm">
      {isLoading && <p className="py-4 text-center text-sm text-text-secondary">{tCommon("loading")}</p>}

      {members && members.length > 0 && (
        <div className="flex flex-col gap-2">
          {members.map((m) => (
            <div
              key={m.user_id}
              className="flex items-center justify-between rounded-xl bg-muted/40 px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary-dark">
                  {m.nickname?.charAt(0) || "?"}
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text">
                      {m.nickname || tCommon("unknownUser")}
                    </span>
                    {currentUser && m.user_id === currentUser.id && (
                      <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-white">
                        {tCommon("me")}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    m.role === "owner"
                      ? "bg-primary/10 text-primary-dark"
                      : m.role === "admin"
                        ? "bg-blue-100 text-blue-700"
                        : m.role === "editor"
                          ? "bg-gray-200 text-text-secondary"
                          : m.role === "viewer"
                            ? "bg-gray-100 text-gray-500"
                            : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {tRole(m.role as "owner" | "admin" | "editor" | "viewer" | "pending")}
                </span>
                {/* Role selector: owner can change anyone (except owner), admin can change editor/viewer/pending */}
                {canManage && m.role !== "owner" && !(myRole === "admin" && m.role === "admin") && (
                  <select
                    value={m.role}
                    onChange={(e) => handleRoleChange(m.user_id, e.target.value)}
                    className="rounded-lg border border-border bg-surface px-1.5 py-0.5 text-[11px] text-text-secondary outline-none focus:border-primary"
                  >
                    {myRole === "owner" && <option value="admin">{tRole("admin")}</option>}
                    <option value="editor">{tRole("editor")}</option>
                    <option value="viewer">{tRole("viewer")}</option>
                  </select>
                )}
                {canManage && m.role !== "owner" && !(myRole === "admin" && m.role === "admin") && (
                  <button
                    onClick={() => handleRemove(m.user_id, m.nickname)}
                    className="rounded-full px-2 py-0.5 text-[10px] text-red-400 hover:bg-red-50 hover:text-red-600"
                  >
                    {t("removeMember")}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {members && members.length === 0 && (
        <p className="text-sm text-text-secondary">{tCommon("noMembers")}</p>
      )}

      {removeTarget && (
        <ConfirmModal
          title={t("removeMember")}
          message={t("removeMemberConfirm", { name: removeTarget.nickname || tCommon("unknownUser") })}
          confirmText={tCommon("remove")}
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
  errorLabels,
  panelLabels,
  children,
}: {
  workspaceId: string;
  canShowAiChat: boolean;
  showAiChat: boolean;
  onToggleAiChat: () => void;
  errorLabels: {
    chatError: string;
    resetChat: string;
    editorError: string;
    resetEditor: string;
  };
  panelLabels: {
    openAiChat: string;
    expandCardList: string;
    collapseCardList: string;
    expandAiChat: string;
    collapseAiChat: string;
  };
  children: React.ReactNode;
}) {
  const { leftCollapsed, rightCollapsed, toggleLeft, toggleRight } = usePanelStore();

  // Editor only shown on pages that support AI chat.
  // leftW/rightW/editorW always sum to 100; the editor panel stays mounted at
  // width 0 when both side panels are expanded so its width transition runs
  // smoothly (a conditional mount would make it "pop" instead of animating).
  const leftW = leftCollapsed ? 15 : 50;
  const rightW = rightCollapsed ? 15 : 50;
  const editorW = 100 - leftW - rightW;

  // Fallback: AI chat not available -> full width, no editor
  if (!canShowAiChat) {
    return (
      <div className="flex h-full w-full">
        <div className="h-full w-full overflow-hidden">{children}</div>
      </div>
    );
  }

  // AI chat hidden by user -> show card list with reopen button
  if (!showAiChat) {
    return (
      <div className="flex h-full w-full">
        <div className="relative h-full overflow-y-auto" style={{ width: "100%", transition: "width 300ms cubic-bezier(0.4,0,0.2,1)" }}>
          {children}
          {canShowAiChat && (
            <button
              onClick={onToggleAiChat}
              className="absolute right-2 top-1/2 z-20 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-text-secondary transition hover:bg-muted hover:text-foreground"
              title={panelLabels.openAiChat}
            >
              <PanelRightOpen size={16} />
            </button>
          )}
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
          className="absolute right-2 top-1/2 z-20 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-text-secondary transition hover:bg-gray-100 hover:text-foreground"
          title={leftCollapsed ? panelLabels.expandCardList : panelLabels.collapseCardList}
        >
          {leftCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={14} />}
        </button>
        <div className="h-full overflow-x-hidden overflow-y-auto">{children}</div>
      </div>

      {/* Middle Panel - Editor. Always mounted: at 0-width (both side panels
          expanded) it is invisible, but the width transition below animates it
          smoothly in/out as the side panels collapse/expand. The border-r is
          dropped at 0 width to avoid a stray 1px divider between the panels. */}
      <div
        className={`h-full overflow-hidden ${editorW > 0 ? "border-r border-border" : ""}`}
        style={{ width: `${editorW}%`, transition: "width 300ms cubic-bezier(0.4,0,0.2,1)", willChange: "width" }}
      >
        <EditorErrorBoundary errorLabel={errorLabels.editorError} retryLabel={errorLabels.resetEditor}>
          <EditorPanel workspaceId={workspaceId} />
        </EditorErrorBoundary>
      </div>

      {/* Right Panel - AI Chat */}
      <div
        className="relative h-full overflow-hidden"
        style={{ width: `${rightW}%`, transition: "width 300ms cubic-bezier(0.4,0,0.2,1)", willChange: "width" }}
      >
        <button
          onClick={toggleRight}
          className="absolute left-2 top-1/2 z-30 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-text-secondary transition hover:bg-muted hover:text-foreground"
          title={rightCollapsed ? panelLabels.expandAiChat : panelLabels.collapseAiChat}
        >
          {rightCollapsed ? <PanelRightOpen size={15} /> : <PanelRightClose size={14} />}
        </button>
        <ChatErrorBoundary errorLabel={errorLabels.chatError} resetLabel={errorLabels.resetChat}>
          <AiChatPanel workspaceId={workspaceId} onClose={onToggleAiChat} />
        </ChatErrorBoundary>
      </div>
    </div>
  );
}
