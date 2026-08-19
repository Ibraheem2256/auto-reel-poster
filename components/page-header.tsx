"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description }: { title: string; description?: string }) {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  return (
    <div className="mb-6 animate-fade-in-up">
      <p className="text-xs font-semibold uppercase tracking-widest text-brand-fuchsia/80">
        {segments.map((s, i) => (
          <span key={i}>
            {s.replace(/-/g, " ")}
            {i < segments.length - 1 && <span className="mx-1 text-muted-foreground/40">/</span>}
          </span>
        ))}
      </p>
      <h1 className="mt-1.5 font-display text-2xl font-bold tracking-tight">
        <span className="text-gradient">{title}</span>
      </h1>
      {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

const TONE_ICON_BG = {
  default: "from-brand-violet/25 to-brand-fuchsia/15 text-brand-violet",
  success: "from-emerald-500/25 to-emerald-500/10 text-emerald-400",
  destructive: "from-rose-500/25 to-rose-500/10 text-rose-400",
  warning: "from-amber-500/25 to-amber-500/10 text-amber-400",
};

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
  icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "success" | "destructive" | "warning";
  icon?: React.ReactNode;
}) {
  const toneClass = {
    default: "text-foreground",
    success: "text-emerald-400",
    destructive: "text-destructive",
    warning: "text-amber-400",
  }[tone];
  return (
    <div className="group relative overflow-hidden rounded-xl border border-white/[0.06] bg-card/70 p-4 shadow-card backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-brand-violet/30 hover:shadow-glow">
      <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-gradient-to-br from-brand-violet/15 to-brand-fuchsia/10 opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100" />
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {icon && (
          <span
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br",
              TONE_ICON_BG[tone]
            )}
          >
            {icon}
          </span>
        )}
      </div>
      <p className={cn("mt-1.5 font-display text-2xl font-bold tracking-tight", toneClass)}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}