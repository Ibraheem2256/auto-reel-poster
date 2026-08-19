import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard-shell";
import { requireWorkspace } from "@/lib/workspace";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.workspaceId) {
    const { createDefaultWorkspace, getDefaultWorkspaceId } = await import("@/lib/workspace");
    await createDefaultWorkspace(user.id);
    const id = await getDefaultWorkspaceId(user.id);
    if (id) user.workspaceId = id;
  }
  await requireWorkspace(user.id, user.workspaceId!);

  return <DashboardShell>{children}</DashboardShell>;
}