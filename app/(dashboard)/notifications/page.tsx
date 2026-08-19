"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LoadingState, EmptyState } from "@/components/ui/states";
import { formatRelative } from "@/lib/utils";
import { CheckCheck, BellRing } from "lucide-react";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string | null;
  read: boolean;
  createdAt: string;
}

const TYPE_STYLE: Record<string, string> = {
  VIDEO_PUBLISHED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  PUBLISH_FAILED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  COPYRIGHT_ISSUE: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  ACCOUNT_DISCONNECTED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  TOKEN_EXPIRED: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  DRIVE_UNAVAILABLE: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  QUEUE_EMPTY: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  SYSTEM: "bg-muted text-muted-foreground",
};

const TYPE_LABEL: Record<string, string> = {
  VIDEO_PUBLISHED: "Published",
  PUBLISH_FAILED: "Failed",
  COPYRIGHT_ISSUE: "Copyright",
  ACCOUNT_DISCONNECTED: "Account",
  TOKEN_EXPIRED: "Expired",
  DRIVE_UNAVAILABLE: "Drive",
  QUEUE_EMPTY: "Queue",
  SYSTEM: "System",
};

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    const d = await fetch("/api/notifications").then((r) => r.json());
    setNotifications(d.notifications);
    setUnread(d.unread);
  }, []);

  useEffect(() => {
    load();
    if (unread > 0) {
      fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).catch(() => {});
    }
  }, [load, unread]);

  if (!notifications) return <LoadingState />;

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Alerts about your publishing pipeline — failures, copyright issues and connection problems."
      />
      {unread > 0 && (
        <div className="mb-4 flex items-center justify-between rounded-md border border-primary/20 bg-primary/5 p-3">
          <p className="text-sm font-medium">{unread} unread notification{unread > 1 ? "s" : ""}</p>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              await fetch("/api/notifications", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
              });
              load();
            }}
          >
            <CheckCheck className="h-3.5 w-3.5" /> Mark all read
          </Button>
        </div>
      )}

      {notifications.length === 0 ? (
        <EmptyState
          title="No notifications"
          description="Everything is quiet. Alerts about publishing failures and copyright issues will appear here."
        />
      ) : (
        <div className="space-y-3">
          {notifications.map((n) => (
            <Card key={n.id} className={`p-4 ${n.read ? "opacity-70" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <BellRing className="h-4 w-4 text-muted-foreground" />
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${TYPE_STYLE[n.type] ?? TYPE_STYLE.SYSTEM}`}>
                    {TYPE_LABEL[n.type] ?? n.type}
                  </span>
                  <span className="text-xs text-muted-foreground">{formatRelative(n.createdAt)}</span>
                </div>
                {!n.read && <span className="h-2 w-2 rounded-full bg-destructive" />}
              </div>
              <p className="mt-2 text-sm font-medium">{n.title}</p>
              {n.message && <p className="mt-1 text-sm text-muted-foreground">{n.message}</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}