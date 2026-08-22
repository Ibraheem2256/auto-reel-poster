const { PrismaClient } = require('@prisma/client');

const NEON_URL = "postgresql://neondb_owner:npg_2ICiJGesOd3z@ep-falling-night-b39c95qf-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

const prisma = new PrismaClient({
  datasources: { db: { url: NEON_URL } },
});

(async () => {
  const now = new Date();
  console.log('Now (UTC):', now.toISOString());

  // Exact same query as claimDueJobs
  const due = await prisma.platformJob.findMany({
    where: {
      status: "PENDING",
      scheduledAt: { lte: now },
      workspace: { paused: false },
      OR: [
        { scheduledPost: { is: null } },
        { scheduledPost: { scheduleId: null } },
        { workspace: { automationEnabled: true } },
      ],
    },
    include: {
      video: true,
      socialAccount: true,
      scheduledPost: true,
      workspace: true,
    },
    orderBy: { scheduledAt: "asc" },
    take: 10,
  });

  console.log('Due jobs:', due.length);
  due.forEach(j => {
    console.log('  Job:', j.id, j.platform, j.status);
    console.log('    Video:', j.video.fileName);
    console.log('    socialAccount:', j.socialAccount?.platformAccountId ?? 'NULL');
    console.log('    scheduledAt:', j.scheduledAt.toISOString(), '(due:', j.scheduledAt <= now, ')');
    console.log('    scheduledPost:', j.scheduledPost ? { id: j.scheduledPost.id, scheduleId: j.scheduledPost.scheduleId } : 'null');
    console.log('    workspace.paused:', j.workspace.paused, 'automation:', j.workspace.automationEnabled);
  });

  await prisma.$disconnect();
})();
