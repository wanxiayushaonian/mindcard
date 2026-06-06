"use client";

import { ChevronDown, ChevronRight, GitBranch } from "lucide-react";

const DEPTH_COLORS = [
  "border-l-blue-400",
  "border-l-green-400",
  "border-l-purple-400",
  "border-l-orange-400",
  "border-l-red-400",
];

interface ForkDividerProps {
  childChatId: string;
  label: string;
  depth: number;
  messageCount: number;
  collapsed: boolean;
  parentContextSummary?: string;
  onToggle: (childChatId: string) => void;
}

export function ForkDivider({
  childChatId,
  label,
  depth,
  messageCount,
  collapsed,
  parentContextSummary,
  onToggle,
}: ForkDividerProps) {
  const colorClass = DEPTH_COLORS[depth % DEPTH_COLORS.length];

  return (
    <div
      className={`border-l-4 ${colorClass} pl-3 py-2 my-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded-r`}
      onClick={() => onToggle(childChatId)}
    >
      <div className="flex items-center gap-2">
        {collapsed ? (
          <ChevronRight className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        )}
        <GitBranch className="w-4 h-4 text-gray-500" />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </span>
        <span className="text-xs text-gray-400">
          ({messageCount} 条消息)
        </span>
      </div>
      {collapsed && parentContextSummary && (
        <p className="text-xs text-gray-400 mt-1 ml-6 line-clamp-2">
          {parentContextSummary}
        </p>
      )}
    </div>
  );
}
