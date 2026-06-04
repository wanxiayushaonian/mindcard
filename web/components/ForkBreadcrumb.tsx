"use client";

const DEPTH_DOT_COLORS = [
  "bg-gray-400",
  "bg-blue-400",
  "bg-green-400",
  "bg-purple-400",
  "bg-orange-400",
];

interface BreadcrumbNode {
  forkId: string | null;
  label: string;
  depth: number;
}

interface ForkBreadcrumbProps {
  path: BreadcrumbNode[];
  onNavigate: (forkId: string | null) => void;
}

export function ForkBreadcrumb({ path, onNavigate }: ForkBreadcrumbProps) {
  if (path.length <= 1) return null;

  return (
    <div className="sticky top-0 z-10 flex items-center gap-1 px-3 py-2 text-sm border-b border-gray-100 dark:border-gray-800 bg-surface/95 backdrop-blur-sm overflow-x-auto">
      {path.map((node, i) => (
        <div key={node.forkId ?? "root"} className="flex items-center gap-1 shrink-0">
          {i > 0 && <span className="text-gray-300">&rsaquo;</span>}
          <button
            type="button"
            className={`flex items-center gap-1 px-2 py-0.5 rounded transition ${
              i === path.length - 1
                ? "font-medium text-gray-800 dark:text-gray-200 cursor-default"
                : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
            }`}
            onClick={() => onNavigate(node.forkId)}
          >
            <span
              className={`w-2 h-2 rounded-full ${DEPTH_DOT_COLORS[node.depth % DEPTH_DOT_COLORS.length]}`}
            />
            {node.label}
          </button>
        </div>
      ))}
    </div>
  );
}
