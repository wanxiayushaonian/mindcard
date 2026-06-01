"use client";

import { useState, useEffect } from "react";
import { settingsApi } from "@/lib/api";
import { Languages, Check } from "lucide-react";

export default function ExtractionSettingsPage() {
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
      alert(`保存失败: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-8">
        <div className="text-text-secondary">加载中...</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="mb-1 text-xl font-bold text-text">知识图谱提取语言</h1>
      <p className="mb-6 text-sm text-text-secondary">
        选择实体和关系提取时使用的提示词语言。这会影响知识图谱的构建质量。
      </p>

      {/* Current language banner */}
      <div className="mb-6 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
        <Languages size={18} className="text-primary" />
        <div>
          <p className="text-xs text-text-secondary">当前语言</p>
          <p className="text-sm font-medium text-text">
            {language === "zh" ? "中文" : "English"}
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
            中
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text">中文</span>
              {language === "zh" && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  当前
                </span>
              )}
            </div>
            <p className="text-[11px] text-text-secondary">
              使用中文提示词进行实体和关系提取，适合中文内容
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
              <span className="text-sm font-medium text-text">English</span>
              {language === "en" && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  当前
                </span>
              )}
            </div>
            <p className="text-[11px] text-text-secondary">
              Use English prompts for entity and relation extraction, suitable for English content
            </p>
          </div>
          {language === "en" && <Check size={16} className="text-primary" />}
        </button>
      </div>

      {saving && (
        <div className="mt-4 text-center text-sm text-primary">保存中...</div>
      )}

      {/* Hint */}
      <div className="mt-8 rounded-xl border border-dashed border-gray-300 bg-gray-50/50 p-4">
        <p className="text-xs text-text-secondary">
          <strong>提示：</strong>更改语言设置后，新创建的卡片将使用新的语言进行知识图谱提取。已有的图谱不会受到影响。
        </p>
      </div>
    </div>
  );
}
