"use client";

import { useParams } from "next/navigation";
import useSWR from "swr";
import { activityApi, type Activity } from "@/lib/api";
import { LoadingState } from "@/components/LoadingState";
import { ErrorState } from "@/components/ErrorState";
import {
  FileText,
  MessageSquare,
  Link as LinkIcon,
  UserPlus,
  UserMinus,
  Shield,
} from "lucide-react";

const ACTION_CONFIG: Record<
  string,
  { icon: React.ReactNode; label: (a: Activity) => string }
> = {
  "card.created": {
    icon: <FileText size={14} />,
    label: (a) => `创建了卡片「${a.metadata?.card_title || "未命名"}」`,
  },
  "card.commented": {
    icon: <MessageSquare size={14} />,
    label: (a) => `评论了卡片「${a.metadata?.card_title || ""}」`,
  },
  "card.related": {
    icon: <LinkIcon size={14} />,
    label: (a) => `关联了卡片「${a.metadata?.card_title || ""}」`,
  },
  "member.joined": {
    icon: <UserPlus size={14} />,
    label: (a) => `加入了空间`,
  },
  "member.left": {
    icon: <UserMinus size={14} />,
    label: (a) => {
      if (a.metadata?.removed_by) return `被 ${a.metadata.removed_by} 移出了空间`;
      return `退出了空间`;
    },
  },
  "member.role_changed": {
    icon: <Shield size={14} />,
    label: (a) => {
      const roleMap: Record<string, string> = {
        admin: "管理员",
        editor: "编辑者",
        viewer: "浏览者",
        pending: "待审批",
      };
      const oldRole = roleMap[a.metadata?.old_role || ""] || a.metadata?.old_role;
      const newRole = roleMap[a.metadata?.new_role || ""] || a.metadata?.new_role;
      return `的角色从 ${oldRole} 变更为 ${newRole}`;
    },
  },
};

export default function ActivitiesPage() {
  const params = useParams();
  const workspaceId = params.id as string;

  const {
    data: activities,
    isLoading,
    error,
    mutate: revalidate,
  } = useSWR(
    workspaceId ? `activities-${workspaceId}` : null,
    () => activityApi.list(workspaceId)
  );

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} onRetry={revalidate} />;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-6 text-lg font-bold text-text">空间动态</h1>

      {activities && activities.length === 0 && (
        <p className="py-20 text-center text-sm text-text-secondary">暂无动态记录</p>
      )}

      {activities && activities.length > 0 && (
        <div className="flex flex-col gap-1">
          {activities.map((a) => {
            const config = ACTION_CONFIG[a.action] || {
              icon: <FileText size={14} />,
              label: () => a.action,
            };
            return (
              <div
                key={a.id}
                className="flex items-start gap-3 rounded-xl px-4 py-3 transition hover:bg-gray-50"
              >
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary-dark">
                  {config.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-text">
                    <span className="font-medium">{a.actor_nickname || "匿名用户"}</span>
                    {config.label(a)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-text-secondary">
                    {formatTime(a.created_at)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return d.toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
