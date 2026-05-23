export function TagChip({
  label,
  color,
  className = "",
}: {
  label: string;
  color: string;
  className?: string;
}) {
  return (
    <span
      className={`rounded-md px-2 py-0.5 text-xs text-white ${className}`}
      style={{ background: color }}
    >
      {label}
    </span>
  );
}
