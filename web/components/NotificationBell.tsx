"use client";

import { useState, useRef, useEffect } from "react";
import useSWR, { mutate } from "swr";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { notificationApi, type Notification } from "@/lib/api";
import { toast } from "@/lib/toast";
import { useTranslations, useLocale } from "next-intl";
import { formatRelativeTime } from "@/lib/format";

export function NotificationBell({ workspaceId }: { workspaceId?: string }) {
  const t = useTranslations("notification");
  const tc = useTranslations("common");
  const tt = useTranslations("toast");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: countData } = useSWR(
    "notif-unread-count",
    () => notificationApi.unreadCount(),
    { refreshInterval: 30000 }
  );
  const unreadCount = countData?.count || 0;

  const { data: notifications, isLoading } = useSWR(
    open ? "notif-list" : null,
    () => notificationApi.list()
  );

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleClick = async (n: Notification) => {
    if (!n.is_read) {
      try {
        await notificationApi.markRead(n.id);
        mutate("notif-unread-count");
        mutate("notif-list");
      } catch {}
    }
    if (n.link) {
      setOpen(false);
      router.push(n.link);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationApi.markAllRead();
      mutate("notif-unread-count");
      mutate("notif-list");
    } catch (e: any) {
      toast(tt("operationFailed", { error: e.message }), "error");
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-text-secondary hover:bg-gray-100"
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-xl border border-border bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-sm font-semibold text-text">{t("title")}</span>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-primary hover:underline"
              >
                {t("markAllReadBtn")}
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {isLoading && (
              <p className="py-6 text-center text-xs text-text-secondary">{t("loading")}</p>
            )}
            {notifications && notifications.length === 0 && (
              <p className="py-6 text-center text-xs text-text-secondary">{t("noNotifications")}</p>
            )}
            {notifications?.map((n) => (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className={`flex w-full items-start gap-2.5 border-b border-border/50 px-4 py-3 text-left transition hover:bg-gray-50 ${
                  n.is_read ? "bg-white" : "bg-blue-50/50"
                }`}
              >
                {!n.is_read && (
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                )}
                <div className={`min-w-0 flex-1 ${n.is_read ? "pl-3.5" : ""}`}>
                  <p className="text-xs text-text">{n.content}</p>
                  <p className="mt-0.5 text-[10px] text-text-secondary">
                    {formatRelativeTime(n.created_at, locale)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
