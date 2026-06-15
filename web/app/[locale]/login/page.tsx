"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { mutate } from "swr";
import { useTranslations } from "next-intl";
import { useAuthStore } from "@/lib/store";
import { authApi } from "@/lib/api";
import { translateBackendError } from "@/lib/backend-errors";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

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
  const [qrUrl, setQrUrl] = useState("");
  const [qrError, setQrError] = useState("");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const redirectUri = window.location.origin + "/auth/callback?mode=iframe";
    authApi
      .wechatQrUrl(redirectUri)
      .then(({ authorize_url }) => setQrUrl(authorize_url))
      .catch(() => setQrError(t("wechatNotConfigured")));
  }, [t]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "wechat-login-code" && e.data.code) {
        handleWeChatCode(e.data.code);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const handleWeChatCode = async (code: string) => {
    setLoading(true);
    setError("");
    try {
      const { access_token } = await authApi.webOAuthLogin(code);
      setToken(access_token);
      mutate(() => true, undefined, { revalidate: false });
      router.replace("/workspaces");
    } catch (e: any) {
      setError(translateBackendError(e.message, tBackend) || t("wechatLoginFailed"));
    } finally {
      setLoading(false);
    }
  };

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

  const handleDevLogin = async () => {
    setLoading(true);
    setError("");
    try {
      const { access_token } = await authApi.devLogin("WebUser");
      setToken(access_token);
      mutate(() => true, undefined, { revalidate: false });
      router.replace("/workspaces");
    } catch (e: any) {
      setError(translateBackendError(e.message, tBackend) || t("loginFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-bg">
      <div className="absolute right-4 top-4">
        <LanguageSwitcher />
      </div>
      <div className="flex w-full max-w-3xl overflow-hidden rounded-card bg-surface shadow-lg">
        <div className="w-full max-w-sm p-8">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-text">MindCard</h1>
            <p className="mt-1 text-sm text-text-secondary">{t("subtitle")}</p>
          </div>

          <div className="mb-5 flex rounded-lg bg-bg p-1">
            <button
              type="button"
              onClick={() => { setMode("login"); setError(""); }}
              className={`flex-1 rounded-md py-1.5 text-sm font-medium transition ${
                mode === "login" ? "bg-surface text-text shadow-sm" : "text-text-secondary"
              }`}
            >
              {t("login")}
            </button>
            <button
              type="button"
              onClick={() => { setMode("register"); setError(""); }}
              className={`flex-1 rounded-md py-1.5 text-sm font-medium transition ${
                mode === "register" ? "bg-surface text-text shadow-sm" : "text-text-secondary"
              }`}
            >
              {t("register")}
            </button>
          </div>

          {error && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-danger">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">{t("username")}</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t("usernamePlaceholder")}
                required
                minLength={3}
                maxLength={32}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text outline-none transition focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">{t("password")}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("passwordPlaceholder")}
                required
                minLength={6}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text outline-none transition focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>

            {mode === "register" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-text-secondary">{t("nickname")}</label>
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder={t("nicknamePlaceholder")}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text outline-none transition focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-primary py-2.5 text-sm font-medium text-white transition hover:bg-primary-dark disabled:opacity-50"
            >
              {loading ? tCommon("processing") : mode === "register" ? t("register") : t("login")}
            </button>
          </form>

          <div className="mt-3 flex items-center gap-2">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[10px] text-text-secondary">{t("or")}</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <button
            onClick={handleDevLogin}
            disabled={loading}
            className="mt-3 w-full rounded-xl border border-border py-2 text-xs text-text-secondary transition hover:bg-bg disabled:opacity-50"
          >
            {t("devLogin")}
          </button>
        </div>

        <div className="hidden w-[320px] flex-shrink-0 flex-col items-center justify-center border-l border-border bg-gray-50/50 p-6 sm:flex">
          <p className="mb-4 text-sm font-medium text-text">{t("wechatScanLogin")}</p>
          <div className="relative h-[260px] w-[260px] overflow-hidden rounded-xl bg-surface shadow-sm">
            {qrError ? (
              <div className="flex h-full w-full items-center justify-center p-4">
                <div className="text-center">
                  <p className="mb-1 text-3xl">🔐</p>
                  <p className="text-xs text-text-secondary">{qrError}</p>
                </div>
              </div>
            ) : qrUrl ? (
              <iframe
                ref={iframeRef}
                src={qrUrl}
                className="h-full w-full border-0"
                title={t("wechatScanLogin")}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <div className="text-center">
                  <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-primary" />
                  <p className="text-xs text-text-secondary">{tCommon("loading")}</p>
                </div>
              </div>
            )}
          </div>
          <p className="mt-4 text-center text-[11px] text-text-secondary">
            {t("scanToLogin")}
          </p>
        </div>
      </div>
    </div>
  );
}
