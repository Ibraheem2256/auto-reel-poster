"use client";

import * as React from "react";
import { createContext, useContext } from "react";
import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";

type Toast = { id: number; title: string; description?: string; variant: "success" | "error" | "info" };
type ToastFn = (opts: { title: string; description?: string; variant?: "success" | "error" | "info" }) => void;

const ToastContext = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastContext);

let toastId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const show = React.useCallback<ToastFn>(({ title, description, variant = "info" }) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, title, description, variant }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

  const dismiss = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-xl border border-white/10 bg-card/90 p-4 shadow-card backdrop-blur-xl animate-in",
              t.variant === "success" && "border-emerald-400/30",
              t.variant === "error" && "border-destructive/40"
            )}
          >
            {t.variant === "success" && <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" />}
            {t.variant === "error" && <XCircle className="mt-0.5 h-4 w-4 text-destructive" />}
            {t.variant === "info" && <Info className="mt-0.5 h-4 w-4 text-brand-fuchsia" />}
            <div className="flex-1">
              <p className="text-sm font-semibold">{t.title}</p>
              {t.description && <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>}
            </div>
            <button onClick={() => dismiss(t.id)} className="opacity-60 transition-opacity hover:opacity-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}