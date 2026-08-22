const { PrismaClient } = require('@prisma/client');

const NEON_URL = "postgresql://neondb_owner:npg_2ICiJGesOd3z@ep-falling-night-b39c95qf-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

const prisma = new PrismaClient({
  datasources: { db: { url: NEON_URL } },
});

(async () => {
  const now = new Date();
  console.log('Now:', now.toISOString());

  // Check exact claimDueJobs query
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
    select: { id: true, platform: true, scheduledAt: true, video: { select: { fileName: true } } },
    orderBy: { scheduledAt: "asc" },
    take: 10,
  });

  console.log('Due PENDING jobs:', due.length);
  due.forEach(j => console.log('  ', j.id, j.platform, j.video.fileName, 'at:', j.scheduledAt.toISOString()));

  // Show all PENDING jobs with their scheduledAt
  const all = await prisma.platformJob.findMany({
    where: { status: "PENDING" },
    select: { id: true, scheduledAt: true, video: { select: { fileName: true } } },
    orderBy: { scheduledAt: "asc" },
  });
  console.log('\nAll PENDING jobs:');
  all.forEach(j => console.log('  ', j.id, j.video.fileName, 'at:', j.scheduledAt?.toISOString() ?? 'NULL'));

  // Set the first one to publish NOW
  if (all.length > 0) {
    const pubAt = new Date(Date.now() + 20000);
    const target = all[0];
    await prisma.platformJob.update({ where: { id: target.id }, data: { scheduledAt: pubAt } });
    // Also update scheduledPost if exists
    const sp = await prisma.scheduledPost.findFirst({ where: { videoId: (await prisma.platformJob.findUnique({ where: { id: target.id } }))?.videoId } });
    if (sp) await prisma.scheduledPost.update({ where: { id: sp.id }, data: { scheduledAt: pubAt } });
    const vid = (await prisma.platformJob.findUnique({ where: { id: target.id } }))?.videoId;
    if (vid) await prisma.video.update({ where: { id: vid }, data: { scheduledAt: pubAt } });
    console.log('\nSet', target.id, target.video.fileName, 'to publish at:', pubAt.toISOString());
  }

  await prisma.$disconnect();
})();
