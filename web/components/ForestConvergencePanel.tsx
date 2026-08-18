"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";
import { createWSUrl, UnifiedWSClient, type StreamEvent } from "@/lib/unified-ws";
import SimpleMarkdownRenderer from "@/components/SimpleMarkdownRenderer";
import { Sparkles, Square, Loader2 } from "lucide-react";

interface WalkStep {
  tool: string;
  detail: string;
  done: boolean;
}

function stepDetail(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case "topology_forest_map":
      return "🌳 加载整片森林地图";
    case "get_node_detail":
      return `🔍 查看节点 ${String(args.node_id || "…").slice(0, 8)}…`;
    case "get_node_subtree":
      return `🌿 加载子树 ${String(args.node_id || "…").slice(0, 8)}…`;
    case "get_card_relations":
      return `🔗 查看卡片关系 ${String(args.card_id || "…").slice(0, 8)}…`;
    default:
      return `⚙️ ${tool}`;
  }
}

/**
 * Forest-level convergence panel (VISION 理念6 阶段1): sends a synthesis goal
 * over the WS, streams the agent's tree-walk (tool events) on the left and the
 * streaming report on the right.
 */
export function ForestConvergencePanel({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("synthesis");
  const [goal, setGoal] = useState("");
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<WalkStep[]>([]);
  const [report, setReport] = useState("");
  const [error, setError] = useState("");
  const wsRef = useRef<UnifiedWSClient | null>(null);

  const handleEvent = useCallback((event: StreamEvent) => {
    switch (event.type) {
      case "tool_executing":
        setSteps((prev) => [
          ...prev,
          {
            tool: event.tool_name || "?",
            detail: stepDetail(event.tool_name || "", event.arguments || {}),
            done: false,
          },
        ]);
        break;
      case "tool_executed":
        setSteps((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last) last.done = true;
          return next;
        });
        break;
      case "content":
        if (event.content) setReport((prev) => prev + event.content);
        break;
      case "synthesis_complete":
        setRunning(false);
        break;
      case "synthesis_error":
      case "error":
        setError(event.message || event.content || "收敛失败");
        setRunning(false);
        break;
    }
  }, []);

  const run = useCallback(() => {
    if (!goal.trim() || running) return;
    setRunning(true);
    setSteps([]);
    setReport("");
    setError("");
    const ws = new UnifiedWSClient(
      createWSUrl("/api/ws"),
      handleEvent,
      () => {
        setError(t("connectionLost"));
        setRunning(false);
      }
    );
    wsRef.current = ws;
    ws.connect();
    ws.send({ type: "synthesis", goal: goal.trim(), workspace_id: workspaceId });
  }, [goal, running, workspaceId, handleEvent, t]);

  const stop = useCallback(() => {
    wsRef.current?.disconnect();
    wsRef.current = null;
    setRunning(false);
  }, []);

  useEffect(() => () => wsRef.current?.disconnect(), []);

  return (
    <div className="flex h-full flex-col">
      {/* Goal input */}
      <div className="border-b border-border bg-gray-50/60 p-4 dark:bg-gray-900/30">
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder={t("forestGoalPlaceholder")}
          className="w-full resize-none rounded-xl border border-border bg-bg px-3 py-2 text-sm text-text outline-none focus:border-primary"
          rows={2}
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={running ? stop : run}
            disabled={!goal.trim() && !running}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs text-white transition hover:bg-accent-dark disabled:opacity-50"
          >
            {running ? (
              <>
                <Square size={12} /> {t("stopConvergence")}
              </>
            ) : (
              <>
                <Sparkles size={12} /> {t("startConvergence")}
              </>
            )}
          </button>
          {running && (
            <span className="flex items-center gap-1.5 text-xs text-text-secondary">
              <Loader2 size={12} className="animate-spin" /> {t("exploring")}
            </span>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Walk log */}
        <div className="w-64 shrink-0 overflow-y-auto border-r border-border p-3">
          <p className="mb-2 text-[11px] font-medium text-text-secondary">{t("walkLog")}</p>
          {steps.length === 0 && (
            <p className="text-xs text-text-secondary/60">{t("walkLogEmpty")}</p>
          )}
          <div className="space-y-1.5">
            {steps.map((s, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs">
                {s.done ? (
                  <span className="mt-0.5 text-green-500">✓</span>
                ) : (
                  <Loader2 size={12} className="mt-0.5 animate-spin text-primary" />
                )}
                <span className="text-text">{s.detail}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Report */}
        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-3 rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}
          {report ? (
            <SimpleMarkdownRenderer content={report} className="prose-sm" />
          ) : (
            <p className="text-sm text-text-secondary/70">{t("reportEmpty")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
