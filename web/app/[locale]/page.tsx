"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight, Sparkles, GitBranch, Network, Brain, Search, Zap } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuthStore } from "@/lib/store";

const LOOP_STEPS = [
  { icon: Zap, titleKey: "loop1Title", descKey: "loop1Desc", color: "text-amber-500 bg-amber-500/10" },
  { icon: Network, titleKey: "loop2Title", descKey: "loop2Desc", color: "text-emerald-500 bg-emerald-500/10" },
  { icon: Brain, titleKey: "loop3Title", descKey: "loop3Desc", color: "text-blue-500 bg-blue-500/10" },
  { icon: Sparkles, titleKey: "loop4Title", descKey: "loop4Desc", color: "text-purple-500 bg-purple-500/10" },
] as const;

const FEATURES = [
  { icon: GitBranch, titleKey: "feature1Title", descKey: "feature1Desc" },
  { icon: Network, titleKey: "feature2Title", descKey: "feature2Desc" },
  { icon: Brain, titleKey: "feature3Title", descKey: "feature3Desc" },
  { icon: Search, titleKey: "feature4Title", descKey: "feature4Desc" },
] as const;

export default function LandingPage() {
  const router = useRouter();
  const t = useTranslations("landing");
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const handleStart = () => router.push(isAuthenticated ? "/workspaces" : "/login");

  return (
    <div className="relative min-h-screen overflow-hidden bg-bg">
      {/* Soft brand-tinted ambient background */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -right-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-primary-light/40 blur-3xl" />
        <div className="absolute -bottom-48 -left-40 h-[30rem] w-[30rem] rounded-full bg-primary-light/25 blur-3xl" />
        <div className="absolute left-1/2 top-1/3 h-96 w-96 -translate-x-1/2 rounded-full bg-primary/5 blur-2xl" />
      </div>

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between px-5 py-4 sm:px-8">
        <div className="flex items-center gap-2.5">
          <Image
            src="/icon-192.png"
            alt="MindCard"
            width={30}
            height={30}
            priority
            className="rounded-lg shadow-md shadow-primary/30"
          />
          <span className="text-lg font-bold tracking-tight text-text">MindCard</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LanguageSwitcher />
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-5xl px-5 pb-20 sm:px-8">
        {/* Hero */}
        <section className="flex flex-col items-center pt-14 text-center sm:pt-20">
          <span className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs text-primary-dark">
            <Sparkles size={12} />
            {t("badge")}
          </span>
          <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight text-text sm:text-5xl">
            {t("tagline")}
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-text-secondary">
            {t("loopSubtitle")}
          </p>
          <div className="mt-8 flex items-center gap-3">
            <button
              onClick={handleStart}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-accent to-accent-dark px-6 py-3 text-sm font-medium text-white shadow-lg shadow-primary/25 transition hover:brightness-105 active:scale-[0.98]"
            >
              {t("ctaStart")}
              <ArrowRight size={16} />
            </button>
            {!isAuthenticated && (
              <button
                onClick={() => router.push("/login")}
                className="rounded-xl border border-border bg-surface/80 px-6 py-3 text-sm text-text-secondary transition hover:border-primary/30 hover:text-text"
              >
                {t("ctaLogin")}
              </button>
            )}
          </div>
        </section>

        {/* Core loop */}
        <section className="mt-24">
          <h2 className="text-center text-2xl font-bold tracking-tight text-text">{t("loopTitle")}</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {LOOP_STEPS.map(({ icon: Icon, titleKey, descKey, color }, i) => (
              <div
                key={titleKey}
                className="relative rounded-card border border-border/50 bg-surface/80 p-5 backdrop-blur-sm"
              >
                {i < LOOP_STEPS.length - 1 && (
                  <div className="absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 text-text-secondary/50 lg:block">
                    <ArrowRight size={14} />
                  </div>
                )}
                <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl ${color}`}>
                  <Icon size={18} />
                </div>
                <h3 className="text-sm font-semibold text-text">{t(titleKey)}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">{t(descKey)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section className="mt-24">
          <h2 className="text-center text-2xl font-bold tracking-tight text-text">{t("featuresTitle")}</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {FEATURES.map(({ icon: Icon, titleKey, descKey }) => (
              <div
                key={titleKey}
                className="flex items-start gap-4 rounded-card border border-border/50 bg-surface/80 p-5 backdrop-blur-sm"
              >
                <div className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-text">{t(titleKey)}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-text-secondary">{t(descKey)}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="mt-24 flex flex-col items-center">
          <button
            onClick={handleStart}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-accent to-accent-dark px-8 py-3.5 text-sm font-medium text-white shadow-lg shadow-primary/25 transition hover:brightness-105 active:scale-[0.98]"
          >
            {t("ctaStart")}
            <ArrowRight size={16} />
          </button>
        </section>
      </main>

      <footer className="relative z-10 border-t border-border/50 py-6 text-center text-xs text-text-secondary/60">
        {t("footer")}
      </footer>
    </div>
  );
}
