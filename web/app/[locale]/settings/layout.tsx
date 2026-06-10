"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Cpu, Key, ArrowLeft, Languages, GitFork } from "lucide-react";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const t = useTranslations("settings");

  const navItems = [
    { href: "/settings/models", label: t("modelSettings"), icon: Cpu },
    { href: "/settings/api-keys", label: t("apiKeys"), icon: Key },
    { href: "/settings/extraction", label: t("extraction"), icon: Languages },
    { href: "/settings/fork", label: t("forkSettings"), icon: GitFork },
  ];

  return (
    <div className="flex min-h-screen bg-bg">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-border bg-surface px-3 py-6">
        <Link
          href="/workspaces"
          className="mb-6 flex items-center gap-1.5 px-2 text-xs text-text-secondary hover:text-primary transition"
        >
          <ArrowLeft size={12} />
          {t("backToSpace")}
        </Link>
        <nav className="flex flex-col gap-0.5">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                  active
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-text-secondary hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-text"
                }`}
              >
                <Icon size={15} />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto px-2 pt-4">
          <LanguageSwitcher />
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
