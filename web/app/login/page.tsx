"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store";
import { authApi } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const setToken = useAuthStore((s) => s.setToken);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleDevLogin = async () => {
    setLoading(true);
    setError("");
    try {
      const { access_token } = await authApi.devLogin("Web用户");
      setToken(access_token);
      router.replace("/workspaces");
    } catch (e: any) {
      setError(e.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <div className="w-full max-w-sm rounded-card bg-surface p-8 shadow-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-text">MindCard</h1>
          <p className="mt-2 text-sm text-text-secondary">灵感卡片管理平台</p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-danger">{error}</div>
        )}

        <button
          onClick={handleDevLogin}
          disabled={loading}
          className="w-full rounded-xl bg-primary py-3 font-medium text-white transition hover:bg-primary-dark disabled:opacity-50"
        >
          {loading ? "登录中..." : "开发登录"}
        </button>

        <p className="mt-6 text-center text-xs text-text-secondary">
          开发模式 · 免微信认证
        </p>
      </div>
    </div>
  );
}
