"use client";

import { useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Adjust position to stay within viewport
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (rect.right > vw) {
      ref.current.style.left = `${vw - rect.width - 4}px`;
    }
    if (rect.bottom > vh) {
      ref.current.style.top = `${vh - rect.height - 4}px`;
    }
  }, []);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[9999] min-w-[140px] rounded-lg border border-border bg-surface py-1 shadow-lg"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={() => {
            if (!item.disabled) {
              item.onClick();
              onClose();
            }
          }}
          disabled={item.disabled}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs transition ${
            item.disabled
              ? "cursor-not-allowed text-gray-400"
              : item.danger
                ? "text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                : "text-text hover:bg-gray-50 dark:hover:bg-gray-800"
          }`}
        >
          {item.icon && <span className="shrink-0">{item.icon}</span>}
          {item.label}
        </button>
      ))}
    </div>,
    document.body
  );
}
