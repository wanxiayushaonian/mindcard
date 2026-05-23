"use client";

import { useParams, useRouter } from "next/navigation";
import useSWR, { mutate } from "swr";
import { useState } from "react";
import { workspaceApi, authApi, type Workspace } from "@/lib/api";
import { toast } from "@/lib/toast";
import { Modal } from "@/components/Modal";
import { FormField } from "@/components/FormField";
import { IconPicker } from "@/components/IconPicker";
import { ColorPicker, SPACE_COLORS } from "@/components/ColorPicker";
import { ErrorState } from "@/components/ErrorState";
import { ConfirmModal } from "@/components/ConfirmModal";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params.id as string;

  const { data: workspace, error, isLoading, mutate: revalidate } = useSWR(
    workspaceId ? `workspace-${workspaceId}` : null,
    () => workspaceApi.get(workspaceId)
  );

  const [showEdit, setShowEdit] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const navItems = [
    { label: "搜索", href: `/workspaces/${workspaceId}/search`, highlight: false },
    { label: "AI 问答", href: `/rag?workspaceId=${workspaceId}`, highlight: true },
    { label: "洞察", href: `/workspaces/${workspaceId}/insights`, highlight: false },
    { label: "网络", href: `/workspaces/${workspaceId}/network`, highlight: false },
  ];

  const navigate = (href: string) => {
    router.push(href);
    setMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-bg">
      {/* Top nav */}
      <nav className="sticky top-0 z-10 border-b border-border bg-surface/80 backdrop-blur-sm">
        <div className="flex items-center justify-between px-4 py-3">
          {/* Left: back + workspace name */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push("/workspaces")}
              className="text-text-secondary hover:text-text"
            >
              &larr;
            </button>
            <span className="text-lg">
              {workspace?.icon} {workspace?.name}
            </span>
          </div>

          {/* Right: desktop nav (hidden on mobile) */}
          <div className="hidden items-center gap-2 md:flex">
            {workspace?.member_role === "owner" && (
              <button
                onClick={() => setShowEdit(true)}
                className="rounded-lg px-2 py-1 text-xs text-text-secondary hover:bg-gray-100"
              >
                编辑
              </button>
            )}
            <button
              onClick={() => setShowMembers(true)}
              className="rounded-lg px-2 py-1 text-xs text-text-secondary hover:bg-gray-100"
            >
              成员
            </button>
            {navItems.map((item) => (
              <button
                key={item.label}
                onClick={() => navigate(item.href)}
                className={`rounded-lg px-3 py-1.5 text-sm ${
                  item.highlight
                    ? "bg-primary/10 font-medium text-primary-dark"
                    : "text-text-secondary hover:bg-gray-100"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Right: hamburger (visible on mobile only) */}
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:bg-gray-100 md:hidden"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              {menuOpen ? (
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              ) : (
                <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
              )}
            </svg>
          </button>
        </div>

        {/* Mobile dropdown menu */}
        {menuOpen && (
          <div className="border-t border-border bg-surface px-4 py-2 md:hidden">
            <div className="flex gap-2 py-2">
              {workspace?.member_role === "owner" && (
                <button
                  onClick={() => { setShowEdit(true); setMenuOpen(false); }}
                  className="rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:bg-gray-100"
                >
                  编辑
                </button>
              )}
              <button
                onClick={() => { setShowMembers(true); setMenuOpen(false); }}
                className="rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:bg-gray-100"
              >
                成员
              </button>
            </div>
            {navItems.map((item) => (
              <button
                key={item.label}
                onClick={() => navigate(item.href)}
                className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${
                  item.highlight
                    ? "bg-primary/10 font-medium text-primary-dark"
                    : "text-text-secondary hover:bg-gray-100"
                }`}
              >
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

      {children}

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
          isOwner={workspace?.member_role === "owner"}
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
        <IconPicker value={icon} onChange={setIcon} icons={["💡", "🧠", "📚", "🎨", "🔬", "💼", "🌟", "🎯"]} />
      </FormField>
      <FormField label="配色">
        <ColorPicker value={color} onChange={setColor} colors={SPACE_COLORS} />
      </FormField>
    </Modal>
  );
}

function MembersPanel({
  workspaceId,
  onClose,
  isOwner,
}: {
  workspaceId: string;
  onClose: () => void;
  isOwner: boolean;
}) {
  const { data: currentUser } = useSWR("me", () => authApi.me());
  const { data: members, isLoading, mutate: revalidateMembers } = useSWR(
    workspaceId ? `members-${workspaceId}` : null,
    () => workspaceApi.members(workspaceId)
  );

  const [removeTarget, setRemoveTarget] = useState<{ userId: string; nickname: string } | null>(null);

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
                <span className="text-sm font-medium text-text">
                  {m.nickname || "未知用户"}
                </span>
                {currentUser && m.user_id === currentUser.id && (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-white">
                    我
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    m.role === "owner"
                      ? "bg-primary/10 text-primary-dark"
                      : "bg-gray-200 text-text-secondary"
                  }`}
                >
                  {m.role === "owner" ? "创建者" : "编辑者"}
                </span>
                {isOwner && m.role !== "owner" && (
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
