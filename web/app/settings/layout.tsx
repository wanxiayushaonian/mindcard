"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Cpu, Key, ArrowLeft, Languages, GitFork } from "lucide-react";

const NAV_ITEMS = [
  { href: "/settings/models", label: "模型设置", icon: Cpu },
  { href: "/settings/api-keys", label: "API Key", icon: Key },
  { href: "/settings/extraction", label: "图谱提取", icon: Languages },
  { href: "/settings/fork", label: "对话分叉", icon: GitFork },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-bg">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-border bg-surface px-3 py-6">
        <Link
          href="/workspaces"
          className="mb-6 flex items-center gap-1.5 px-2 text-xs text-text-secondary hover:text-primary transition"
        >
          <ArrowLeft size={12} />
          返回空间
        </Link>
        <nav className="flex flex-col gap-0.5">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
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
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
