"use client";

import { useState, useEffect } from "react";
import { settingsApi } from "@/lib/api";

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
      <div className="p-8">
        <div className="text-text-secondary">加载中...</div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-semibold text-text mb-2">知识图谱提取语言</h1>
      <p className="text-sm text-text-secondary mb-6">
        选择实体和关系提取时使用的提示词语言。这会影响知识图谱的构建质量。
      </p>

      <div className="bg-surface border border-border rounded-lg p-6">
        <div className="space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="language"
              value="zh"
              checked={language === "zh"}
              onChange={() => handleSave("zh")}
              disabled={saving}
              className="mt-1"
            />
            <div>
              <div className="font-medium text-text">中文</div>
              <div className="text-sm text-text-secondary">
                使用中文提示词进行实体和关系提取，适合中文内容
              </div>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="language"
              value="en"
              checked={language === "en"}
              onChange={() => handleSave("en")}
              disabled={saving}
              className="mt-1"
            />
            <div>
              <div className="font-medium text-text">English</div>
              <div className="text-sm text-text-secondary">
                Use English prompts for entity and relation extraction, suitable for English content
              </div>
            </div>
          </label>
        </div>

        {saving && (
          <div className="mt-4 text-sm text-primary">保存中...</div>
        )}
      </div>

      <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <div className="text-sm text-blue-900 dark:text-blue-100">
          <strong>提示：</strong>更改语言设置后，新创建的卡片将使用新的语言进行知识图谱提取。已有的图谱不会受到影响。
        </div>
      </div>
    </div>
  );
}
