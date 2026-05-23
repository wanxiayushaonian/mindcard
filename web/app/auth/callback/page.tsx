"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthStore } from "@/lib/store";
import { authApi } from "@/lib/api";

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setToken = useAuthStore((s) => s.setToken);
  const [status, setStatus] = useState("正在登录...");

  useEffect(() => {
    const code = searchParams.get("code");
    const isIframe = searchParams.get("mode") === "iframe";

    if (!code) {
      setStatus("登录失败：未收到授权码");
      return;
    }

    // If inside an iframe (QR code login), send code to parent window
    if (isIframe || (window !== window.parent)) {
      window.parent.postMessage({ type: "wechat-login-code", code }, window.location.origin);
      setStatus("扫码成功，请稍候...");
      return;
    }

    // Standalone callback (direct redirect)
    authApi
      .webOAuthLogin(code)
      .then(({ access_token }) => {
        setToken(access_token);
        setStatus("登录成功，正在跳转...");
        setTimeout(() => router.replace("/workspaces"), 500);
      })
      .catch((err) => {
        setStatus("登录失败：" + (err.message || "未知错误"));
      });
  }, [searchParams, setToken, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <div className="w-full max-w-sm rounded-card bg-surface p-8 text-center shadow-sm">
        <h1 className="text-xl font-bold text-text">MindCard</h1>
        <p className="mt-4 text-sm text-text-secondary">{status}</p>
        {status.includes("失败") && (
          <button
            onClick={() => router.replace("/login")}
            className="mt-4 rounded-lg bg-primary px-6 py-2 text-sm text-white"
          >
            返回登录
          </button>
        )}
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-bg">
          <p className="text-sm text-text-secondary">加载中...</p>
        </div>
      }
    >
      <CallbackContent />
    </Suspense>
  );
}
