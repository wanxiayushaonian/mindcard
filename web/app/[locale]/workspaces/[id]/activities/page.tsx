"use client";

import { useParams } from "next/navigation";
import useSWR from "swr";
import { useTranslations, useLocale } from "next-intl";
import { activityApi, type Activity } from "@/lib/api";
import { LoadingState } from "@/components/LoadingState";
import { ErrorState } from "@/components/ErrorState";
import { formatRelativeTime } from "@/lib/format";
import {
  FileText,
  MessageSquare,
  Link as LinkIcon,
  UserPlus,
  UserMinus,
  Shield,
} from "lucide-react";

const roleMap: Record<string, string> = {
  admin: "role.admin",
  editor: "role.editor",
  viewer: "role.viewer",
  pending: "role.pending",
};

function getActionConfig(
  t: ReturnType<typeof useTranslations>,
  tRole: ReturnType<typeof useTranslations>,
): Record<string, { icon: React.ReactNode; label: (a: Activity) => string }> {
  return {
    "card.created": {
      icon: <FileText size={14} />,
      label: (a) =>
        t("createdCard", { title: a.metadata?.card_title || t("anonymousUser") }),
    },
    "card.commented": {
      icon: <MessageSquare size={14} />,
      label: (a) =>
        t("commentedCard", { title: a.metadata?.card_title || "" }),
    },
    "card.related": {
      icon: <LinkIcon size={14} />,
      label: (a) =>
        t("relatedCard", { title: a.metadata?.card_title || "" }),
    },
    "member.joined": {
      icon: <UserPlus size={14} />,
      label: () => t("joinedSpace"),
    },
    "member.left": {
      icon: <UserMinus size={14} />,
      label: (a) => {
        if (a.metadata?.removed_by) return t("removedBy", { user: a.metadata.removed_by });
        return t("leftSpace");
      },
    },
    "member.role_changed": {
      icon: <Shield size={14} />,
      label: (a) => {
        const oldRole =
          tRole(roleMap[a.metadata?.old_role || ""] as any) || a.metadata?.old_role;
        const newRole =
          tRole(roleMap[a.metadata?.new_role || ""] as any) || a.metadata?.new_role;
        return t("roleChanged", { from: oldRole, to: newRole });
      },
    },
  };
}

export default function ActivitiesPage() {
  const params = useParams();
  const workspaceId = params.id as string;
  const t = useTranslations("activity");
  const tRole = useTranslations("role");
  const locale = useLocale();

  const ACTION_CONFIG = getActionConfig(t, tRole);

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
      <h1 className="mb-6 text-lg font-bold text-text">{t("title")}</h1>

      {activities && activities.length === 0 && (
        <p className="py-20 text-center text-sm text-text-secondary">{t("noActivities")}</p>
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
                    <span className="font-medium">{a.actor_nickname || t("anonymousUser")}</span>
                    {config.label(a)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-text-secondary">
                    {formatRelativeTime(a.created_at, locale)}
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
