"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthStore } from "@/lib/store";
import { authApi } from "@/lib/api";
import { useTranslations } from "next-intl";

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setToken = useAuthStore((s) => s.setToken);
  const t = useTranslations("auth");
  const tCommon = useTranslations("common");
  const [status, setStatus] = useState(t("loggingIn"));
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    const code = searchParams.get("code");
    const isIframe = searchParams.get("mode") === "iframe";

    if (!code) {
      setStatus(t("loginFailedNoCode"));
      setIsError(true);
      return;
    }

    // If inside an iframe (QR code login), send code to parent window
    if (isIframe || (window !== window.parent)) {
      window.parent.postMessage({ type: "wechat-login-code", code }, window.location.origin);
      setStatus(t("scanSuccess"));
      return;
    }

    // Standalone callback (direct redirect)
    authApi
      .webOAuthLogin(code)
      .then(({ access_token }) => {
        setToken(access_token);
        setStatus(t("loginSuccess"));
        setTimeout(() => router.replace("/workspaces"), 500);
      })
      .catch((err) => {
        setStatus(t("loginFailedError", { error: err.message || tCommon("unknownError") }));
        setIsError(true);
      });
  }, [searchParams, setToken, router, t, tCommon]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <div className="w-full max-w-sm rounded-card bg-surface p-8 text-center shadow-sm">
        <h1 className="text-xl font-bold text-text">MindCard</h1>
        <p className="mt-4 text-sm text-text-secondary">{status}</p>
        {isError && (
          <button
            onClick={() => router.replace("/login")}
            className="mt-4 rounded-lg bg-accent px-6 py-2 text-sm text-white"
          >
            {t("backToLogin")}
          </button>
        )}
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  const tCommon = useTranslations("common");
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-bg">
          <p className="text-sm text-text-secondary">{tCommon("loading")}</p>
        </div>
      }
    >
      <CallbackContent />
    </Suspense>
  );
}
