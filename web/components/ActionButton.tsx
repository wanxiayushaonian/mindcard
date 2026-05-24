import type { ReactNode } from "react";

export function ActionButton({
  icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary-dark">
        {icon}
      </span>
      <span className="text-xs text-text-secondary">{label}</span>
    </button>
  );
}
