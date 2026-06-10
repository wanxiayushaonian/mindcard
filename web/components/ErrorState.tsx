"use client";

import { useTranslations } from "next-intl";

export function ErrorState({
  message,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  const t = useTranslations("common");
  const displayMessage = message || t("loadFailed");

  return (
    <div className="flex flex-col items-center gap-3 p-8 text-center">
      <svg className="h-10 w-10 text-danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4m0 4h.01" strokeLinecap="round" />
      </svg>
      <p className="text-sm text-text-secondary">{displayMessage}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded-lg bg-primary/10 px-4 py-2 text-sm font-medium text-primary-dark hover:bg-primary/20"
        >
          {t("retry")}
        </button>
      )}
    </div>
  );
}
