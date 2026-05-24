import {
  Lightbulb,
  Palette,
  BookOpen,
  FlaskConical,
  Music,
  Rocket,
  Sprout,
  Brain,
  Sparkles,
  Flame,
  type LucideIcon,
} from "lucide-react";

export const SPACE_ICON_MAP: Record<string, LucideIcon> = {
  lightbulb: Lightbulb,
  palette: Palette,
  book: BookOpen,
  flask: FlaskConical,
  music: Music,
  rocket: Rocket,
  sprout: Sprout,
  brain: Brain,
  sparkles: Sparkles,
  flame: Flame,
};

export const SPACE_ICON_KEYS = Object.keys(SPACE_ICON_MAP);

/** Render a workspace icon — handles both old emoji values and new Lucide keys. */
export function WorkspaceIcon({ icon, size = 24, className }: { icon: string; size?: number; className?: string }) {
  const Comp = SPACE_ICON_MAP[icon];
  if (Comp) return <Comp size={size} className={className} />;
  return <span className={className} style={{ fontSize: size }}>{icon || "💡"}</span>;
}

export function IconPicker({
  value,
  onChange,
  icons,
}: {
  value: string;
  onChange: (icon: string) => void;
  icons?: string[];
}) {
  const keys = icons || SPACE_ICON_KEYS;

  return (
    <div className="flex flex-wrap gap-2">
      {keys.map((key) => {
        const LucideIconComp = SPACE_ICON_MAP[key];
        const isEmoji = !LucideIconComp;
        const isSelected = value === key;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={`flex h-10 w-10 items-center justify-center rounded-lg ${
              isSelected ? "bg-primary/20 ring-2 ring-primary" : "bg-gray-100 text-text-secondary hover:bg-gray-200"
            }`}
          >
            {isEmoji ? (
              <span className="text-xl">{key}</span>
            ) : (
              <LucideIconComp size={20} />
            )}
          </button>
        );
      })}
    </div>
  );
}
