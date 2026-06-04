"use client";

import { useState } from "react";
import useSWR from "swr";
import { forkSettingsApi, type ForkSettings } from "@/lib/api";
import { toast } from "@/lib/toast";
import { LoadingState } from "@/components/LoadingState";
import { GitFork, Check } from "lucide-react";

export default function ForkSettingsPage() {
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
        settings.auto_fork_enabled ? "已关闭自动分叉" : "已开启自动分叉",
        "success",
      );
    } catch (e: any) {
      toast("保存失败: " + (e.message || "未知错误"), "error");
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
      toast("上下文压缩策略已更新", "success");
    } catch (e: any) {
      toast("保存失败: " + (e.message || "未知错误"), "error");
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
      <h1 className="mb-1 text-xl font-bold text-text">对话分叉</h1>
      <p className="mb-6 text-sm text-text-secondary">
        配置对话分叉的行为，包括自动分叉触发和上下文继承策略。
      </p>

      {/* Current settings banner */}
      <div className="mb-6 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
        <GitFork size={18} className="text-primary" />
        <div>
          <p className="text-xs text-text-secondary">当前配置</p>
          <p className="text-sm font-medium text-text">
            自动分叉: {settings.auto_fork_enabled ? "开启" : "关闭"}
            <span className="ml-2 text-text-secondary">
              / 策略: {settings.fork_context_strategy}
            </span>
          </p>
        </div>
      </div>

      {/* Auto fork toggle */}
      <div className="mb-6 rounded-xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-text">自动分叉</h3>
            <p className="mt-1 text-xs text-text-secondary">
              当对话上下文过长时，自动触发分叉以压缩上下文。
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
        <h3 className="mb-3 text-sm font-medium text-text">上下文压缩策略</h3>
        <p className="mb-4 text-xs text-text-secondary">
          选择分叉时如何处理父对话的上下文。
        </p>
        <div className="flex flex-col gap-2">
          {[
            {
              value: "none",
              label: "none",
              desc: "不传递父上下文 — 分叉后的对话从零开始",
            },
            {
              value: "inherit",
              label: "inherit",
              desc: "原样继承 — 完整保留父对话的所有消息",
            },
            {
              value: "compress",
              label: "compress",
              desc: "LLM 压缩（推荐）— 使用 LLM 将父上下文压缩为摘要",
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

      {/* Hint */}
      <div className="mt-8 rounded-xl border border-dashed border-gray-300 bg-gray-50/50 p-4">
        <p className="text-xs text-text-secondary">
          <strong>提示：</strong>这些设置通过环境变量
          <code className="mx-1 rounded bg-gray-100 px-1 py-0.5 font-mono text-[11px]">
            AUTO_FORK_ENABLED
          </code>
          和
          <code className="mx-1 rounded bg-gray-100 px-1 py-0.5 font-mono text-[11px]">
            FORK_CONTEXT_STRATEGY
          </code>
          控制，修改后立即生效。
        </p>
      </div>
    </div>
  );
}
