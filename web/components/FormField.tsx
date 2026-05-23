export function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-sm text-text-secondary">{label}</span>
      {children}
    </label>
  );
}
