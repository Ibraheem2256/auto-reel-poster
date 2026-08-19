import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyOAuthState, encryptToken } from "@/lib/crypto";
import { exchangeGoogleCode } from "@/lib/google";
import { verifyDriveFolder } from "@/lib/drive";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error || !code || !state) {
    logger.warn("drive_oauth_error", { error, hasCode: Boolean(code) });
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/drive?error=${encodeURIComponent("Google authorization was cancelled or failed.")}`);
  }

  const payload = verifyOAuthState(state);
  if (!payload || payload.type !== "drive" || !payload.workspaceId || !payload.folderId) {
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/drive?error=${encodeURIComponent("Invalid OAuth state. Please try again.")}`);
  }

  const workspace = await prisma.workspace.findUnique({ where: { id: payload.workspaceId } });
  if (!workspace) {
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/login`);
  }

  const redirectUri = `${process.env.NEXTAUTH_URL}/api/drive/callback`;
  try {
    const tokens = await exchangeGoogleCode(code, redirectUri);
    if (!tokens.refreshToken) {
      return NextResponse.redirect(
        `${process.env.NEXTAUTH_URL}/drive?error=${encodeURIComponent("Google did not return a refresh token. Reconnect and make sure you approve the requested permissions.")}`
      );
    }

    await prisma.oAuthToken.upsert({
      where: { id: `${payload.workspaceId}:DRIVE` },
      create: {
        id: `${payload.workspaceId}:DRIVE`,
        workspaceId: payload.workspaceId,
        scope: "DRIVE",
        accessToken: encryptToken(tokens.accessToken),
        refreshToken: encryptToken(tokens.refreshToken),
        expiresAt: tokens.expiresAt,
      },
      update: {
        accessToken: encryptToken(tokens.accessToken),
        refreshToken: encryptToken(tokens.refreshToken),
        expiresAt: tokens.expiresAt,
      },
    });

    // Verify the folder and save the source.
    const folder = await verifyDriveFolder(payload.workspaceId, payload.folderId);
    await prisma.driveSource.upsert({
      where: { workspaceId_folderId: { workspaceId: payload.workspaceId, folderId: payload.folderId } },
      create: {
        workspaceId: payload.workspaceId,
        folderId: payload.folderId,
        folderName: folder.name,
        status: "CONNECTED",
      },
      update: { folderName: folder.name, status: "CONNECTED", lastError: null },
    });

    await audit({
      workspaceId: payload.workspaceId,
      action: "drive.folder_connected",
      entityType: "DriveSource",
      metadata: { folderId: payload.folderId, folderName: folder.name },
    });
    logger.info("drive_connected", { workspaceId: payload.workspaceId, folderId: payload.folderId });

    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/drive?connected=1`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("drive_callback_failed", { workspaceId: payload.workspaceId, error: message });
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/drive?error=${encodeURIComponent(message.slice(0, 300))}`);
  }
}