"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Animated collapsible wrapper for fork contents.
 *
 * The content stays mounted for the duration of the close animation so it can
 * transition smoothly (0fr → 1fr grid-template-rows), then unmounts once the
 * row is fully collapsed. Unmounting matters: a collapsed fork's messages must
 * leave the DOM so the message-navigator IntersectionObserver never observes
 * visually hidden messages.
 *
 * Respects prefers-reduced-motion (instant toggle, no transition).
 */
export function ForkExpandable({
  isExpanded,
  forkId,
  color,
  emptyHint,
  children,
}: {
  isExpanded: boolean;
  forkId: string;
  color: string;
  emptyHint: string;
  children: ReactNode[];
}) {
  // `rendered` = whether content is in the DOM (false once collapse finishes).
  // `open` = whether it's visually open (drives the 1fr/0fr rows).
  const [rendered, setRendered] = useState(isExpanded);
  const [open, setOpen] = useState(isExpanded);

  useEffect(() => {
    if (isExpanded) {
      setRendered(true);
      // Mount at 0fr first, then open on the next frame so the transition runs.
      const raf = requestAnimationFrame(() => setOpen(true));
      return () => cancelAnimationFrame(raf);
    }
    // Closing: animate to 0fr, then unmount. The timeout is a fallback for
    // browsers/reduced-motion where onTransitionEnd never fires.
    setOpen(false);
    const t = setTimeout(() => setRendered(false), 400);
    return () => clearTimeout(t);
  }, [isExpanded]);

  if (!rendered && !open) return null;

  return (
    <div
      className={`grid transition-[grid-template-rows] duration-300 ease-in-out motion-reduce:transition-none ${
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
      }`}
      onTransitionEnd={(e) => {
        if (e.propertyName === "grid-template-rows" && !open) setRendered(false);
      }}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          className="ml-3 mt-2 space-y-3 rounded-lg bg-gray-50/60 p-3 dark:bg-gray-900/30"
          style={{ borderLeft: `3px solid ${color}` }}
        >
          {children.length === 0 ? (
            <p className="py-2 text-xs italic text-text-secondary">{emptyHint}</p>
          ) : (
            children
          )}
          <div id={`fork-end-${forkId}`} />
        </div>
      </div>
    </div>
  );
}
