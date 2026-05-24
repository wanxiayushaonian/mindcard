"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { useRouter } from "next/navigation";
import { workspaceApi, type Workspace } from "@/lib/api";
import { toast } from "@/lib/toast";
import { Modal } from "@/components/Modal";
import { FormField } from "@/components/FormField";
import { IconPicker } from "@/components/IconPicker";
import { ColorPicker, SPACE_COLORS } from "@/components/ColorPicker";
import { LoadingState } from "@/components/LoadingState";
import { ErrorState } from "@/components/ErrorState";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Plus, Link, Share2, Trash2, LogOut, Settings } from "lucide-react";

export default function WorkspacesPage() {
  const router = useRouter();
  const { data: workspaces, isLoading, error, mutate: revalidate } = useSWR("workspaces", () => workspaceApi.list());
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("💡");
  const [color, setColor] = useState("#94B4C8");
  const [creating, setCreating] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [showShare, setShowShare] = useState(false);
  const [shareCode, setShareCode] = useState("");
  const [shareWsName, setShareWsName] = useState("");
  const [shareLoading, setShareLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [leaveTarget, setLeaveTarget] = useState<{ id: string; name: string } | null>(null);

  const handleCreate = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const localId = "ws_" + Date.now();
      await workspaceApi.create({ local_id: localId, name: name.trim(), icon, color });
      setName("");
      setShowCreate(false);
      mutate("workspaces");
    } catch (e: any) {
      toast("创建失败: " + e.message, "error");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = (e: React.MouseEvent, wsId: string) => {
    e.stopPropagation();
    setDeleteTarget(wsId);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await workspaceApi.delete(deleteTarget);
      mutate("workspaces");
    } catch (e: any) {
      toast("删除失败: " + e.message, "error");
    }
    setDeleteTarget(null);
  };

  const handleLeave = (e: React.MouseEvent, wsId: string, wsName: string) => {
    e.stopPropagation();
    setLeaveTarget({ id: wsId, name: wsName });
  };

  const confirmLeave = async () => {
    if (!leaveTarget) return;
    try {
      await workspaceApi.leave(leaveTarget.id);
      mutate("workspaces");
      toast("已退出空间", "success");
    } catch (e: any) {
      toast("退出失败: " + e.message, "error");
    }
    setLeaveTarget(null);
  };

  const handleJoin = async () => {
    if (joinCode.trim().length !== 6 || joining) return;
    setJoining(true);
    setJoinError("");
    try {
      const res = await workspaceApi.joinByCode(joinCode.trim().toUpperCase());
      setShowJoin(false);
      setJoinCode("");
      mutate("workspaces");
      if (res.message) toast(res.message, "success");
    } catch (e: any) {
      setJoinError(e.message || "邀请码无效");
    } finally {
      setJoining(false);
    }
  };

  const handleShare = async (e: React.MouseEvent, wsId: string, wsName: string) => {
    e.stopPropagation();
    setShareLoading(true);
    setShowShare(true);
    setShareWsName(wsName);
    setShareCode("");
    try {
      const res = await workspaceApi.generateInviteCode(wsId);
      setShareCode(res.invite_code);
    } catch (e: any) {
      setShareCode("error: " + e.message);
    } finally {
      setShareLoading(false);
    }
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(shareCode).then(() => toast("已复制", "success"));
  };

  if (isLoading) return <LoadingState fullScreen />;
  if (error) return <ErrorState message={error.message} onRetry={revalidate} />;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">我的灵感空间</h1>
          <p className="mt-1 text-sm text-text-secondary">选择一个空间开始探索</p>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            onClick={() => router.push("/profile")}
            className="rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:bg-gray-100"
          >
            个人中心
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {workspaces?.map((ws) => (
          <div
            key={ws.id}
            onClick={() => router.push(`/workspaces/${ws.id}`)}
            className="group relative cursor-pointer rounded-card border border-border bg-surface p-5 shadow-sm transition hover:shadow-md"
            style={{ borderTop: `4px solid ${ws.color}` }}
          >
            {ws.member_role === "owner" ? (
              <div className="absolute right-2 top-2 hidden gap-1 group-hover:flex">
                <button
                  onClick={(e) => handleShare(e, ws.id, ws.name)}
                  className="flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-400 hover:bg-blue-100 hover:text-blue-600"
                >
                  <Share2 size={12} /> 分享
                </button>
                <button
                  onClick={(e) => handleDelete(e, ws.id)}
                  className="flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-400 hover:bg-red-100 hover:text-red-600"
                >
                  <Trash2 size={12} /> 删除
                </button>
              </div>
            ) : (
              <div className="absolute right-2 top-2 hidden group-hover:flex">
                <button
                  onClick={(e) => handleLeave(e, ws.id, ws.name)}
                  className="flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-xs text-orange-400 hover:bg-orange-100 hover:text-orange-600"
                >
                  <LogOut size={12} /> 退出
                </button>
              </div>
            )}
            <div className="mb-2 text-3xl">{ws.icon}</div>
            <h3 className="font-semibold text-text">{ws.name}</h3>
            <p className="mt-1 text-xs text-text-secondary">
              {new Date(ws.created_at).toLocaleDateString("zh-CN")}
            </p>
          </div>
        ))}

        <div
          onClick={() => setShowCreate(true)}
          className="flex min-h-[160px] cursor-pointer flex-col items-center justify-center rounded-card border-2 border-dashed border-gray-300 bg-transparent transition hover:border-primary"
        >
          <Plus size={32} className="mb-2 text-gray-400" />
          <span className="text-sm text-text-secondary">新建空间</span>
        </div>

        <div
          onClick={() => { setShowJoin(true); setJoinCode(""); setJoinError(""); }}
          className="flex min-h-[160px] cursor-pointer flex-col items-center justify-center rounded-card border-2 border-dashed border-gray-300 bg-transparent transition hover:border-primary"
        >
          <Link size={32} className="mb-2 text-gray-400" />
          <span className="text-sm text-text-secondary">加入空间</span>
        </div>
      </div>

      {/* Create workspace modal */}
      {showCreate && (
        <Modal
          title="新建灵感空间"
          onClose={() => setShowCreate(false)}
          onConfirm={handleCreate}
          confirmText="创建"
          confirmDisabled={!name.trim()}
          loading={creating}
        >
          <FormField label="空间名称">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="输入空间名称..."
              autoFocus
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
      )}

      {/* Join workspace modal */}
      {showJoin && (
        <Modal
          title="加入空间"
          onClose={() => setShowJoin(false)}
          onConfirm={handleJoin}
          confirmText="加入"
          confirmDisabled={joinCode.trim().length !== 6}
          loading={joining}
        >
          <FormField label="邀请码">
            <input
              value={joinCode}
              onChange={(e) => { setJoinCode(e.target.value.toUpperCase()); setJoinError(""); }}
              placeholder="输入6位邀请码"
              maxLength={6}
              autoFocus
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-center text-lg tracking-[0.3em] uppercase outline-none focus:border-primary"
            />
            {joinError && <p className="mt-2 text-sm text-red-500">{joinError}</p>}
          </FormField>
        </Modal>
      )}

      {/* Share invite code modal */}
      {showShare && (
        <Modal
          title={`邀请加入「${shareWsName}」`}
          onClose={() => setShowShare(false)}
          onConfirm={handleCopyCode}
          confirmText="复制邀请码"
        >
          {shareLoading ? (
            <p className="py-4 text-center text-text-secondary">生成中...</p>
          ) : (
            <>
              <div className="mb-4 rounded-xl bg-gray-50 py-4 text-center">
                <span className="text-3xl font-bold tracking-[0.3em] text-primary">{shareCode}</span>
              </div>
              <p className="mb-4 text-xs text-text-secondary">将此邀请码分享给好友，对方可在「加入空间」中输入加入。</p>
            </>
          )}
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmModal
          title="删除空间"
          message="确定删除该空间？空间内所有卡片将被删除。"
          confirmText="删除"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {leaveTarget && (
        <ConfirmModal
          title="退出空间"
          message={`确定退出「${leaveTarget.name}」？退出后将无法访问该空间的卡片。`}
          confirmText="退出"
          danger
          onConfirm={confirmLeave}
          onCancel={() => setLeaveTarget(null)}
        />
      )}
    </div>
  );
}
