"use client";

import { useParams, useRouter } from "next/navigation";
import useSWR from "swr";
import { workspaceApi } from "@/lib/api";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params.id as string;

  const { data: workspace } = useSWR(
    workspaceId ? `workspace-${workspaceId}` : null,
    () => workspaceApi.get(workspaceId)
  );

  return (
    <div className="min-h-screen bg-bg">
      {/* Top nav */}
      <nav className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-surface/80 px-4 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/workspaces")}
            className="text-text-secondary hover:text-text"
          >
            &larr;
          </button>
          <span className="text-lg">
            {workspace?.icon} {workspace?.name}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push(`/workspaces/${workspaceId}/search`)}
            className="rounded-lg px-3 py-1.5 text-sm text-text-secondary hover:bg-gray-100"
          >
            搜索
          </button>
          <button
            onClick={() => router.push(`/rag?workspaceId=${workspaceId}`)}
            className="rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary-dark"
          >
            AI 问答
          </button>
        </div>
      </nav>

      {children}
    </div>
  );
}
