"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DriveStatusBadge } from "@/components/status-badges";
import { useToast } from "@/components/ui/toast";
import { LoadingState, EmptyState } from "@/components/ui/states";
import { formatRelative } from "@/lib/utils";
import { FolderOpen, ScanLine, Link2, Unplug } from "lucide-react";
import { useSearchParams } from "next/navigation";

interface DriveStatus {
  connected: boolean;
  folderId?: string;
  folderName?: string | null;
  status?: string;
  lastError?: string | null;
  lastScanAt?: string | null;
  videos?: number;
  newVideos?: number;
  scanIntervalMinutes?: number;
}

export default function DrivePage() {
  const [folderLink, setFolderLink] = useState("");
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const toast = useToast();
  const params = useSearchParams();

  const load = useCallback(async () => {
    const data = await fetch("/api/drive/status").then((r) => r.json());
    setStatus(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const connected = params.get("connected");
    const error = params.get("error");
    if (connected) toast({ title: "Drive folder connected", variant: "success" });
    if (error) toast({ title: "Connection failed", description: error, variant: "error" });
    if (connected || error) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const connect = async () => {
    setConnecting(true);
    try {
      const res = await fetch("/api/drive/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderLink }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to connect");
      window.location.href = data.url;
    } catch (err) {
      toast({ title: "Connection failed", description: (err as Error).message, variant: "error" });
      setConnecting(false);
    }
  };

  const scanNow = async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/drive/scan", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Scan failed");
      toast({
        title: "Scan complete",
        description: `${data.result.found} files · ${data.result.newVideos} new videos`,
        variant: "success",
      });
      load();
    } catch (err) {
      toast({ title: "Scan failed", description: (err as Error).message, variant: "error" });
    } finally {
      setScanning(false);
    }
  };

  const disconnect = async () => {
    await fetch("/api/drive/status", { method: "DELETE" });
    toast({ title: "Drive disconnected", variant: "info" });
    load();
  };

  if (loading) return <LoadingState />;

  return (
    <div>
      <PageHeader
        title="Drive Folder"
        description="Your Google Drive folder is the video source. Paste a shared folder link to connect it."
      />

      {!status?.connected ? (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FolderOpen className="h-4 w-4" /> Connect Google Drive
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="folder">Google Drive folder link</Label>
              <Input
                id="folder"
                placeholder="https://drive.google.com/drive/folders/XXXXXXXX"
                value={folderLink}
                onChange={(e) => setFolderLink(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Share the folder with your Google account, or connect a Google account that already has access. You will be
                asked to authorize read-only access — no passwords are ever stored.
              </p>
            </div>
            <Button onClick={connect} disabled={connecting || !folderLink} className="w-full">
              <Link2 className="h-4 w-4" />
              {connecting ? "Redirecting to Google..." : "Connect Folder"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="max-w-2xl space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FolderOpen className="h-4 w-4" /> Connected Folder
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{status.folderName ?? status.folderId}</p>
                  <p className="text-xs text-muted-foreground break-all">{status.folderId}</p>
                </div>
                <DriveStatusBadge status={(status.status ?? "CONNECTED") as never} />
              </div>
              {status.lastError && (
                <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                  {status.lastError}
                </p>
              )}
              <div className="grid grid-cols-3 gap-3 border-t pt-3 text-center">
                <div>
                  <p className="text-xl font-bold">{status.videos ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Videos</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-emerald-600">{status.newVideos ?? 0}</p>
                  <p className="text-xs text-muted-foreground">New</p>
                </div>
                <div>
                  <p className="text-xl font-bold">{status.lastScanAt ? formatRelative(status.lastScanAt) : "-"}</p>
                  <p className="text-xs text-muted-foreground">Last scan</p>
                </div>
              </div>
              <div className="flex gap-2 border-t pt-3">
                <Button onClick={scanNow} disabled={scanning} size="sm">
                  <ScanLine className="h-4 w-4" />
                  {scanning ? "Scanning..." : "Scan Now"}
                </Button>
                <Button onClick={disconnect} variant="outline" size="sm">
                  <Unplug className="h-4 w-4" /> Disconnect
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Automatic scans run every {status.scanIntervalMinutes ?? 10} minutes while automation is enabled.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}