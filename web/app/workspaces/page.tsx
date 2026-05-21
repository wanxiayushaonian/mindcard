"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { useRouter } from "next/navigation";
import { workspaceApi, type Workspace } from "@/lib/api";

const ICONS = ["💡", "🎨", "📚", "🔬", "🎵", "🚀", "🌱", "🧠", "✨", "🔥"];
const COLORS = ["#94B4C8", "#E8A87C", "#D4A5A5", "#7EC8B0", "#B8A9C9", "#F0C987", "#87CEEB", "#DDA0DD"];

export default function WorkspacesPage() {
  const router = useRouter();
  const { data: workspaces, isLoading } = useSWR("workspaces", () => workspaceApi.list());
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("💡");
  const [color, setColor] = useState("#94B4C8");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const localId = "ws_" + Date.now();
      await workspaceApi.create({ local_id: localId, name: name.trim(), icon, color });
      setName("");
      setShowCreate(false);
      mutate("workspaces");
    } catch (e: any) {
      alert("创建失败: " + e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, wsId: string) => {
    e.stopPropagation();
    if (!confirm("确定删除该空间？空间内所有卡片将被删除。")) return;
    try {
      await workspaceApi.delete(wsId);
      mutate("workspaces");
    } catch (e: any) {
      alert("删除失败: " + e.message);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-text-secondary">加载中...</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-text">我的灵感空间</h1>
        <p className="mt-1 text-sm text-text-secondary">选择一个空间开始探索</p>
      </header>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {workspaces?.map((ws) => (
          <div
            key={ws.id}
            onClick={() => router.push(`/workspaces/${ws.id}`)}
            className="group relative cursor-pointer rounded-card bg-surface p-5 shadow-sm transition hover:shadow-md"
            style={{ borderTop: `4px solid ${ws.color}` }}
          >
            <button
              onClick={(e) => handleDelete(e, ws.id)}
              className="absolute right-2 top-2 hidden rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-400 hover:bg-red-100 hover:text-red-600 group-hover:block"
            >
              删除
            </button>
            <div className="mb-2 text-3xl">{ws.icon}</div>
            <h3 className="font-semibold text-text">{ws.name}</h3>
            <p className="mt-1 text-xs text-text-secondary">
              {new Date(ws.created_at).toLocaleDateString("zh-CN")}
            </p>
          </div>
        ))}

        {/* Add workspace card */}
        <div
          onClick={() => setShowCreate(true)}
          className="flex min-h-[160px] cursor-pointer flex-col items-center justify-center rounded-card border-2 border-dashed border-gray-300 bg-transparent transition hover:border-primary"
        >
          <span className="mb-2 text-3xl text-gray-400">+</span>
          <span className="text-sm text-text-secondary">新建空间</span>
        </div>
      </div>

      {/* Create workspace modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold text-text">新建灵感空间</h2>

            <label className="mb-3 block">
              <span className="mb-1 block text-sm text-text-secondary">空间名称</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="输入空间名称..."
                autoFocus
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-primary"
              />
            </label>

            <label className="mb-3 block">
              <span className="mb-1 block text-sm text-text-secondary">图标</span>
              <div className="flex flex-wrap gap-2">
                {ICONS.map((i) => (
                  <button
                    key={i}
                    onClick={() => setIcon(i)}
                    className={`flex h-10 w-10 items-center justify-center rounded-lg text-xl ${
                      icon === i ? "bg-primary/20 ring-2 ring-primary" : "bg-gray-100 hover:bg-gray-200"
                    }`}
                  >
                    {i}
                  </button>
                ))}
              </div>
            </label>

            <label className="mb-5 block">
              <span className="mb-1 block text-sm text-text-secondary">配色</span>
              <div className="flex flex-wrap gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`h-8 w-8 rounded-full ${
                      color === c ? "ring-2 ring-primary ring-offset-2" : ""
                    }`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </label>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowCreate(false)}
                className="rounded-xl px-4 py-2 text-sm text-text-secondary hover:bg-gray-100"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={!name.trim() || creating}
                className="rounded-xl bg-primary px-6 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {creating ? "创建中..." : "创建"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
