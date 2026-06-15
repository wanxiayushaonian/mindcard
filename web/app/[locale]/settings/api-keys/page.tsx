"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { apiKeyApi, type ApiKeyCreated } from "@/lib/api";
import { toast } from "@/lib/toast";
import { translateBackendError } from "@/lib/backend-errors";
import { ConfirmModal } from "@/components/ConfirmModal";
import { LoadingState } from "@/components/LoadingState";
import { Copy, Trash2, Plus, Key, ExternalLink } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { formatDateTime, formatDate } from "@/lib/format";

export default function ApiKeysPage() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const tBackend = useTranslations("backendError");
  const locale = useLocale();

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
      const result = await apiKeyApi.create(newKeyName || t("apiKeyDefaultName"));
      setCreatedKey(result);
      setNewKeyName("");
      setShowCreate(false);
      revalidate();
    } catch (e: any) {
      toast(translateBackendError(e.message || "", tBackend) || t("apiKeyCreateFailed", { error: e.message }), "error");
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast(tCommon("copied"), "success");
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    try {
      await apiKeyApi.revoke(revokeTarget.id);
      revalidate();
    } catch (e: any) {
      toast(translateBackendError(e.message || "", tBackend) || t("apiKeyRevoked", { error: e.message }), "error");
    }
    setRevokeTarget(null);
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="mb-1 text-xl font-bold text-text">{t("apiKeyManagement")}</h1>
      <p className="mb-6 text-sm text-text-secondary">
        {t("apiKeyManagementDesc")}
      </p>

      {/* Newly created key banner */}
      {createdKey && (
        <div className="mb-6 rounded-xl border border-green-200 bg-green-50 p-4">
          <p className="mb-2 text-sm font-semibold text-green-800">
            {t("apiKeyCreatedBanner")}
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
            {t("apiKeySavedClose")}
          </button>
        </div>
      )}

      {/* Create button */}
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm font-medium text-text">
          {t("existingKeyCount", { count: keys?.length || 0 })}
        </span>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition hover:bg-primary-dark"
        >
          <Plus size={14} /> {t("generateNewKey")}
        </button>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="mb-4 rounded-xl border border-border bg-surface p-4 shadow-sm">
          <p className="mb-2 text-sm font-medium text-text">{t("nameNewKey")}</p>
          <input
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder={t("nameNewKeyPlaceholder")}
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
              {creating ? t("creating") : tCommon("create")}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="rounded-lg px-4 py-1.5 text-xs text-text-secondary hover:bg-gray-100"
            >
              {tCommon("cancel")}
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
          <p className="text-sm text-text-secondary">{t("noApiKeysYet")}</p>
          <p className="mt-1 text-xs text-text-secondary">
            {t("generateKeyHint")}
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
                      {t("revoked")}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-3 text-[11px] text-text-secondary">
                  <span className="font-mono">{k.key_prefix}...</span>
                  <span>
                    {k.last_used_at
                      ? t("lastUsedAt", { date: formatDateTime(k.last_used_at, locale) })
                      : t("neverUsed")}
                  </span>
                  <span>
                    {t("createdAtDate", { date: formatDate(k.created_at, locale) })}
                  </span>
                </div>
              </div>
              {k.is_active && (
                <button
                  onClick={() => setRevokeTarget({ id: k.id, name: k.name })}
                  className="ml-3 shrink-0 rounded-lg px-2 py-1 text-xs text-red-400 hover:bg-red-50 hover:text-red-600"
                >
                  {t("revokeKey")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Extension link */}
      <div className="mt-8 rounded-xl border border-dashed border-gray-300 bg-gray-50/50 p-4 text-center">
        <p className="mb-2 text-sm text-text-secondary">
          {t("afterGenerateKeyHint")}
        </p>
        <div className="flex items-center justify-center gap-1 text-xs text-primary">
          <ExternalLink size={12} />
          <span>{t("chromeExtension")}</span>
        </div>
      </div>

      {revokeTarget && (
        <ConfirmModal
          title={t("revokeApiKey")}
          message={t("revokeApiKeyConfirm", { name: revokeTarget.name })}
          confirmText={t("revokeKey")}
          danger
          onConfirm={handleRevoke}
          onCancel={() => setRevokeTarget(null)}
        />
      )}
    </div>
  );
}
