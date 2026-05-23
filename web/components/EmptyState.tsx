export function EmptyState({
  icon,
  title,
  description,
}: {
  icon?: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="py-20 text-center text-text-secondary">
      {icon && <div className="mb-4 text-5xl">{icon}</div>}
      <p className="text-lg font-medium">{title}</p>
      {description && <p className="mt-2 text-sm">{description}</p>}
    </div>
  );
}
