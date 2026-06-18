"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Card } from "@/lib/api";
import { MarkdownContent } from "@/components/MarkdownContent";
import { TagChip } from "@/components/TagChip";

interface CardHoverPreviewProps {
  card: Card;
  topicName?: string;
  topicColor?: string;
  children: React.ReactNode;
}

const SHOW_DELAY = 500;
const HIDE_DELAY = 200;
const POPOVER_MAX_WIDTH = 380;
const POPOVER_MAX_HEIGHT = 500;
const POPOVER_OFFSET = 12;

export function CardHoverPreview({ card, topicName, topicColor, children }: CardHoverPreviewProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const anchorRef = useRef<HTMLDivElement>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout>>();
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();
  const popoverRef = useRef<HTMLDivElement>(null);

  const clearTimers = useCallback(() => {
    clearTimeout(showTimer.current);
    clearTimeout(hideTimer.current);
  }, []);

  const calculatePosition = useCallback(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    let top = rect.top;
    let left = rect.right + POPOVER_OFFSET;

    // 如果右侧空间不足，显示在左侧
    if (left + POPOVER_MAX_WIDTH > viewportW - 8) {
      left = rect.left - POPOVER_MAX_WIDTH - POPOVER_OFFSET;
    }
    // 如果左侧也不够，贴右边
    if (left < 8) {
      left = viewportW - POPOVER_MAX_WIDTH - 8;
    }

    // 垂直方向：如果底部超出，向上调整
    if (top + POPOVER_MAX_HEIGHT > viewportH - 8) {
      top = viewportH - POPOVER_MAX_HEIGHT - 8;
    }
    if (top < 8) {
      top = 8;
    }

    setPosition({ top, left });
  }, []);

  const handleMouseEnter = useCallback(() => {
    clearTimers();
    showTimer.current = setTimeout(() => {
      calculatePosition();
      setVisible(true);
    }, SHOW_DELAY);
  }, [clearTimers, calculatePosition]);

  const handleMouseLeave = useCallback(() => {
    clearTimers();
    hideTimer.current = setTimeout(() => {
      setVisible(false);
    }, HIDE_DELAY);
  }, [clearTimers]);

  // 清理定时器
  useEffect(() => clearTimers, [clearTimers]);

  return (
    <>
      <div
        ref={anchorRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </div>
      {visible &&
        createPortal(
          <div
            ref={popoverRef}
            className="fixed z-[9999] max-h-[500px] w-[380px] overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
            style={{ top: position.top, left: position.left }}
            onMouseEnter={() => {
              clearTimers();
              setVisible(true);
            }}
            onMouseLeave={handleMouseLeave}
          >
            {/* 头部：标题 + 主题 */}
            <div className="border-b border-border px-4 pt-4 pb-2">
              {topicName && (
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: topicColor || "#6366f1" }}
                  />
                  <span className="text-[10px] text-text-secondary">{topicName}</span>
                </div>
              )}
              {card.title && (
                <h4 className="truncate font-semibold text-text">{card.title}</h4>
              )}
              {card.emotion_tag && (
                <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] text-text-secondary">
                  {card.emotion_tag}
                </span>
              )}
            </div>

            {/* 内容区 */}
            <div className="max-h-[380px] overflow-y-auto px-4 py-3 [&_*]:!text-sm [&_*]:!leading-relaxed">
              <MarkdownContent content={card.content} />
            </div>

            {/* 底部：关键词 + 时间 */}
            {(card.keywords.length > 0 || card.created_at) && (
              <div className="border-t border-border px-4 py-2">
                <div className="flex items-start gap-2">
                  {card.keywords.length > 0 && (
                    <div className="flex min-w-0 flex-wrap gap-1">
                      {card.keywords.slice(0, 5).map((kw) => (
                        <TagChip key={kw} label={kw} color={card.color} />
                      ))}
                    </div>
                  )}
                  {card.created_at && (
                    <span className="ml-auto shrink-0 text-[10px] text-text-secondary/60">
                      {new Date(card.created_at).toLocaleDateString("zh-CN")}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
