import { Badge } from "@/components/ui/badge";
import type { JobStatus, VideoStatus, AccountStatus, DriveSourceStatus } from "@prisma/client";

const VIDEO_STATUS_MAP: Record<VideoStatus, { label: string; variant: "success" | "warning" | "info" | "destructive" | "secondary" | "muted" }> = {
  PENDING: { label: "Pending", variant: "muted" },
  VALIDATED: { label: "Validated", variant: "info" },
  QUEUED: { label: "Queued", variant: "info" },
  SCHEDULED: { label: "Scheduled", variant: "info" },
  UPLOADING: { label: "Uploading", variant: "warning" },
  PUBLISHED: { label: "Published", variant: "success" },
  PARTIALLY_PUBLISHED: { label: "Partially Published", variant: "warning" },
  FAILED: { label: "Failed", variant: "destructive" },
  SKIPPED: { label: "Skipped", variant: "secondary" },
  INVALID: { label: "Invalid", variant: "destructive" },
};

const JOB_STATUS_MAP: Record<JobStatus, { label: string; variant: "success" | "warning" | "info" | "destructive" | "secondary" | "muted" }> = {
  PENDING: { label: "Pending", variant: "muted" },
  PROCESSING: { label: "Uploading", variant: "warning" },
  SUCCESS: { label: "Success", variant: "success" },
  FAILED: { label: "Failed", variant: "destructive" },
  RETRYING: { label: "Retrying", variant: "warning" },
  SKIPPED: { label: "Skipped", variant: "secondary" },
  CANCELLED: { label: "Cancelled", variant: "secondary" },
};

export function VideoStatusBadge({ status }: { status: VideoStatus }) {
  const cfg = VIDEO_STATUS_MAP[status];
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const cfg = JOB_STATUS_MAP[status];
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  if (status === "CONNECTED") return <Badge variant="success">Connected</Badge>;
  if (status === "EXPIRED") return <Badge variant="warning">Expired</Badge>;
  if (status === "REVOKED") return <Badge variant="destructive">Revoked</Badge>;
  return <Badge variant="destructive">Error</Badge>;
}

export function DriveStatusBadge({ status }: { status: DriveSourceStatus }) {
  if (status === "CONNECTED") return <Badge variant="success">Connected</Badge>;
  if (status === "ERROR") return <Badge variant="destructive">Error</Badge>;
  return <Badge variant="secondary">Disconnected</Badge>;
}