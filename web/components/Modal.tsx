"use client";

import { useEffect, useRef } from "react";

interface ModalProps {
  title: string;
  onClose: () => void;
  onConfirm?: () => void;
  confirmText?: string;
  confirmDisabled?: boolean;
  loading?: boolean;
  size?: "sm" | "md" | "lg";
  children: React.ReactNode;
}

const sizeClasses = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg" };

export function Modal({
  title,
  onClose,
  onConfirm,
  confirmText = "确认",
  confirmDisabled = false,
  loading = false,
  size = "md",
  children,
}: ModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    containerRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 outline-none"
      onClick={onClose}
    >
      <div
        className={`w-full ${sizeClasses[size]} max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="modal-title" className="mb-4 text-lg font-bold text-text">{title}</h2>
        {children}
        <div className="mt-4 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm text-text-secondary hover:bg-gray-100"
          >
            取消
          </button>
          {onConfirm && (
            <button
              onClick={onConfirm}
              disabled={confirmDisabled || loading}
              className="rounded-xl bg-primary px-6 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading ? "处理中..." : confirmText}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
