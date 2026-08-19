"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { Sidebar, MobileNav } from "@/components/sidebar";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { Bell, LogOut, Pause, Play } from "lucide-react";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Request failed");
  }
  return res.json();
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ShellInner>{children}</ShellInner>
    </ToastProvider>
  );
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const [automation, setAutomation] = useState<{ automationEnabled: boolean; paused: boolean } | null>(null);
  const [unread, setUnread] = useState(0);
  const toast = useToast();

  useEffect(() => {
    api<{ automationEnabled: boolean; paused: boolean }>("/api/automation")
      .then(setAutomation)
      .catch(() => {});
    api<{ unread: number }>("/api/notifications")
      .then((d) => setUnread(d.unread))
      .catch(() => {});
  }, []);

  const togglePause = async () => {
    if (!automation) return;
    try {
      const next = { ...automation, paused: !automation.paused };
      setAutomation(next);
      await api("/api/automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next.automationEnabled, paused: next.paused }),
      });
      toast({
        title: next.paused ? "All posting paused" : "Posting resumed",
        variant: next.paused ? "info" : "success",
      });
    } catch (err) {
      toast({ title: "Failed to update", description: (err as Error).message, variant: "error" });
    }
  };

  return (
    <div className="aurora-bg relative min-h-screen">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="aurora-blob left-[-10%] top-[-20%] h-[32rem] w-[32rem] animate-float bg-brand-violet/40" />
        <div className="aurora-blob right-[-15%] top-[10%] h-[28rem] w-[28rem] animate-float-2 bg-brand-fuchsia/30" />
        <div className="aurora-blob bottom-[-20%] left-[30%] h-[30rem] w-[30rem] animate-float bg-brand-amber/20 [animation-delay:-7s]" />
      </div>
      <Sidebar />
      <div className="relative md:pl-60">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-white/[0.06] bg-background/70 px-4 backdrop-blur-xl">
          <div className="flex items-center gap-2.5 text-sm">
            <span className="relative flex h-2.5 w-2.5">
              {automation?.automationEnabled && (
                <span
                  className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${
                    automation.paused ? "bg-amber-500" : "bg-emerald-500"
                  }`}
                />
              )}
              <span
                className={`relative inline-flex h-2.5 w-2.5 rounded-full transition-colors ${
                  automation?.automationEnabled
                    ? automation.paused
                      ? "bg-amber-500 shadow-[0_0_8px_hsl(38,92%,50%,0.5)]"
                      : "bg-emerald-500 shadow-[0_0_8px_hsl(160,84%,39%,0.5)]"
                    : "bg-muted-foreground/50"
                }`}
              />
            </span>
            <span className="hidden font-display text-xs font-semibold uppercase tracking-widest sm:inline">
              {automation?.automationEnabled ? (automation.paused ? "Auto posting paused" : "Auto posting on") : "Auto posting off"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {automation?.automationEnabled && (
              <button
                onClick={togglePause}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-all duration-200 active:scale-95 ${
                  automation.paused
                    ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
                    : "border-amber-400/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                }`}
              >
                {automation.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                {automation.paused ? "Resume Posting" : "Pause All Posting"}
              </button>
            )}
            <Link
              href="/notifications"
              className="relative rounded-lg p-2 text-muted-foreground transition-all duration-200 hover:bg-white/[0.06] hover:text-foreground active:scale-95"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gradient-to-r from-brand-violet to-brand-fuchsia px-1 text-[10px] font-bold text-white shadow-glow">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>
            <a
              href="/api/auth/signout"
              className="rounded-lg p-2 text-muted-foreground transition-all duration-200 hover:bg-white/[0.06] hover:text-foreground active:scale-95"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </a>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 pb-24 md:pb-8">{children}</main>
      </div>
      <MobileNav />
    </div>
  );
}