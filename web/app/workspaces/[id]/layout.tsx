"use client";

import { useParams, useRouter } from "next/navigation";
import useSWR, { mutate } from "swr";
import { useState } from "react";
import { workspaceApi, type Workspace } from "@/lib/api";

const COLORS = ["#94B4C8", "#B8D4E3", "#E8A87C", "#D4A5A5", "#7EC8B0", "#B8A9C9", "#F0C987", "#87CEEB"];
const ICONS = ["💡", "🧠", "📚", "🎨", "🔬", "💼", "🌟", "🎯"];

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params.id as string;

  const { data: workspace } = useSWR(
    workspaceId ? `workspace-${workspaceId}` : null,
    () => workspaceApi.get(workspaceId)
  );

  const [showEdit, setShowEdit] = useState(false);
  const [showMembers, setShowMembers] = useState(false);

  return (
    <div className="min-h-screen bg-bg">
      {/* Top nav */}
      <nav className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-surface/80 px-4 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/workspaces")}
            className="text-text-secondary hover:text-text"
          >
            &larr;
          </button>
          <span className="text-lg">
            {workspace?.icon} {workspace?.name}
          </span>
          <button
            onClick={() => setShowEdit(true)}
            className="rounded-lg px-2 py-1 text-xs text-text-secondary hover:bg-gray-100"
          >
            编辑
          </button>
          <button
            onClick={() => setShowMembers(true)}
            className="rounded-lg px-2 py-1 text-xs text-text-secondary hover:bg-gray-100"
          >
            成员
          </button>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(`/workspaces/${workspaceId}/search`)}
            className="rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:bg-gray-100"
          >
            搜索
          </button>
          <button
            onClick={() => router.push(`/rag?workspaceId=${workspaceId}`)}
            className="rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary-dark"
          >
            AI 问答
          </button>
          <button
            onClick={() => router.push(`/workspaces/${workspaceId}/insights`)}
            className="rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:bg-gray-100"
          >
            洞察
          </button>
        </div>
      </nav>

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
      alert("保存失败: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-bold text-text">编辑空间</h2>

        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-text-secondary">名称</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary"
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-text-secondary">图标</span>
          <div className="flex flex-wrap gap-2">
            {ICONS.map((i) => (
              <button
                key={i}
                onClick={() => setIcon(i)}
                className={`flex h-10 w-10 items-center justify-center rounded-xl text-xl ${
                  icon === i ? "ring-2 ring-primary ring-offset-2" : "bg-gray-50"
                }`}
              >
                {i}
              </button>
            ))}
          </div>
        </label>

        <label className="mb-5 block">
          <span className="mb-1 block text-sm text-text-secondary">配色</span>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`h-8 w-8 rounded-full ${
                  color === c ? "ring-2 ring-primary ring-offset-2" : ""
                }`}
                style={{ background: c }}
              />
            ))}
          </div>
        </label>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm text-text-secondary hover:bg-gray-100"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="rounded-xl bg-primary px-6 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MembersPanel({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const { data: members, isLoading } = useSWR(
    workspaceId ? `members-${workspaceId}` : null,
    () => workspaceApi.members(workspaceId)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-bold text-text">空间成员</h2>

        {isLoading && <p className="text-sm text-text-secondary">加载中...</p>}

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
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    m.role === "owner"
                      ? "bg-primary/10 text-primary-dark"
                      : "bg-gray-200 text-text-secondary"
                  }`}
                >
                  {m.role === "owner" ? "创建者" : "编辑者"}
                </span>
              </div>
            ))}
          </div>
        )}

        {members && members.length === 0 && (
          <p className="text-sm text-text-secondary">暂无成员</p>
        )}

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm text-text-secondary hover:bg-gray-100"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
