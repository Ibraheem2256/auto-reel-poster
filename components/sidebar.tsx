"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  ListVideo,
  CalendarDays,
  FolderOpen,
  Link2,
  Clock,
  Send,
  BarChart3,
  Settings,
  ShieldCheck,
  Zap,
  Stethoscope,
  Timer,
  Sparkles,
} from "lucide-react";
import { APP_NAME } from "@/lib/constants";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/queue", label: "Content Queue", icon: ListVideo },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/drive", label: "Drive Folder", icon: FolderOpen },
  { href: "/accounts", label: "Connected Accounts", icon: Link2 },
  { href: "/schedules", label: "Schedules", icon: Clock },
  { href: "/posts", label: "Published Posts", icon: Send },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/diagnostics", label: "Diagnostics", icon: Stethoscope },
  { href: "/timing", label: "Timing Optimizer", icon: Timer },
  { href: "/enhancer", label: "View Enhancer", icon: Sparkles },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const isAdmin = pathname.startsWith("/admin");

  return (
    <aside className="z-20 hidden w-60 shrink-0 border-r border-white/[0.06] bg-card/60 backdrop-blur-xl md:fixed md:inset-y-0 md:flex md:flex-col">
      <div className="flex h-14 items-center gap-2.5 border-b border-white/[0.06] px-4">
        <span className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-animated text-white shadow-glow">
          <Zap className="h-4 w-4" />
        </span>
        <span className="font-display text-sm font-bold tracking-tight">
          <span className="text-gradient">{APP_NAME}</span>
        </span>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 overflow-hidden rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                active
                  ? "bg-gradient-to-r from-brand-violet/25 to-brand-fuchsia/15 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] shadow-glow"
                  : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground hover:translate-x-0.5"
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-gradient-to-b from-brand-violet to-brand-fuchsia shadow-[0_0_8px_hsl(262,83%,66%,0.6)]" />
              )}
              <item.icon
                className={cn(
                  "h-4 w-4 transition-all duration-200",
                  active ? "text-brand-fuchsia drop-shadow-[0_0_6px_hsl(292,84%,61%,0.5)]" : "text-muted-foreground group-hover:text-foreground"
                )}
              />
              <span className="flex-1">{item.label}</span>
              {active && (
                <span className="h-1.5 w-1.5 rounded-full bg-brand-fuchsia shadow-[0_0_6px_hsl(292,84%,61%,0.8)]" />
              )}
            </Link>
          );
        })}
        <Link
          href="/admin"
          className={cn(
            "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
            isAdmin
              ? "bg-gradient-to-r from-brand-violet/25 to-brand-fuchsia/15 text-white shadow-glow"
              : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
          )}
        >
          <ShieldCheck
            className={cn("h-4 w-4", isAdmin ? "text-brand-fuchsia drop-shadow-[0_0_6px_hsl(292,84%,61%,0.5)]" : "text-muted-foreground")}
          />
          Admin
        </Link>
      </nav>
      <div className="border-t border-white/[0.06] p-4">
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
          <p className="text-xs font-semibold text-foreground/80">Free tier</p>
          <p className="mt-0.5 text-xs text-muted-foreground">No video storage. Streamed straight from Drive.</p>
        </div>
      </div>
    </aside>
  );
}

const MOBILE_NAV = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/queue", label: "Queue", icon: ListVideo },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/accounts", label: "Accounts", icon: Link2 },
  { href: "/schedules", label: "Schedule", icon: Clock },
];

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.08] bg-card/90 backdrop-blur-xl md:hidden safe-bottom">
      <div className="flex items-center justify-around">
        {MOBILE_NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex flex-col items-center gap-0.5 py-2.5 px-3 text-[10px] font-medium transition-all duration-200",
                active ? "text-brand-fuchsia" : "text-muted-foreground active:scale-95"
              )}
            >
              {active && (
                <span className="absolute -top-0.5 left-1/2 h-0.5 w-5 -translate-x-1/2 rounded-full bg-gradient-to-r from-brand-violet to-brand-fuchsia" />
              )}
              <item.icon className={cn("h-5 w-5 transition-colors", active && "drop-shadow-[0_0_6px_hsl(292,84%,61%,0.6)]")} />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}