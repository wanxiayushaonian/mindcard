"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("common");

  const toggle = () => {
    const next = locale === "zh" ? "en" : "zh";
    document.cookie = `NEXT_LOCALE=${next};path=/;max-age=31536000`;
    router.refresh();
  };

  return (
    <button
      onClick={toggle}
      className="rounded-lg px-2 py-1 text-xs text-text-secondary hover:bg-muted"
      title={locale === "zh" ? t("switchToEn") : t("switchToZh")}
    >
      {locale === "zh" ? "EN" : "中"}
    </button>
  );
}
