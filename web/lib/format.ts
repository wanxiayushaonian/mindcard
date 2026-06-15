export function formatDateTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale === "zh" ? "zh-CN" : "en-US");
}

export function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US");
}

export function formatTimeShort(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(
    locale === "zh" ? "zh-CN" : "en-US",
    { hour: "2-digit", minute: "2-digit" },
  );
}

export function formatRelativeTime(iso: string, locale: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (locale === "zh") {
    if (diff < 60_000) return "刚刚";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  }
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
