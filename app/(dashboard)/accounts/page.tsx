"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AccountStatusBadge } from "@/components/status-badges";
import { useToast } from "@/components/ui/toast";
import { LoadingState, EmptyState } from "@/components/ui/states";
import { PlatformBadge } from "@/components/platform-icons";
import { PLATFORM_LABELS } from "@/lib/constants";
import { useSearchParams } from "next/navigation";
import { Shield, CheckCircle2, AlertCircle } from "lucide-react";
import type { Platform } from "@prisma/client";

interface Account {
  id: string;
  platform: Platform;
  platformAccountId: string;
  accountName: string;
  avatarUrl: string | null;
  status: string;
  lastError?: string | null;
}

const PLATFORM_NOTES: Record<Platform, string> = {
  TIKTOK: "Official TikTok Content Posting API. Requires a TikTok developer app with the video.publish scope.",
  YOUTUBE: "Official YouTube Data API. Video uploads via Google OAuth.",
  INSTAGRAM: "Official Meta API. Requires an Instagram Business/Creator account linked to a Facebook Page.",
  FACEBOOK: "Official Meta Graph API. Publishes reels to a Facebook Page you manage.",
};

const PLATFORM_COLORS: Record<Platform, string> = {
  TIKTOK: "from-black/20 to-black/10",
  YOUTUBE: "from-red-500/20 to-red-500/10",
  INSTAGRAM: "from-pink-500/20 via-purple-500/20 to-orange-500/20",
  FACEBOOK: "from-blue-500/20 to-blue-500/10",
};

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [connecting, setConnecting] = useState<Platform | null>(null);
  const toast = useToast();
  const params = useSearchParams();

  const load = useCallback(async () => {
    const data = await fetch("/api/social/accounts").then((r) => r.json());
    setAccounts(data.accounts);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const connected = params.get("connected");
    const error = params.get("error");
    if (connected) toast({ title: `${PLATFORM_LABELS[connected.toUpperCase() as Platform] ?? "Account"} connected`, variant: "success" });
    if (error) toast({ title: "Connection failed", description: error, variant: "error" });
    if (connected || error) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const connect = async (platform: Platform) => {
    setConnecting(platform);
    try {
      const res = await fetch(`/api/social/${platform.toLowerCase()}/connect`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to start connection");
      window.location.href = data.url;
    } catch (err) {
      toast({ title: "Connection failed", description: (err as Error).message, variant: "error" });
      setConnecting(null);
    }
  };

  const disconnect = async (platform: Platform) => {
    const res = await fetch(`/api/social/${platform.toLowerCase()}/disconnect`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      toast({ title: "Failed to disconnect", description: data.error, variant: "error" });
      return;
    }
    toast({ title: `${PLATFORM_LABELS[platform]} disconnected`, variant: "info" });
    load();
  };

  if (!accounts) return <LoadingState />;

  return (
    <div>
      <PageHeader
        title="Connected Accounts"
        description="Connect your social accounts using official OAuth. No passwords are ever stored."
      />

      <div className="mb-6 flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-300">
        <Shield className="h-4 w-4 shrink-0" />
        <p>All connections use official platform APIs. Your credentials are encrypted and never exposed.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {(Object.keys(PLATFORM_LABELS) as Platform[]).map((platform) => {
          const account = accounts.find((a) => a.platform === platform);
          return (
            <Card key={platform} className="overflow-hidden transition-all duration-200 hover:border-brand-violet/30 hover:shadow-glow">
              <div className={`bg-gradient-to-r ${PLATFORM_COLORS[platform]} px-5 py-4`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <PlatformBadge platform={platform} />
                    <div>
                      <p className="font-display text-sm font-semibold">{PLATFORM_LABELS[platform]}</p>
                    </div>
                  </div>
                  {account ? (
                    <AccountStatusBadge status={(account.status as never) ?? "ERROR"} />
                  ) : (
                    <span className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                      Not connected
                    </span>
                  )}
                </div>
              </div>

              <div className="p-5">
                {account ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      {account.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={account.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover ring-2 ring-white/10" />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-brand-violet/30 to-brand-fuchsia/30 text-sm font-bold">
                          {account.accountName.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <p className="font-medium">{account.accountName}</p>
                        <p className="text-xs text-muted-foreground">{account.platformAccountId}</p>
                      </div>
                    </div>
                    {account.lastError && (
                      <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                        <p>{account.lastError}</p>
                      </div>
                    )}
                    <div className="flex gap-2 border-t border-white/[0.06] pt-4">
                      <Button variant="outline" size="sm" onClick={() => connect(platform)} disabled={connecting === platform}>
                        {connecting === platform ? "Redirecting..." : "Reconnect"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => disconnect(platform)}
                      >
                        Disconnect
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground leading-relaxed">{PLATFORM_NOTES[platform]}</p>
                    <Button className="w-full" size="sm" onClick={() => connect(platform)} disabled={connecting === platform}>
                      {connecting === platform ? (
                        <span className="flex items-center gap-2">
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          Redirecting...
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4" />
                          Connect {PLATFORM_LABELS[platform]}
                        </span>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}