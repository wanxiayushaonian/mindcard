"use client";

import { useState, useCallback } from "react";
import {
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  GitBranch,
  Globe,
  Layers,
  Link,
  MessageSquare,
  Network,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { ContextDebugData } from "@/lib/unified-ws";

const LEVEL_NAMES = ["CHAT", "SEARCH", "EXPLORE", "CONTEXT", "INSIGHT"];
const LEVEL_COLORS = [
  "bg-gray-100 text-text-secondary",
  "bg-blue-100 text-blue-700",
  "bg-purple-100 text-purple-700",
  "bg-amber-100 text-amber-700",
  "bg-emerald-100 text-emerald-700",
];

function CollapsibleSection({
  title,
  icon,
  count,
  charCount,
  copyText,
  copyKey,
  copiedKey,
  onCopy,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count?: number;
  charCount?: number;
  copyText?: string;
  copyKey?: string;
  copiedKey: string | null;
  onCopy?: (key: string, text: string) => void;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations("contextDebug");
  const [open, setOpen] = useState(defaultOpen);
  const isCopied = copiedKey === copyKey;

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-text transition-colors hover:bg-gray-50"
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        {icon}
        <span className="flex-1">{title}</span>
        {charCount !== undefined && charCount > 0 && (
          <span className="rounded bg-gray-100 px-1 py-0.5 text-[10px] text-text-secondary">
            {charCount.toLocaleString()} {t("chars")}
          </span>
        )}
        {count !== undefined && (
          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-text-secondary">
            {count}
          </span>
        )}
        {copyText && copyKey && onCopy && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onCopy(copyKey, copyText); }}
            className="ml-0.5 rounded p-0.5 text-text-secondary transition hover:text-text"
            title={isCopied ? t("copied") : t("copy")}
          >
            {isCopied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          </button>
        )}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

interface CrossRef {
  node_id: string;
  title: string;
  ref_type: string;
  reason: string;
}

export function ContextDebugPanel({ data }: { data: ContextDebugData }) {
  const t = useTranslations("contextDebug");
  const [expanded, setExpanded] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const levelName = LEVEL_NAMES[data.retrieval_level] || "UNKNOWN";
  const levelColor = LEVEL_COLORS[data.retrieval_level] || LEVEL_COLORS[0];

  const handleCopy = useCallback((key: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000);
    });
  }, []);

  const totalContextChars =
    (data.entity_context?.length ?? 0) +
    (data.topology_context?.length ?? 0) +
    (data.community_context?.length ?? 0) +
    (data.branch_context?.length ?? 0) +
    (data.system_prompt?.length ?? 0);

  const renderTextBlock = useCallback((text: string) => {
    if (!text) return null;
    return (
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-[11px] leading-relaxed text-text">
        {text}
      </pre>
    );
  }, []);

  const sectionProps = { copiedKey, onCopy: handleCopy };

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border bg-surface text-xs">
      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-text-secondary transition-colors hover:bg-gray-50"
      >
        <Bug className="h-3 w-3" />
        <span className="font-medium">{t("title")}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${levelColor}`}>
          {levelName}
        </span>
        <span className="text-[10px]">
          {data.source_cards.length} {t("cardsUsed")}
        </span>
        {totalContextChars > 0 && (
          <span className="text-[10px] text-text-secondary/70">
            · {totalContextChars.toLocaleString()} {t("totalContext")}
          </span>
        )}
        <span className="ml-auto">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border">
          {/* Retrieval Level */}
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Zap className="h-3 w-3 text-text-secondary" />
            <span className="text-[10px] font-medium text-text-secondary">{t("retrievalLevel")}</span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${levelColor}`}>
              {levelName} (L{data.retrieval_level})
            </span>
          </div>

          {/* Source Cards */}
          <CollapsibleSection
            title={t("sourceCards")}
            icon={<Database className="h-3 w-3 text-text-secondary" />}
            count={data.source_cards.length}
            defaultOpen={true}
            {...sectionProps}
          >
            {data.source_cards.length === 0 ? (
              <p className="text-[11px] text-text-secondary">{t("noCards")}</p>
            ) : (
              <div className="space-y-1.5">
                {data.source_cards.map((card, i) => (
                  <div key={card.id} className="rounded bg-gray-50 p-2">
                    <div className="flex items-center gap-2">
                      {card.color && (
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: card.color }} />
                      )}
                      <span className="font-medium text-text">{card.title || t("untitled")}</span>
                      {data.card_scores[i] !== undefined && (
                        <span className="ml-auto rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary">
                          {(data.card_scores[i] * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                    {card.keywords?.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {card.keywords.map((kw) => (
                          <span key={kw} className="rounded bg-gray-100 px-1 py-0.5 text-[10px] text-text-secondary">
                            {kw}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="mt-1 line-clamp-3 text-[11px] text-text-secondary">
                      {card.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CollapsibleSection>

          {/* Reasoning Paths */}
          {data.reasoning_paths.length > 0 && (
            <CollapsibleSection
              title={t("reasoningPaths")}
              icon={<Network className="h-3 w-3 text-text-secondary" />}
              count={data.reasoning_paths.length}
              {...sectionProps}
            >
              <div className="space-y-1.5">
                {data.reasoning_paths.map((path, i) => (
                  <div key={i} className="rounded bg-gray-50 p-2">
                    <div className="flex items-center gap-1 text-[11px]">
                      {path.entities.map((entity, j) => (
                        <span key={j}>
                          {j > 0 && (
                            <span className="mx-1 text-text-secondary">
                              —{path.relations[j - 1] || "?"}→
                            </span>
                          )}
                          <span className="font-medium text-text">{entity}</span>
                        </span>
                      ))}
                      <span className="ml-auto text-[10px] text-text-secondary">
                        {(path.score * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* Entities */}
          {data.entities.length > 0 && (
            <CollapsibleSection
              title={t("entities")}
              icon={<Layers className="h-3 w-3 text-text-secondary" />}
              count={data.entities.length}
              {...sectionProps}
            >
              <div className="space-y-1.5">
                {data.entities.map((entity) => (
                  <div key={entity.entity_id} className="rounded bg-gray-50 p-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-text">{entity.name}</span>
                      {entity.entity_type && (
                        <span className="rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary">
                          {entity.entity_type}
                        </span>
                      )}
                    </div>
                    {entity.linked_card_titles.length > 0 && (
                      <p className="mt-1 text-[10px] text-text-secondary">
                        {t("linkedCards")}: {entity.linked_card_titles.join(", ")}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* Cross References */}
          {data.cross_refs?.length > 0 && (
            <CollapsibleSection
              title={t("crossRefs")}
              icon={<Link className="h-3 w-3 text-text-secondary" />}
              count={data.cross_refs.length}
              {...sectionProps}
            >
              <div className="space-y-1.5">
                {(data.cross_refs as CrossRef[]).map((ref, i) => (
                  <div key={i} className="rounded bg-gray-50 p-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-text">{ref.title || ref.node_id}</span>
                      {ref.ref_type && (
                        <span className="rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary">
                          {ref.ref_type}
                        </span>
                      )}
                    </div>
                    {ref.reason && (
                      <p className="mt-0.5 text-[10px] text-text-secondary">{ref.reason}</p>
                    )}
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* Topology Path */}
          {data.topology_path.length > 0 && (
            <CollapsibleSection
              title={t("topologyPath")}
              icon={<GitBranch className="h-3 w-3 text-text-secondary" />}
              count={data.topology_path.length}
              {...sectionProps}
            >
              <div className="flex flex-wrap items-center gap-1">
                {data.topology_path.map((node: any, i: number) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <span className="text-text-secondary">→</span>}
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-text">
                      {node.name || node.title || node.id || JSON.stringify(node)}
                    </span>
                  </span>
                ))}
              </div>
              {data.node_card_titles.length > 0 && (
                <p className="mt-2 text-[10px] text-text-secondary">
                  {t("nodeCards")}: {data.node_card_titles.join(", ")}
                </p>
              )}
            </CollapsibleSection>
          )}

          {/* Entity Context */}
          {data.entity_context && (
            <CollapsibleSection
              title={t("entityContext")}
              icon={<Layers className="h-3 w-3 text-text-secondary" />}
              charCount={data.entity_context.length}
              copyText={data.entity_context}
              copyKey="entity_context"
              {...sectionProps}
            >
              {renderTextBlock(data.entity_context)}
            </CollapsibleSection>
          )}

          {/* Topology Context */}
          {data.topology_context && (
            <CollapsibleSection
              title={t("topologyContext")}
              icon={<GitBranch className="h-3 w-3 text-text-secondary" />}
              charCount={data.topology_context.length}
              copyText={data.topology_context}
              copyKey="topology_context"
              {...sectionProps}
            >
              {renderTextBlock(data.topology_context)}
            </CollapsibleSection>
          )}

          {/* Community Context */}
          {data.community_context && (
            <CollapsibleSection
              title={t("communityContext")}
              icon={<Network className="h-3 w-3 text-text-secondary" />}
              charCount={data.community_context.length}
              copyText={data.community_context}
              copyKey="community_context"
              {...sectionProps}
            >
              {renderTextBlock(data.community_context)}
            </CollapsibleSection>
          )}

          {/* Branch Context */}
          {data.branch_context && (
            <CollapsibleSection
              title={t("branchContext")}
              icon={<GitBranch className="h-3 w-3 text-text-secondary" />}
              charCount={data.branch_context.length}
              copyText={data.branch_context}
              copyKey="branch_context"
              {...sectionProps}
            >
              {renderTextBlock(data.branch_context)}
            </CollapsibleSection>
          )}

          {/* Web Search Results */}
          {data.web_search_results.length > 0 && (
            <CollapsibleSection
              title={t("webSearch")}
              icon={<Globe className="h-3 w-3 text-text-secondary" />}
              count={data.web_search_results.length}
              {...sectionProps}
            >
              <div className="space-y-1.5">
                {data.web_search_results.map((result, i) => (
                  <div key={i} className="rounded bg-gray-50 p-2">
                    <a
                      href={result.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-medium text-primary hover:underline"
                    >
                      {result.title}
                    </a>
                    <p className="mt-0.5 line-clamp-2 text-[10px] text-text-secondary">
                      {result.snippet}
                    </p>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* System Prompt */}
          <CollapsibleSection
            title={t("systemPrompt")}
            icon={<MessageSquare className="h-3 w-3 text-text-secondary" />}
            charCount={data.system_prompt?.length}
            copyText={data.system_prompt}
            copyKey="system_prompt"
            {...sectionProps}
          >
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-[11px] leading-relaxed text-text">
              {data.system_prompt}
            </pre>
          </CollapsibleSection>
        </div>
      )}
    </div>
  );
}
