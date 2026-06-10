"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  title,
  message,
  confirmText,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const t = useTranslations("common");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKey);
    containerRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 outline-none"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="mb-2 text-lg font-bold text-text">{title}</h2>
        <p className="mb-6 text-sm text-text-secondary">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-xl px-4 py-2 text-sm text-text-secondary hover:bg-gray-100"
          >
            {t("cancel")}
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-xl px-6 py-2 text-sm font-medium text-white ${
              danger ? "bg-danger hover:bg-red-600" : "bg-primary hover:bg-primary-dark"
            }`}
          >
            {confirmText || t("confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
