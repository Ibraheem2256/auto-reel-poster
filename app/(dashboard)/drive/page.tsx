"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DriveStatusBadge } from "@/components/status-badges";
import { useToast } from "@/components/ui/toast";
import { LoadingState } from "@/components/ui/states";
import { formatRelative } from "@/lib/utils";
import { FolderOpen, ScanLine, Link2, Unplug, Plus } from "lucide-react";
import { useSearchParams } from "next/navigation";

interface Folder {
  id: string;
  folderId: string;
  folderName: string | null;
  status: string;
  lastError: string | null;
  lastScanAt: string | null;
}

interface DriveStatus {
  connected: boolean;
  folders: Folder[];
  videos?: number;
  newVideos?: number;
}

export default function DrivePage() {
  const [folderLink, setFolderLink] = useState("");
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ found: number; newVideos: number } | null>(null);
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
    setScanResult(null);
    try {
      const res = await fetch("/api/drive/scan", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Scan failed");
      setScanResult({ found: data.result.found, newVideos: data.result.newVideos });
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

  const disconnectFolder = async (folderId: string) => {
    await fetch("/api/drive/status", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId }),
    });
    toast({ title: "Folder disconnected", variant: "info" });
    load();
  };

  const disconnectAll = async () => {
    await fetch("/api/drive/status", { method: "DELETE" });
    toast({ title: "All folders disconnected", variant: "info" });
    load();
  };

  if (loading) return <LoadingState />;

  const folders = status?.folders ?? [];
  const hasFolders = folders.length > 0;

  return (
    <div>
      <PageHeader
        title="Drive Folders"
        description="Connect Google Drive folders as video sources. Add multiple folders to scan from."
      />

      <div className="max-w-2xl space-y-4">
        {hasFolders && (
          <div className="space-y-3">
            {folders.map((folder) => (
              <Card key={folder.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FolderOpen className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="font-semibold">{folder.folderName ?? folder.folderId}</p>
                        <p className="text-xs text-muted-foreground break-all">{folder.folderId}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <DriveStatusBadge status={folder.status as never} />
                      <Button
                        onClick={() => disconnectFolder(folder.folderId)}
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                      >
                        <Unplug className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {folder.lastError && (
                    <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                      {folder.lastError}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Last scan: {folder.lastScanAt ? formatRelative(folder.lastScanAt) : "Never"}
                  </p>
                </CardContent>
              </Card>
            ))}

            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg border p-3">
                <p className="text-xl font-bold">{status?.videos ?? 0}</p>
                <p className="text-xs text-muted-foreground">Total Videos</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xl font-bold text-emerald-600">{status?.newVideos ?? 0}</p>
                <p className="text-xs text-muted-foreground">New</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xl font-bold">{folders.length}</p>
                <p className="text-xs text-muted-foreground">Folders</p>
              </div>
            </div>

            {scanning && (
              <div className="flex items-center gap-3 rounded-lg border border-brand-violet/20 bg-brand-violet/5 p-3">
                <div className="relative h-5 w-5">
                  <div className="absolute inset-0 animate-ping rounded-full bg-brand-violet/30" />
                  <div className="relative h-5 w-5 animate-spin rounded-full border-2 border-brand-violet/20 border-t-brand-fuchsia" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">Scanning Drive folders...</p>
                  <p className="text-xs text-muted-foreground">Fetching files and detecting new videos</p>
                </div>
              </div>
            )}
            {!scanning && scanResult && (
              <div className="flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-xs">✓</div>
                <div>
                  <p className="text-sm font-medium">Scan complete</p>
                  <p className="text-xs text-muted-foreground">{scanResult.found} files found · {scanResult.newVideos} new videos added</p>
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={scanNow} disabled={scanning} size="sm">
                <ScanLine className="h-4 w-4" />
                {scanning ? "Scanning..." : "Scan All Folders"}
              </Button>
              <Button onClick={disconnectAll} variant="outline" size="sm">
                <Unplug className="h-4 w-4" /> Disconnect All
              </Button>
            </div>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {hasFolders ? <Plus className="h-4 w-4" /> : <FolderOpen className="h-4 w-4" />}
              {hasFolders ? "Add Another Folder" : "Connect Google Drive"}
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
      </div>
    </div>
  );
}
