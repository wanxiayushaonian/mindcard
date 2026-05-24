import { useRouter } from "next/navigation";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  const router = useRouter();

  return (
    <nav className="flex items-center gap-1.5 text-sm">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-text-secondary/50">/</span>}
            {item.href && !isLast ? (
              <button
                onClick={() => router.push(item.href!)}
                className="text-text-secondary transition hover:text-primary-dark"
              >
                {item.label}
              </button>
            ) : (
              <span className={isLast ? "font-medium text-text" : "text-text-secondary"}>
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
