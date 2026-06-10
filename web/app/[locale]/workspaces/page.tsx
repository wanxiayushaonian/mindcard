"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { workspaceApi, type Workspace } from "@/lib/api";
import { toast } from "@/lib/toast";
import { Modal } from "@/components/Modal";
import { FormField } from "@/components/FormField";
import { IconPicker, WorkspaceIcon, SPACE_ICON_KEYS } from "@/components/IconPicker";
import { ColorPicker, SPACE_COLORS } from "@/components/ColorPicker";
import { LoadingState } from "@/components/LoadingState";
import { ErrorState } from "@/components/ErrorState";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ConfirmModal } from "@/components/ConfirmModal";
import { translateBackendError } from "@/lib/backend-errors";
import { Plus, Link, Share2, Trash2, LogOut, Settings } from "lucide-react";

export default function WorkspacesPage() {
  const router = useRouter();
  const t = useTranslations("workspace");
  const tCommon = useTranslations("common");
  const tRole = useTranslations("role");
  const tBackend = useTranslations("backendError");

  const { data: workspaces, isLoading, error, mutate: revalidate } = useSWR("workspaces", () => workspaceApi.list());
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("lightbulb");
  const [color, setColor] = useState("#94B4C8");
  const [creating, setCreating] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [showShare, setShowShare] = useState(false);
  const [shareCode, setShareCode] = useState("");
  const [shareError, setShareError] = useState("");
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
      toast(t("createFailed", { error: translateBackendError(e.message, tBackend) }), "error");
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
      toast(t("deleteFailed", { error: translateBackendError(e.message, tBackend) }), "error");
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
      toast(t("joinedSuccess"), "success");
    } catch (e: any) {
      toast(t("exitFailed", { error: translateBackendError(e.message, tBackend) }), "error");
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
      setJoinError(translateBackendError(e.message, tBackend) || t("inviteCodeInvalid"));
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
    setShareError("");
    try {
      const res = await workspaceApi.generateInviteCode(wsId);
      setShareCode(res.invite_code);
    } catch (e: any) {
      setShareError(translateBackendError(e.message, tBackend) || t("generateFailed"));
    } finally {
      setShareLoading(false);
    }
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(shareCode).then(() => toast(tCommon("copied"), "success"));
  };

  if (isLoading) return <LoadingState fullScreen />;
  if (error) return <ErrorState message={error.message} onRetry={revalidate} />;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text">{t("mySpaces")}</h1>
          <p className="mt-1 text-sm text-text-secondary">{tCommon("selectSpaceToExplore")}</p>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
          <button
            onClick={() => router.push("/settings/models")}
            className="rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:bg-muted"
            title={tCommon("settings")}
          >
            <Settings size={16} />
          </button>
          <button
            onClick={() => router.push("/profile")}
            className="rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:bg-muted"
          >
            {tCommon("profileCenter")}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {workspaces?.map((ws) => (
          <div
            key={ws.id}
            className="group relative rounded-card border border-border bg-surface shadow-sm transition hover:shadow-md"
            style={{ borderTop: `4px solid ${ws.color}` }}
          >
            {/* Action buttons — always in DOM, visible on focus or hover */}
            <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              {ws.member_role === "owner" ? (
                <>
                  <button
                    onClick={(e) => handleShare(e, ws.id, ws.name)}
                    className="flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-400 transition hover:bg-blue-100 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <Share2 size={12} /> {tCommon("share")}
                  </button>
                  <button
                    onClick={(e) => handleDelete(e, ws.id)}
                    className="flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-400 transition hover:bg-red-100 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
                  >
                    <Trash2 size={12} /> {tCommon("delete")}
                  </button>
                </>
              ) : (
                <button
                  onClick={(e) => handleLeave(e, ws.id, ws.name)}
                  className="flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-xs text-orange-400 transition hover:bg-orange-100 hover:text-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <LogOut size={12} /> {t("exitSpace")}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => router.push(`/workspaces/${ws.id}`)}
              className="w-full p-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
            >
              <div className="mb-2 text-text-secondary">
                <WorkspaceIcon icon={ws.icon} size={32} />
              </div>
              <h3 className="font-semibold text-text">{ws.name}</h3>
              <div className="mt-1 flex items-center gap-2">
                <p className="text-xs text-text-secondary">
                  {new Date(ws.created_at).toLocaleDateString("zh-CN")}
                </p>
                {ws.member_role && ws.member_role !== "owner" && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                      ws.member_role === "admin"
                        ? "bg-blue-100 text-blue-700"
                        : ws.member_role === "editor"
                          ? "bg-gray-200 text-text-secondary"
                          : ws.member_role === "viewer"
                            ? "bg-muted text-text-secondary"
                            : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {tRole(ws.member_role as "admin" | "editor" | "viewer" | "pending")}
                  </span>
                )}
              </div>
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex min-h-[160px] cursor-pointer flex-col items-center justify-center rounded-card border-2 border-dashed border-border bg-transparent transition hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Plus size={32} className="mb-2 text-text-secondary/40" />
          <span className="text-sm text-text-secondary">{t("create")}</span>
        </button>

        <button
          type="button"
          onClick={() => { setShowJoin(true); setJoinCode(""); setJoinError(""); }}
          className="flex min-h-[160px] cursor-pointer flex-col items-center justify-center rounded-card border-2 border-dashed border-border bg-transparent transition hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Link size={32} className="mb-2 text-text-secondary/40" />
          <span className="text-sm text-text-secondary">{t("joinSpace")}</span>
        </button>
      </div>

      {/* Create workspace modal */}
      {showCreate && (
        <Modal
          title={t("createSpace")}
          onClose={() => setShowCreate(false)}
          onConfirm={handleCreate}
          confirmText={tCommon("create")}
          confirmDisabled={!name.trim()}
          loading={creating}
        >
          <FormField label={t("spaceName")}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("enterSpaceName")}
              autoFocus
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
      )}

      {/* Join workspace modal */}
      {showJoin && (
        <Modal
          title={t("joinSpace")}
          onClose={() => setShowJoin(false)}
          onConfirm={handleJoin}
          confirmText={tCommon("join")}
          confirmDisabled={joinCode.trim().length !== 6}
          loading={joining}
        >
          <FormField label={t("inviteCode")}>
            <input
              value={joinCode}
              onChange={(e) => { setJoinCode(e.target.value.toUpperCase()); setJoinError(""); }}
              placeholder={t("inviteCode6Chars")}
              maxLength={6}
              autoFocus
              className="w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-center text-lg tracking-[0.3em] uppercase text-text outline-none focus:border-primary"
            />
            {joinError && <p className="mt-2 text-sm text-red-500">{joinError}</p>}
          </FormField>
        </Modal>
      )}

      {/* Share invite code modal */}
      {showShare && (
        <Modal
          title={t("inviteToJoin", { name: shareWsName })}
          onClose={() => setShowShare(false)}
          onConfirm={shareCode ? handleCopyCode : undefined}
          confirmText={t("copyInviteCode")}
        >
          {shareLoading ? (
            <p className="py-4 text-center text-text-secondary">{tCommon("generating")}</p>
          ) : shareError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {shareError}
            </div>
          ) : (
            <>
              <div className="mb-4 rounded-xl bg-muted/40 py-4 text-center">
                <span className="text-3xl font-bold tracking-[0.3em] text-primary">{shareCode}</span>
              </div>
              <p className="mb-4 text-xs text-text-secondary">{t("shareHint")}</p>
            </>
          )}
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmModal
          title={t("deleteSpace")}
          message={t("deleteConfirm")}
          confirmText={tCommon("delete")}
          danger
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {leaveTarget && (
        <ConfirmModal
          title={t("exitSpace")}
          message={t("exitConfirm", { name: leaveTarget.name })}
          confirmText={t("exitSpace")}
          danger
          onConfirm={confirmLeave}
          onCancel={() => setLeaveTarget(null)}
        />
      )}
    </div>
  );
}
