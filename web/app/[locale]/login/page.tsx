"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { mutate } from "swr";
import { useTranslations } from "next-intl";
import { AtSign, Cpu, GitBranch, Lock, MessageSquare, Search, Sparkles, User } from "lucide-react";
import { useAuthStore } from "@/lib/store";
import { authApi } from "@/lib/api";
import { translateBackendError } from "@/lib/backend-errors";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";

const FEATURES = [
  { icon: MessageSquare, titleKey: "featureAITitle", descKey: "featureAIDesc" },
  { icon: Search, titleKey: "featureRagTitle", descKey: "featureRagDesc" },
  { icon: GitBranch, titleKey: "featureTopologyTitle", descKey: "featureTopologyDesc" },
  { icon: Cpu, titleKey: "featureMultiModelTitle", descKey: "featureMultiModelDesc" },
] as const;

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslations("auth");
  const tCommon = useTranslations("common");
  const tBackend = useTranslations("backendError");
  const setToken = useAuthStore((s) => s.setToken);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { access_token } =
        mode === "register"
          ? await authApi.register(username, password, nickname || username)
          : await authApi.login(username, password);
      setToken(access_token);
      mutate(() => true, undefined, { revalidate: false });
      router.replace("/workspaces");
    } catch (err: any) {
      setError(translateBackendError(err.message, tBackend) || t("loginFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg px-4 py-10">
      {/* Soft brand-tinted ambient background */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -right-40 -top-40 h-96 w-96 rounded-full bg-primary-light/40 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-primary-light/25 blur-3xl" />
        <div className="absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/5 blur-2xl" />
      </div>

      {/* Top-right utilities */}
      <div className="absolute right-5 top-5 flex items-center gap-2">
        <ThemeToggle />
        <LanguageSwitcher />
      </div>

      {/* Main content: product showcase (lg) + auth card */}
      <div className="relative grid w-full max-w-4xl items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
        {/* Product showcase — hidden on small screens */}
        <div className="hidden lg:block">
          <div className="mb-10">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary-dark shadow-lg shadow-primary/30">
              <Sparkles className="h-7 w-7 text-white" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-text">MindCard</h1>
            <p className="mt-2 max-w-sm text-base leading-relaxed text-text-secondary">
              {t("tagline")}
            </p>
          </div>

          <div className="space-y-6">
            {FEATURES.map(({ icon: Icon, titleKey, descKey }) => (
              <div key={titleKey} className="flex items-start gap-4">
                <div className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-text">{t(titleKey)}</h3>
                  <p className="mt-1 max-w-xs text-xs leading-relaxed text-text-secondary">
                    {t(descKey)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Auth card */}
        <div className="rounded-card border border-border/50 bg-surface/90 p-8 shadow-xl shadow-primary/10 backdrop-blur-sm sm:p-10">
          {/* Brand — only shown on small screens (large screens show it in the left column) */}
          <div className="mb-8 flex flex-col items-center text-center lg:hidden">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary-dark shadow-lg shadow-primary/30">
              <Sparkles className="h-7 w-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-text">MindCard</h1>
            <p className="mt-1.5 text-sm text-text-secondary">{t("subtitle")}</p>
          </div>

          {/* Login / Register tabs */}
          <div className="mb-6 flex rounded-xl bg-bg p-1">
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError("");
                }}
                className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all duration-200 ${
                  mode === m
                    ? "bg-surface text-text shadow-sm"
                    : "text-text-secondary hover:text-text"
                }`}
              >
                {t(m)}
              </button>
            ))}
          </div>

          {error && (
            <div className="mb-5 rounded-xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                {t("username")}
              </label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary/60" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t("usernamePlaceholder")}
                  required
                  minLength={3}
                  maxLength={32}
                  autoComplete="username"
                  className="w-full rounded-xl border border-border bg-bg py-2.5 pl-9 pr-3 text-sm text-text outline-none transition placeholder:text-text-secondary/50 focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                {t("password")}
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary/60" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("passwordPlaceholder")}
                  required
                  minLength={6}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  className="w-full rounded-xl border border-border bg-bg py-2.5 pl-9 pr-3 text-sm text-text outline-none transition placeholder:text-text-secondary/50 focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>

            {mode === "register" && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                  {t("nickname")}
                </label>
                <div className="relative">
                  <AtSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary/60" />
                  <input
                    type="text"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder={t("nicknamePlaceholder")}
                    className="w-full rounded-xl border border-border bg-bg py-2.5 pl-9 pr-3 text-sm text-text outline-none transition placeholder:text-text-secondary/50 focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-gradient-to-r from-primary to-primary-dark py-2.5 text-sm font-medium text-white shadow-md shadow-primary/25 transition duration-200 hover:shadow-lg hover:shadow-primary/30 hover:brightness-105 active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
            >
              {loading ? tCommon("processing") : mode === "register" ? t("register") : t("login")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
