"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store";
import { authApi, type UserMe } from "@/lib/api";
import { LoadingState } from "@/components/LoadingState";

export default function ProfilePage() {
  const router = useRouter();
  const setToken = useAuthStore((s) => s.setToken);
  const [user, setUser] = useState<UserMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [binding, setBinding] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    authApi
      .me()
      .then(setUser)
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  const handleBindWeChat = async () => {
    setBinding(true);
    setMessage("");
    try {
      const redirectUri = window.location.origin + "/profile?bind=1";
      const { authorize_url } = await authApi.wechatQrUrl(redirectUri);
      window.location.href = authorize_url;
    } catch (e: any) {
      setMessage("获取绑定链接失败: " + (e.message || "未知错误"));
      setBinding(false);
    }
  };

  // Handle bind callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const isBind = params.get("bind");
    if (code && isBind === "1") {
      authApi
        .bindWechat(code)
        .then((res) => {
          setMessage(res.message);
          // Reload user info
          authApi.me().then(setUser);
          // Clean URL
          window.history.replaceState({}, "", "/profile");
        })
        .catch((e) => {
          setMessage("绑定失败: " + (e.message || "未知错误"));
          window.history.replaceState({}, "", "/profile");
        });
    }
  }, []);

  const handleLogout = () => {
    setToken(null);
    router.replace("/login");
  };

  if (loading) {
    return <LoadingState fullScreen />;
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-bg">
      <nav className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-surface/80 px-4 py-3 backdrop-blur-sm">
        <button onClick={() => router.back()} className="text-text-secondary hover:text-text">
          &larr;
        </button>
        <span className="text-lg font-bold text-text">个人中心</span>
      </nav>

      <div className="mx-auto max-w-lg px-4 py-8">
        {/* User info */}
        <div className="mb-6 rounded-card bg-surface p-6 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary-dark">
              {user.avatar_url ? (
                <img src={user.avatar_url} alt="" className="h-16 w-16 rounded-full" />
              ) : (
                user.nickname?.charAt(0) || "?"
              )}
            </div>
            <div>
              <h2 className="text-lg font-bold text-text">{user.nickname}</h2>
              {user.username && (
                <p className="text-sm text-text-secondary">@{user.username}</p>
              )}
              <p className="text-xs text-text-secondary">ID: {user.id.slice(0, 8)}...</p>
            </div>
          </div>
        </div>

        {/* WeChat binding */}
        <div className="mb-6 rounded-card bg-surface p-6 shadow-sm">
          <h3 className="mb-4 text-base font-bold text-text">微信绑定</h3>

          {message && (
            <div className="mb-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-700">{message}</div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-text">小程序微信</p>
                <p className="text-xs text-text-secondary">
                  {user.has_miniapp_wechat ? "已绑定" : "未绑定"}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  user.has_miniapp_wechat
                    ? "bg-green-100 text-green-700"
                    : "bg-gray-200 text-text-secondary"
                }`}
              >
                {user.has_miniapp_wechat ? "已绑定" : "未绑定"}
              </span>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-text">Web 微信</p>
                <p className="text-xs text-text-secondary">
                  {user.has_web_wechat ? "已绑定（可扫码登录）" : "未绑定"}
                </p>
              </div>
              {user.has_web_wechat ? (
                <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
                  已绑定
                </span>
              ) : (
                <button
                  onClick={handleBindWeChat}
                  disabled={binding}
                  className="rounded-lg bg-green-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-green-600 disabled:opacity-50"
                >
                  {binding ? "跳转中..." : "扫码绑定"}
                </button>
              )}
            </div>
          </div>

          <p className="mt-3 text-xs text-text-secondary">
            绑定微信后，Web 端可直接扫码登录，且与小程序端共享同一账号数据。
          </p>
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="w-full rounded-xl border border-red-200 py-3 text-sm font-medium text-red-500 transition hover:bg-red-50"
        >
          退出登录
        </button>
      </div>
    </div>
  );
}
