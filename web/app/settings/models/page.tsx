"use client";

import { useState } from "react";
import useSWR from "swr";
import { settingsApi, type LLMProvider, type CurrentProvider } from "@/lib/api";
import { toast } from "@/lib/toast";
import { LoadingState } from "@/components/LoadingState";
import { Cpu, Check, ChevronDown, Loader2, FileText, Globe, Eye, EyeOff } from "lucide-react";
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

      {/* Extraction Model Section */}
      <ExtractionModelSection providers={providers} />
      <WebSearchSettingsSection />
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

function ExtractionModelSection({ providers }: { providers: LLMProvider[] | undefined }) {
  const { data: extraction, mutate: mutateExtraction } = useSWR(
    "extraction-provider",
    () => settingsApi.getExtractionProvider(),
    { revalidateOnFocus: false }
  );

  const [switching, setSwitching] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleSwitch = async (provider: string, model?: string) => {
    if (switching) return;
    setSwitching(true);
    try {
      await settingsApi.updateExtractionProvider(provider, model);
      await mutateExtraction();
      toast(`提取模型已切换到 ${provider}${model ? " / " + model : ""}`, "success");
    } catch (e: any) {
      toast("切换失败: " + (e.message || "未知错误"), "error");
    } finally {
      setSwitching(false);
    }
  };

  if (!extraction) return null;

  const configuredProviders = providers?.filter((p) => p.configured) ?? [];

  return (
    <div className="mt-8">
      <h2 className="mb-1 text-lg font-bold text-text">提取模型</h2>
      <p className="mb-4 text-sm text-text-secondary">
        用于生成标题、提取关键词等轻量任务。可选择更便宜/快速的模型以节省成本。
      </p>

      {/* Current extraction model */}
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
        <FileText size={18} className="text-text-secondary" />
        <div className="flex-1">
          <p className="text-xs text-text-secondary">当前提取模型</p>
          <p className="text-sm font-medium text-text">
            {providers?.find((p) => p.name === extraction.provider)?.label ?? extraction.provider}
            <span className="ml-2 text-text-secondary">/ {extraction.model}</span>
          </p>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-gray-50"
        >
          更换
        </button>
      </div>

      {/* Provider/model selection */}
      {expanded && (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
          {/* Option: use default */}
          <button
            onClick={() => handleSwitch("")}
            disabled={switching || extraction.provider === ""}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
              extraction.provider === ""
                ? "bg-primary/5 text-primary font-medium"
                : "text-text hover:bg-gray-50"
            }`}
          >
            <span className="flex-1 text-left">跟随主模型</span>
            {extraction.provider === "" && <Check size={14} className="text-primary" />}
          </button>

          {/* Available providers */}
          {configuredProviders.map((provider) => (
            <ProviderModelPicker
              key={provider.name}
              provider={provider}
              isActive={extraction.provider === provider.name}
              currentModel={extraction.provider === provider.name ? extraction.model : undefined}
              switching={switching}
              onSelect={(model) => handleSwitch(provider.name, model)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProviderModelPicker({
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
    `extraction-models-${provider.name}`,
    () => settingsApi.listModels(provider.name),
    { revalidateOnFocus: false }
  );

  const models = data?.models ?? provider.models;
  const [showModels, setShowModels] = useState(false);

  return (
    <div className="rounded-lg border border-border">
      <button
        onClick={() => setShowModels(!showModels)}
        className="flex w-full items-center gap-2 px-3 py-2 text-sm"
      >
        <span className="flex-1 text-left font-medium">{provider.label}</span>
        {isActive && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
            {currentModel || "默认模型"}
          </span>
        )}
        <ChevronDown size={12} className={`text-text-secondary transition ${showModels ? "rotate-180" : ""}`} />
      </button>
      {showModels && (
        <div className="border-t border-border px-2 py-1">
          {isLoading && <Loader2 size={10} className="animate-spin" />}
          {models.map((model: string) => {
            const isModelActive = isActive && currentModel === model;
            return (
              <button
                key={model}
                onClick={() => onSelect(model)}
                disabled={switching || isModelActive}
                className={`flex w-full items-center gap-2 rounded px-3 py-1.5 text-xs transition ${
                  isModelActive
                    ? "bg-primary/5 text-primary font-medium"
                    : "text-text-secondary hover:bg-gray-50"
                }`}
              >
                <span className="flex-1 text-left">{model}</span>
                {isModelActive && <Check size={12} className="text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WebSearchSettingsSection() {
  const { data, mutate } = useSWR(
    "web-search-settings",
    () => settingsApi.getWebSearchSettings(),
    { revalidateOnFocus: false }
  );

  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [baseUrlInput, setBaseUrlInput] = useState("");

  if (!data) return null;

  const activeProvider = data.providers.find((p) => p.name === data.provider) || data.providers[0];

  const handleSave = async (updates: {
    provider?: string;
    api_key?: string;
    base_url?: string;
    max_results?: number;
    timeout?: number;
    proxy?: string;
  }) => {
    if (saving) return;
    setSaving(true);
    try {
      await settingsApi.updateWebSearchSettings(updates);
      await mutate();
      toast("网页搜索设置已保存", "success");
    } catch (e: any) {
      toast("保存失败: " + (e.message || "未知错误"), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-8">
      <h2 className="mb-1 text-lg font-bold text-text">网页搜索</h2>
      <p className="mb-4 text-sm text-text-secondary">
        配置 AI 对话时使用的网页搜索引擎。DuckDuckGo 无需 API Key。
      </p>

      {/* Current provider banner */}
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
        <Globe size={18} className="text-text-secondary" />
        <div className="flex-1">
          <p className="text-xs text-text-secondary">当前搜索引擎</p>
          <p className="text-sm font-medium text-text">
            {activeProvider.label}
            <span className="ml-2 text-text-secondary">/ 最多 {data.max_results} 条</span>
          </p>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-gray-50"
        >
          {expanded ? "收起" : "配置"}
        </button>
      </div>

      {expanded && (
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
          {/* Provider selection */}
          <div>
            <label className="mb-2 block text-xs font-medium text-text-secondary">搜索引擎</label>
            <div className="grid grid-cols-3 gap-2">
              {data.providers.map((p) => {
                const isActive = data.provider === p.name;
                return (
                  <button
                    key={p.name}
                    onClick={() => {
                      handleSave({ provider: p.name });
                      setApiKeyInput("");
                      setBaseUrlInput("");
                    }}
                    disabled={saving}
                    className={`rounded-lg border px-3 py-2 text-sm transition ${
                      isActive
                        ? "border-primary bg-primary/5 text-primary font-medium"
                        : "border-border text-text hover:border-gray-400"
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Credential input */}
          {activeProvider.credential === "api_key" && (
            <div>
              <label className="mb-2 block text-xs font-medium text-text-secondary">
                API Key
                {data.api_key_set && (
                  <span className="ml-2 text-green-600">已配置</span>
                )}
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showApiKey ? "text" : "password"}
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder={data.api_key_set ? "输入新 Key 以更换" : `输入 ${activeProvider.label} API Key`}
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 pr-9 text-sm text-text placeholder:text-text-secondary/50 focus:border-primary focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text"
                  >
                    {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <button
                  onClick={() => handleSave({ api_key: apiKeyInput })}
                  disabled={saving || !apiKeyInput.trim()}
                  className="rounded-lg bg-primary px-4 py-2 text-sm text-white hover:bg-primary-dark disabled:opacity-50"
                >
                  保存
                </button>
              </div>
            </div>
          )}

          {activeProvider.credential === "base_url" && (
            <div>
              <label className="mb-2 block text-xs font-medium text-text-secondary">
                SearXNG 实例地址
                {data.base_url && (
                  <span className="ml-2 text-green-600">已配置</span>
                )}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={baseUrlInput}
                  onChange={(e) => setBaseUrlInput(e.target.value)}
                  placeholder={data.base_url || "https://searxng.example.com"}
                  className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-secondary/50 focus:border-primary focus:outline-none"
                />
                <button
                  onClick={() => handleSave({ base_url: baseUrlInput })}
                  disabled={saving || !baseUrlInput.trim()}
                  className="rounded-lg bg-primary px-4 py-2 text-sm text-white hover:bg-primary-dark disabled:opacity-50"
                >
                  保存
                </button>
              </div>
            </div>
          )}

          {activeProvider.credential === "none" && (
            <div className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">
              无需 API Key，开箱即用
            </div>
          )}

          {/* Max results & Timeout */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="mb-2 block text-xs font-medium text-text-secondary">
                最大结果数
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={data.max_results}
                onChange={(e) => handleSave({ max_results: parseInt(e.target.value) || 5 })}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
              />
            </div>
            <div className="flex-1">
              <label className="mb-2 block text-xs font-medium text-text-secondary">
                超时（秒）
              </label>
              <input
                type="number"
                min={1}
                max={120}
                value={data.timeout}
                onChange={(e) => handleSave({ timeout: parseInt(e.target.value) || 30 })}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
              />
            </div>
          </div>

          {/* Proxy */}
          <div>
            <label className="mb-2 block text-xs font-medium text-text-secondary">
              代理地址
              <span className="ml-2 font-normal text-text-secondary/60">可选，留空使用系统代理</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                defaultValue={data.proxy}
                onBlur={(e) => {
                  const val = e.target.value.trim();
                  if (val !== data.proxy) handleSave({ proxy: val });
                }}
                placeholder="socks5://127.0.0.1:7897 或 http://127.0.0.1:7890"
                className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-secondary/50 focus:border-primary focus:outline-none"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
