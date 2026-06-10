"use client";

import { useState, useEffect } from "react";
import { settingsApi } from "@/lib/api";
import { toast } from "@/lib/toast";
import { translateBackendError } from "@/lib/backend-errors";
import { Languages, Check } from "lucide-react";
import { useTranslations } from "next-intl";

export default function ExtractionSettingsPage() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const tBackend = useTranslations("backendError");
  const [language, setLanguage] = useState<"zh" | "en">("zh");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadLanguage();
  }, []);

  const loadLanguage = async () => {
    try {
      const data = await settingsApi.getExtractionLanguage();
      setLanguage(data.language);
    } catch (err) {
      console.error("Failed to load extraction language:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (newLanguage: "zh" | "en") => {
    setSaving(true);
    try {
      await settingsApi.updateExtractionLanguage(newLanguage);
      setLanguage(newLanguage);
    } catch (err: any) {
      toast(translateBackendError(err.message || "", tBackend) || t("extractionSaveFailed", { error: err.message }), "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <div className="text-text-secondary">{tCommon("loading")}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="mb-1 text-xl font-bold text-text">{t("extractionLanguageTitle")}</h1>
      <p className="mb-6 text-sm text-text-secondary">
        {t("extractionLanguageDesc")}
      </p>

      {/* Current language banner */}
      <div className="mb-6 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
        <Languages size={18} className="text-primary" />
        <div>
          <p className="text-xs text-text-secondary">{t("currentLanguage")}</p>
          <p className="text-sm font-medium text-text">
            {language === "zh" ? t("chineseLabel") : t("englishLabel")}
          </p>
        </div>
      </div>

      {/* Language options */}
      <div className="flex flex-col gap-3">
        <button
          onClick={() => handleSave("zh")}
          disabled={saving}
          className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${
            language === "zh"
              ? "border-primary/30 bg-primary/5"
              : "border-border bg-surface hover:bg-gray-50 dark:hover:bg-gray-800"
          }`}
        >
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold ${
              language === "zh"
                ? "bg-primary/10 text-primary-dark"
                : "bg-gray-200 text-gray-400"
            }`}
          >
            {t("chineseShort")}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text">{t("chineseLabel")}</span>
              {language === "zh" && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  {t("current")}
                </span>
              )}
            </div>
            <p className="text-[11px] text-text-secondary">
              {t("chineseExtractDesc")}
            </p>
          </div>
          {language === "zh" && <Check size={16} className="text-primary" />}
        </button>

        <button
          onClick={() => handleSave("en")}
          disabled={saving}
          className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition ${
            language === "en"
              ? "border-primary/30 bg-primary/5"
              : "border-border bg-surface hover:bg-gray-50 dark:hover:bg-gray-800"
          }`}
        >
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold ${
              language === "en"
                ? "bg-primary/10 text-primary-dark"
                : "bg-gray-200 text-gray-400"
            }`}
          >
            EN
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text">{t("englishLabel")}</span>
              {language === "en" && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  {t("current")}
                </span>
              )}
            </div>
            <p className="text-[11px] text-text-secondary">
              {t("englishExtractDesc")}
            </p>
          </div>
          {language === "en" && <Check size={16} className="text-primary" />}
        </button>
      </div>

      {saving && (
        <div className="mt-4 text-center text-sm text-primary">{t("saving")}</div>
      )}

      {/* Hint */}
      <div className="mt-8 rounded-xl border border-dashed border-gray-300 bg-gray-50/50 p-4">
        <p className="text-xs text-text-secondary">
          {t("extractionLangHint")}
        </p>
      </div>
    </div>
  );
}
