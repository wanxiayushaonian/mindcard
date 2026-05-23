export const CARD_COLORS = ["#B8D4E3", "#E8A87C", "#D4A5A5", "#7EC8B0", "#B8A9C9", "#F0C987", "#87CEEB", "#DDA0DD"];
export const SPACE_COLORS = ["#94B4C8", "#E8A87C", "#D4A5A5", "#7EC8B0", "#B8A9C9", "#F0C987", "#87CEEB", "#DDA0DD"];

export function ColorPicker({
  value,
  onChange,
  colors = CARD_COLORS,
}: {
  value: string;
  onChange: (color: string) => void;
  colors?: string[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {colors.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={`h-8 w-8 rounded-full ${
            value === c ? "ring-2 ring-primary ring-offset-2" : ""
          }`}
          style={{ background: c }}
        />
      ))}
    </div>
  );
}
