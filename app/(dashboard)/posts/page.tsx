"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { JobStatusBadge } from "@/components/status-badges";
import { PlatformBadge } from "@/components/platform-icons";
import { LoadingState, EmptyState } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatRelative, formatDateTime } from "@/lib/utils";
import { RotateCcw, ExternalLink } from "lucide-react";

interface Post {
  id: string;
  scheduledAt: string;
  status: string;
  video: { id: string; fileName: string; thumbnailUrl: string | null };
  jobs: {
    id: string;
    platform: string;
    status: string;
    platformPostId: string | null;
    platformPostUrl: string | null;
    errorMessage: string | null;
    attemptCount: number;
    nextRetryAt: string | null;
    publishedAt: string | null;
  }[];
}

export default function PostsPage() {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const toast = useToast();

  const load = () => {
    fetch("/api/posts?pageSize=30")
      .then((r) => r.json())
      .then((d) => setPosts(d.posts))
      .catch(() => setPosts([]));
  };

  useEffect(load, []);

  const retry = async (postId: string) => {
    setRetrying(postId);
    const res = await fetch(`/api/posts/${postId}/retry`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      toast({ title: "Retry failed", description: data.error, variant: "error" });
    } else if (data.message) {
      toast({ title: data.message, variant: "info" });
    } else {
      toast({ title: "Retry queued", description: `Retrying ${data.retried?.length ?? 0} job(s)`, variant: "success" });
      load();
    }
    setRetrying(null);
  };

  return (
    <div>
      <PageHeader title="Published Posts" description="Publishing history with per-platform results." />
      {!posts ? (
        <LoadingState />
      ) : posts.length === 0 ? (
        <EmptyState title="No posts yet" description="Scheduled posts will appear here after publishing begins." />
      ) : (
        <div className="space-y-4">
          {posts.map((p) => (
            <div key={p.id} className="rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-center gap-3">
                {p.video.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/videos/${p.video.id}/thumbnail`}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-12 w-12 rounded object-cover"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded bg-muted text-[10px] text-muted-foreground">VID</div>
                )}
                <div className="min-w-0 flex-1">
                  <Link href={`/posts/${p.id}`} className="truncate font-medium hover:underline">
                    {p.video.fileName}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    Scheduled {formatDateTime(p.scheduledAt)} · {formatRelative(p.scheduledAt)}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => retry(p.id)} disabled={retrying === p.id}>
                  <RotateCcw className="h-3.5 w-3.5" /> Retry failed
                </Button>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {p.jobs.map((j) => (
                  <div key={j.id} className="rounded-md border p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <PlatformBadge platform={j.platform as never} />
                      <JobStatusBadge status={j.status as never} />
                    </div>
                    {j.platformPostUrl && (
                      <a
                        href={j.platformPostUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        View post <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    {j.errorMessage && (
                      <p className="mt-1.5 line-clamp-2 text-xs text-destructive">{j.errorMessage}</p>
                    )}
                    {j.status === "RETRYING" && j.nextRetryAt && (
                      <p className="mt-1 text-xs text-muted-foreground">Retry {formatRelative(j.nextRetryAt)} (attempt {j.attemptCount})</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}