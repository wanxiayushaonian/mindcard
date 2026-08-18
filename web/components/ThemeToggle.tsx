"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { useTranslations } from "next-intl";

export function ThemeToggle() {
  const t = useTranslations("theme");
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    // Light by default; dark only when the user explicitly chose it.
    const isDark = stored ? stored === "dark" : false;
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
    // Keep the cookie in sync so server-rendered <html className> matches on
    // the next RSC refresh (locale switch etc.) — otherwise React resets the
    // `.dark` class it does not know about.
    document.cookie = `theme=${next ? "dark" : "light"};path=/;max-age=31536000`;
  };

  return (
    <button
      onClick={toggle}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
      title={dark ? t("toggleToLight") : t("toggleToDark")}
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
