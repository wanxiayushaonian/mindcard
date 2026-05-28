"use client";

import { useState } from "react";
import useSWR from "swr";
import { settingsApi, type LLMProvider, type CurrentProvider } from "@/lib/api";
import { toast } from "@/lib/toast";
import { LoadingState } from "@/components/LoadingState";
import { Cpu, Check, ChevronDown, Loader2 } from "lucide-react";
import Link from "next/link";

export default function ModelSettingsPage() {
  const {
    data: providers,
    isLoading,
    error,
  } = useSWR("llm-providers", () => settingsApi.listProviders(), {
    revalidateOnFocus: false,
  });

  const { data: current, mutate: mutateCurrent } = useSWR(
    "llm-current",
    () => settingsApi.getCurrent(),
    { revalidateOnFocus: false }
  );

  const [switching, setSwitching] = useState(false);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);

  const handleSwitch = async (provider: string, model: string) => {
    if (switching) return;
    setSwitching(true);
    try {
      await settingsApi.switchProvider(provider, model);
      await mutateCurrent();
      toast(`已切换到 ${provider} / ${model}`, "success");
    } catch (e: any) {
      toast("切换失败: " + (e.message || "未知错误"), "error");
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="mb-1 text-xl font-bold text-text">模型设置</h1>
      <p className="mb-6 text-sm text-text-secondary">
        选择 AI 对话使用的模型提供商。配置 API Key 后对应提供商将变为可用。
        <Link href="/settings/api-keys" className="ml-2 text-primary hover:underline">
          管理 API Key →
        </Link>
      </p>

      {/* Current model banner */}
      {current && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
          <Cpu size={18} className="text-primary" />
          <div>
            <p className="text-xs text-text-secondary">当前使用</p>
            <p className="text-sm font-medium text-text">
              {providers?.find((p) => p.name === current.provider)?.label ?? current.provider}
              <span className="ml-2 text-text-secondary">/ {current.model}</span>
            </p>
          </div>
        </div>
      )}

      {isLoading && <LoadingState />}

      {error && (
        <p className="py-8 text-center text-sm text-red-500">{error.message}</p>
      )}

      {/* Provider list */}
      {providers && (
        <div className="flex flex-col gap-3">
          {providers.map((provider) => {
            const isActive = current?.provider === provider.name;
            const isExpanded = expandedProvider === provider.name;

            return (
              <div
                key={provider.name}
                className={`rounded-xl border transition ${
                  provider.configured
                    ? "border-border bg-surface"
                    : "border-dashed border-gray-300 bg-gray-50/50 opacity-60"
                }`}
              >
                {/* Provider header */}
                <button
                  onClick={() =>
                    provider.configured &&
                    setExpandedProvider(isExpanded ? null : provider.name)
                  }
                  className="flex w-full items-center gap-3 px-4 py-3"
                  disabled={!provider.configured}
                >
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold ${
                      provider.configured
                        ? "bg-primary/10 text-primary-dark"
                        : "bg-gray-200 text-gray-400"
                    }`}
                  >
                    {provider.label.charAt(0)}
                  </div>
                  <div className="flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text">
                        {provider.label}
                      </span>
                      {isActive && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                          当前
                        </span>
                      )}
                      {!provider.configured && (
                        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] text-gray-500">
                          未配置
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-text-secondary">
                      {provider.configured
                        ? `${provider.backend === "anthropic" ? "Anthropic API" : "OpenAI 兼容"}`
                        : `需要配置 ${provider.name === "claude" ? "ANTHROPIC" : provider.name.toUpperCase()}_API_KEY`}
                    </p>
                  </div>
                  {provider.configured && (
                    <ChevronDown
                      size={14}
                      className={`text-text-secondary transition-transform ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                    />
                  )}
                </button>

                {/* Model list (expanded, dynamic) */}
                {isExpanded && provider.configured && (
                  <ModelList
                    provider={provider}
                    isActive={isActive}
                    currentModel={current?.model}
                    switching={switching}
                    onSelect={(model) => handleSwitch(provider.name, model)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Hint */}
      <div className="mt-8 rounded-xl border border-dashed border-gray-300 bg-gray-50/50 p-4 text-center">
        <p className="text-xs text-text-secondary">
          在 <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[11px]">.env</code> 文件中配置对应提供商的 API Key，
          重启服务后即可在上方看到可用选项。
        </p>
        <div className="mt-2 flex items-center justify-center gap-3 text-[11px] text-text-secondary">
          <span>DEEPSEEK_API_KEY</span>
          <span>·</span>
          <span>OPENAI_API_KEY</span>
          <span>·</span>
          <span>ANTHROPIC_API_KEY</span>
          <span>·</span>
          <span>GEMINI_API_KEY</span>
        </div>
      </div>
    </div>
  );
}

function ModelList({
  provider,
  isActive,
  currentModel,
  switching,
  onSelect,
}: {
  provider: LLMProvider;
  isActive: boolean;
  currentModel: string | undefined;
  switching: boolean;
  onSelect: (model: string) => void;
}) {
  const { data, isLoading } = useSWR(
    `models-${provider.name}`,
    () => settingsApi.listModels(provider.name),
    { revalidateOnFocus: false }
  );

  const models = data?.models ?? provider.models;

  return (
    <div className="border-t border-border px-4 py-2">
      <div className="flex items-center gap-1 px-2 py-1 text-[10px] text-text-secondary">
        {data?.source === "remote" ? (
          <span className="text-green-600 dark:text-green-400">已从 API 同步 {models.length} 个模型</span>
        ) : (
          <span>预定义模型列表</span>
        )}
        {isLoading && <Loader2 size={10} className="animate-spin" />}
      </div>
      {models.map((model) => {
        const isModelActive = isActive && currentModel === model;
        return (
          <button
            key={model}
            onClick={() => onSelect(model)}
            disabled={switching || isModelActive}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
              isModelActive
                ? "bg-primary/5 text-primary font-medium"
                : "text-text hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
          >
            <span className="flex-1 text-left">{model}</span>
            {isModelActive && <Check size={14} className="text-primary" />}
          </button>
        );
      })}
    </div>
  );
}
