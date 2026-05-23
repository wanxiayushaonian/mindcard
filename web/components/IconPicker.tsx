export const SPACE_ICONS = ["💡", "🎨", "📚", "🔬", "🎵", "🚀", "🌱", "🧠", "✨", "🔥"];

export function IconPicker({
  value,
  onChange,
  icons = SPACE_ICONS,
}: {
  value: string;
  onChange: (icon: string) => void;
  icons?: string[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {icons.map((i) => (
        <button
          key={i}
          onClick={() => onChange(i)}
          className={`flex h-10 w-10 items-center justify-center rounded-lg text-xl ${
            value === i ? "bg-primary/20 ring-2 ring-primary" : "bg-gray-100 hover:bg-gray-200"
          }`}
        >
          {i}
        </button>
      ))}
    </div>
  );
}
