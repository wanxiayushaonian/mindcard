"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  message: string;
  type: "success" | "error" | "info";
  action?: ToastAction;
}

let _addToast: ((msg: string, type: ToastItem["type"], action?: ToastAction) => void) | null = null;

export function toast(message: string, type: ToastItem["type"] = "info", action?: ToastAction) {
  _addToast?.(message, type, action);
}

// Convenience methods
toast.success = (message: string, action?: ToastAction) => toast(message, "success", action);
toast.error = (message: string) => toast(message, "error");
toast.info = (message: string) => toast(message, "info");

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(0);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((message: string, type: ToastItem["type"], action?: ToastAction) => {
    const id = ++nextIdRef.current;
    setToasts((prev) => [...prev, { id, message, type, action }]);
    setTimeout(() => {
      removeToast(id);
    }, 3000);
  }, [removeToast]);

  useEffect(() => {
    _addToast = addToast;
    return () => { _addToast = null; };
  }, [addToast]);

  if (toasts.length === 0) return null;

  const typeStyles: Record<ToastItem["type"], string> = {
    success: "border-green-400 bg-green-50 text-green-700",
    error: "border-red-400 bg-red-50 text-red-700",
    info: "border-primary bg-blue-50 text-blue-700",
  };

  return (
    <div className="fixed right-4 top-4 z-[9999] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`animate-slide-in flex items-center gap-3 rounded-xl border-l-4 px-4 py-3 text-sm shadow-lg ${typeStyles[t.type]}`}
        >
          <span>{t.message}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action!.onClick();
                removeToast(t.id);
              }}
              className="shrink-0 rounded-md bg-white/60 px-2 py-1 text-xs font-medium underline-offset-2 hover:underline"
            >
              {t.action.label} →
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
