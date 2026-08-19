"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { JobStatusBadge, VideoStatusBadge } from "@/components/status-badges";
import { PlatformBadge } from "@/components/platform-icons";
import { Button } from "@/components/ui/button";
import { LoadingState, ErrorState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { formatDateTime, formatBytes, formatDuration, formatRelative } from "@/lib/utils";
import { ChevronLeft, ExternalLink } from "lucide-react";

interface PostDetail {
  post: {
    id: string;
    scheduledAt: string;
    status: string;
    video: {
      id: string;
      fileName: string;
      driveFileId: string;
      thumbnailUrl: string | null;
      fileSize: string | null;
      durationMs: number | null;
      width: number | null;
      height: number | null;
      invalidReason: string | null;
      driveSource: { folderName: string | null } | null;
    };
    schedule: { name: string } | null;
    jobs: {
      id: string;
      platform: string;
      status: string;
      platformPostId: string | null;
      platformPostUrl: string | null;
      errorCode: string | null;
      errorMessage: string | null;
      attemptCount: number;
      nextRetryAt: string | null;
      publishedAt: string | null;
      socialAccount: { accountName: string } | null;
      platformPosts: { platformPostId: string; publishedAt: string }[];
    }[];
  };
}

export default function PostDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<PostDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const toast = useToast();

  useEffect(() => {
    fetch(`/api/posts/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? "Not found");
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);

  const retry = async () => {
    setRetrying(true);
    const res = await fetch(`/api/posts/${id}/retry`, { method: "POST" });
    const body = await res.json();
    if (!res.ok) {
      toast({ title: "Retry failed", description: body.error, variant: "error" });
    } else {
      toast({ title: body.message ?? `Retrying ${body.retried?.length ?? 0} job(s)`, variant: "success" });
      window.location.reload();
    }
    setRetrying(false);
  };

  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />;
  if (!data) return <LoadingState />;

  const { post } = data;

  return (
    <div>
      <Link href="/posts" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Back to posts
      </Link>
      <PageHeader title={post.video.fileName} description="Publishing details for this video." />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Video</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {post.video.thumbnailUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/videos/${post.video.id}/thumbnail`}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="w-full rounded-md object-cover"
                />
              )}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Size</p>
                  <p>{formatBytes(Number(post.video.fileSize ?? 0))}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Duration</p>
                  <p>{formatDuration(post.video.durationMs)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Resolution</p>
                  <p>
                    {post.video.width && post.video.height ? `${post.video.width}×${post.video.height}` : "-"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Source</p>
                  <p className="truncate">{post.video.driveSource?.folderName ?? "Drive"}</p>
                </div>
              </div>
              <div className="border-t pt-3">
                <VideoStatusBadge status={post.status as never} />
              </div>
              {post.video.invalidReason && (
                <p className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                  {post.video.invalidReason}
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-2 pt-6">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Drive file:</span> {post.video.driveFileId}
              </p>
              <p className="text-xs text-muted-foreground">
                The original file stays in Google Drive — Auto Reel Poster never stores or deletes it.
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Platform results</CardTitle>
              <Button variant="outline" size="sm" onClick={retry} disabled={retrying}>
                Retry failed jobs
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {post.jobs.length === 0 && (
                <p className="text-sm text-muted-foreground">No platform jobs were created for this video.</p>
              )}
              {post.jobs.map((j) => (
                <div key={j.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <PlatformBadge platform={j.platform as never} />
                    <JobStatusBadge status={j.status as never} />
                    <span className="text-xs text-muted-foreground">attempt {j.attemptCount}</span>
                    <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{j.socialAccount?.accountName}</span>
                      {j.publishedAt && <span>{formatDateTime(j.publishedAt)}</span>}
                    </div>
                  </div>

                  <div className="mt-2 space-y-1 text-sm">
                    {j.platformPostId && (
                      <p className="text-xs text-muted-foreground">
                        Post ID: {j.platformPostId}
                        {j.platformPostUrl && (
                          <a
                            href={j.platformPostUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-2 inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            Open <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </p>
                    )}
                    {j.errorCode && (
                      <p className="text-xs">
                        <span className="font-medium text-destructive">{j.errorCode}:</span>{" "}
                        <span className="text-muted-foreground">{j.errorMessage}</span>
                      </p>
                    )}
                    {j.status === "RETRYING" && j.nextRetryAt && (
                      <p className="text-xs text-muted-foreground">Next retry: {formatRelative(j.nextRetryAt)}</p>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Post info</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Scheduled time (UTC)</p>
                <p>{formatDateTime(post.scheduledAt)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Schedule</p>
                <p>{post.schedule?.name ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Drive source</p>
                <p>{post.video.driveSource?.folderName ?? "-"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <p>{post.status.replace(/_/g, " ")}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}