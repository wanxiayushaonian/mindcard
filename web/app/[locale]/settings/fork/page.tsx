"use client";

import { useState } from "react";
import useSWR from "swr";
import { forkSettingsApi, type ForkSettings } from "@/lib/api";
import { toast } from "@/lib/toast";
import { translateBackendError } from "@/lib/backend-errors";
import { LoadingState } from "@/components/LoadingState";
import { GitFork, Check } from "lucide-react";
import { useTranslations } from "next-intl";

export default function ForkSettingsPage() {
  const t = useTranslations("fork");
  const tBackend = useTranslations("backendError");
  const tSettings = useTranslations("settings");

  const {
    data: settings,
    isLoading,
    error,
    mutate,
  } = useSWR("fork-settings", () => forkSettingsApi.get(), {
    revalidateOnFocus: false,
  });

  const [saving, setSaving] = useState(false);

  const handleToggleAutoFork = async () => {
    if (!settings || saving) return;
    setSaving(true);
    try {
      await forkSettingsApi.update({
        auto_fork_enabled: !settings.auto_fork_enabled,
      });
      await mutate();
      toast(
        t("autoForkToggled", {
          enabled: settings.auto_fork_enabled ? t("autoForkDisabled") : t("autoForkEnabled"),
        }),
        "success",
      );
    } catch (e: any) {
      toast(translateBackendError(e.message || "", tBackend) || t("forkSaveFailed", { error: e.message || "" }), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleStrategyChange = async (strategy: string) => {
    if (!settings || saving) return;
    setSaving(true);
    try {
      await forkSettingsApi.update({ fork_context_strategy: strategy });
      await mutate();
      toast(t("contextStrategyUpdated"), "success");
    } catch (e: any) {
      toast(translateBackendError(e.message || "", tBackend) || t("forkSaveFailed", { error: e.message || "" }), "error");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return <LoadingState />;

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <p className="text-sm text-red-500">{error.message}</p>
      </div>
    );
  }

  if (!settings) return null;

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="mb-1 text-xl font-bold text-text">{t("forkTitle")}</h1>
      <p className="mb-6 text-sm text-text-secondary">
        {t("forkSubtitle")}
      </p>

      {/* Current settings banner */}
      <div className="mb-6 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
        <GitFork size={18} className="text-primary" />
        <div>
          <p className="text-xs text-text-secondary">{t("currentConfig")}</p>
          <p className="text-sm font-medium text-text">
            {tSettings("autoFork")}: {settings.auto_fork_enabled ? t("autoForkEnabled") : t("autoForkDisabled")}
            <span className="ml-2 text-text-secondary">
              / {tSettings("contextStrategy")}: {settings.fork_context_strategy}
            </span>
          </p>
        </div>
      </div>

      {/* Auto fork toggle */}
      <div className="mb-6 rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-text">{t("autoForkLabel")}</h3>
            <p className="mt-1 text-xs text-text-secondary">
              {t("autoForkDesc")}
            </p>
          </div>
          <button
            onClick={handleToggleAutoFork}
            disabled={saving}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              settings.auto_fork_enabled ? "bg-primary" : "bg-gray-300"
            }`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                settings.auto_fork_enabled ? "translate-x-5" : ""
              }`}
            />
          </button>
        </div>
      </div>

      {/* Context strategy */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <h3 className="mb-3 text-sm font-medium text-text">{t("contextStrategy")}</h3>
        <p className="mb-4 text-xs text-text-secondary">
          {t("contextStrategyDesc")}
        </p>
        <div className="flex flex-col gap-2">
          {[
            {
              value: "none",
              label: "none",
              desc: t("strategyNoneDesc"),
            },
            {
              value: "inherit",
              label: "inherit",
              desc: t("strategyInheritDesc"),
            },
            {
              value: "compress",
              label: "compress",
              desc: t("strategyCompressDesc"),
            },
          ].map((opt) => {
            const isActive = settings.fork_context_strategy === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => handleStrategyChange(opt.value)}
                disabled={saving || isActive}
                className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition ${
                  isActive
                    ? "border-primary/30 bg-primary/5"
                    : "border-border hover:border-gray-400"
                }`}
              >
                <div className="flex-1">
                  <span className="text-sm font-medium text-text">
                    {opt.label}
                  </span>
                  <p className="mt-0.5 text-[11px] text-text-secondary">
                    {opt.desc}
                  </p>
                </div>
                {isActive && <Check size={14} className="text-primary" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Fork Profiles */}
      {settings.profiles && settings.profiles.length > 0 && (
        <div className="mt-6 rounded-xl border border-border bg-surface p-4">
          <h3 className="mb-3 text-sm font-medium text-text">{t("forkTypeLabel")}</h3>
          <p className="mb-4 text-xs text-text-secondary">
            {t("forkTypeDesc")}
          </p>
          <div className="flex flex-col gap-2">
            {settings.profiles.map((profile) => (
              <div
                key={profile.name}
                className="flex items-center gap-3 rounded-lg border border-border px-4 py-3"
              >
                <div className="flex-1">
                  <span className="text-sm font-medium text-text">
                    {profile.label}
                    <span className="ml-2 text-[11px] font-normal text-text-secondary">
                      {profile.name}
                    </span>
                  </span>
                  <p className="mt-0.5 text-[11px] text-text-secondary">
                    {profile.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hint */}
      <div className="mt-8 rounded-xl border border-dashed border-gray-300 bg-gray-50/50 p-4">
        <p className="text-xs text-text-secondary">
          {t("envVarHint", {
            var1: "AUTO_FORK_ENABLED",
            var2: "FORK_CONTEXT_STRATEGY",
          })}
        </p>
      </div>
    </div>
  );
}
