"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { apiKeyApi, type ApiKeyCreated } from "@/lib/api";
import { toast } from "@/lib/toast";
import { ConfirmModal } from "@/components/ConfirmModal";
import { LoadingState } from "@/components/LoadingState";
import { Copy, Trash2, Plus, Key, ExternalLink } from "lucide-react";
import Link from "next/link";

export default function ApiKeysPage() {
  const { data: keys, isLoading, error, mutate: revalidate } = useSWR(
    "api-keys",
    () => apiKeyApi.list()
  );

  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<ApiKeyCreated | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; name: string } | null>(null);

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const result = await apiKeyApi.create(newKeyName || "Chrome 插件");
      setCreatedKey(result);
      setNewKeyName("");
      setShowCreate(false);
      revalidate();
    } catch (e: any) {
      toast("创建失败: " + e.message, "error");
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast("已复制到剪贴板", "success");
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    try {
      await apiKeyApi.revoke(revokeTarget.id);
      revalidate();
    } catch (e: any) {
      toast("吊销失败: " + e.message, "error");
    }
    setRevokeTarget(null);
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-2 flex items-center gap-2">
        <Link href="/workspaces" className="text-xs text-text-secondary hover:text-primary">
          ← 返回空间
        </Link>
      </div>
      <h1 className="mb-1 text-xl font-bold text-text">API Key 管理</h1>
      <p className="mb-6 text-sm text-text-secondary">
        生成 API Key 用于浏览器插件等外部工具调用 MindCard 接口。
      </p>

      {/* Newly created key banner */}
      {createdKey && (
        <div className="mb-6 rounded-xl border border-green-200 bg-green-50 p-4">
          <p className="mb-2 text-sm font-semibold text-green-800">
            API Key 已创建，请立即复制保存（仅显示一次）
          </p>
          <div className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 font-mono text-sm">
            <span className="flex-1 truncate">{createdKey.key}</span>
            <button
              onClick={() => handleCopy(createdKey.key)}
              className="shrink-0 text-primary hover:text-primary-dark"
            >
              <Copy size={16} />
            </button>
          </div>
          <button
            onClick={() => setCreatedKey(null)}
            className="mt-2 text-xs text-green-700 underline"
          >
            我已保存，关闭提示
          </button>
        </div>
      )}

      {/* Create button */}
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm font-medium text-text">
          已有 {keys?.length || 0} 个 Key
        </span>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition hover:bg-primary-dark"
        >
          <Plus size={14} /> 生成新 Key
        </button>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="mb-4 rounded-xl border border-border bg-surface p-4 shadow-sm">
          <p className="mb-2 text-sm font-medium text-text">为新 Key 命名</p>
          <input
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="如：Chrome 插件、手机端..."
            autoFocus
            className="mb-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary"
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating}
              className="rounded-lg bg-primary px-4 py-1.5 text-xs text-white disabled:opacity-50"
            >
              {creating ? "创建中..." : "创建"}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="rounded-lg px-4 py-1.5 text-xs text-text-secondary hover:bg-gray-100"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Key list */}
      {isLoading && <LoadingState />}

      {error && (
        <p className="py-8 text-center text-sm text-red-500">{error.message}</p>
      )}

      {keys && keys.length === 0 && !isLoading && (
        <div className="py-16 text-center">
          <Key size={40} className="mx-auto mb-3 text-gray-300" />
          <p className="text-sm text-text-secondary">还没有 API Key</p>
          <p className="mt-1 text-xs text-text-secondary">
            生成一个 Key 以在浏览器插件中使用
          </p>
        </div>
      )}

      {keys && keys.length > 0 && (
        <div className="flex flex-col gap-2">
          {keys.map((k) => (
            <div
              key={k.id}
              className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
                k.is_active
                  ? "border-border bg-surface"
                  : "border-gray-200 bg-gray-50 opacity-60"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text">{k.name}</span>
                  {!k.is_active && (
                    <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] text-gray-500">
                      已吊销
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-3 text-[11px] text-text-secondary">
                  <span className="font-mono">{k.key_prefix}...</span>
                  <span>
                    {k.last_used_at
                      ? `最后使用: ${new Date(k.last_used_at).toLocaleString("zh-CN")}`
                      : "从未使用"}
                  </span>
                  <span>
                    创建于 {new Date(k.created_at).toLocaleDateString("zh-CN")}
                  </span>
                </div>
              </div>
              {k.is_active && (
                <button
                  onClick={() => setRevokeTarget({ id: k.id, name: k.name })}
                  className="ml-3 shrink-0 rounded-lg px-2 py-1 text-xs text-red-400 hover:bg-red-50 hover:text-red-600"
                >
                  吊销
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Extension link */}
      <div className="mt-8 rounded-xl border border-dashed border-gray-300 bg-gray-50/50 p-4 text-center">
        <p className="mb-2 text-sm text-text-secondary">
          生成 Key 后，在浏览器插件的设置页中填入即可使用
        </p>
        <div className="flex items-center justify-center gap-1 text-xs text-primary">
          <ExternalLink size={12} />
          <span>Chrome 插件（即将可用）</span>
        </div>
      </div>

      {revokeTarget && (
        <ConfirmModal
          title="吊销 API Key"
          message={`确定吊销「${revokeTarget.name}」？吊销后使用此 Key 的应用将无法访问 MindCard。`}
          confirmText="吊销"
          danger
          onConfirm={handleRevoke}
          onCancel={() => setRevokeTarget(null)}
        />
      )}
    </div>
  );
}
