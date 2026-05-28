"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import useSWR from "swr";
import { settingsApi, type LLMProvider, type CurrentProvider } from "@/lib/api";
import { toast } from "@/lib/toast";
import { ChevronDown, Check, Cpu, Loader2 } from "lucide-react";

interface ModelSelectorProps {
  compact?: boolean;
}

export function ModelSelector({ compact = false }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const { data: providers, error: providersError } = useSWR(
    "llm-providers",
    () => settingsApi.listProviders(),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  const { data: current, mutate: mutateCurrent } = useSWR(
    "llm-current",
    () => settingsApi.getCurrent(),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const configuredProviders = providers?.filter((p) => p.configured) ?? [];
  const currentLabel = current
    ? `${providers?.find((p) => p.name === current.provider)?.label ?? current.provider} / ${current.model}`
    : providers?.[0]
      ? `${providers[0].label} / ${providers[0].default_model}`
      : "AI 模型";

  const handleSwitch = useCallback(async (provider: string, model: string) => {
    if (switching) return;
    setSwitching(`${provider}/${model}`);
    try {
      await settingsApi.switchProvider(provider, model);
      await mutateCurrent();
      toast(`已切换到 ${model}`, "success");
      setOpen(false);
    } catch (e: any) {
      toast("切换失败: " + (e.message || "未知错误"), "error");
    } finally {
      setSwitching(null);
    }
  }, [switching, mutateCurrent]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-secondary hover:border-primary hover:text-text transition ${
          compact ? "max-w-[180px]" : "max-w-[260px]"
        }`}
        title={currentLabel}
      >
        <Cpu size={12} className="shrink-0" />
        <span className="truncate">{currentLabel}</span>
        <ChevronDown size={10} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-72 max-h-80 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
          {providersError && (
            <div className="px-3 py-3 text-xs text-red-500">加载失败: {providersError.message}</div>
          )}

          {!providers && !providersError && (
            <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-text-secondary">
              <Loader2 size={14} className="animate-spin" />
              加载中...
            </div>
          )}

          {providers && configuredProviders.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-text-secondary">
              <p>未检测到可用模型</p>
              <p className="mt-1 text-[10px] text-gray-400">请在 .env 中配置 API Key 后重启服务</p>
            </div>
          )}

          {configuredProviders.map((provider) => (
            <ProviderModels
              key={provider.name}
              provider={provider}
              current={current}
              switching={switching}
              onSelect={handleSwitch}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProviderModels({
  provider,
  current,
  switching,
  onSelect,
}: {
  provider: LLMProvider;
  current: CurrentProvider | undefined;
  switching: string | null;
  onSelect: (provider: string, model: string) => void;
}) {
  const { data, isLoading } = useSWR(
    `models-${provider.name}`,
    () => settingsApi.listModels(provider.name),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const models = data?.models ?? provider.models;

  return (
    <div>
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-text-secondary bg-gray-50 dark:bg-gray-800">
        {provider.label}
        {data?.source === "remote" && (
          <span className="normal-case tracking-normal text-green-600 dark:text-green-400">· 已同步</span>
        )}
        {isLoading && <Loader2 size={10} className="animate-spin" />}
      </div>
      {models.map((model) => {
        const isActive = current?.provider === provider.name && current?.model === model;
        const isSwitching = switching === `${provider.name}/${model}`;
        return (
          <button
            key={model}
            onClick={() => onSelect(provider.name, model)}
            disabled={!!switching || isActive}
            className={`flex w-full items-center gap-2 px-3 py-2 text-xs transition hover:bg-gray-50 dark:hover:bg-gray-800 ${
              isActive ? "text-primary font-medium" : "text-text"
            } ${switching && !isActive ? "opacity-50" : ""}`}
          >
            <span className="flex-1 text-left truncate">{model}</span>
            {isSwitching && <Loader2 size={12} className="animate-spin shrink-0" />}
            {isActive && !isSwitching && <Check size={12} className="text-primary shrink-0" />}
          </button>
        );
      })}
    </div>
  );
}
