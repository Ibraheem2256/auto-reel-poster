const { PrismaClient } = require('@prisma/client');

const NEON_URL = "postgresql://neondb_owner:npg_2ICiJGesOd3z@ep-falling-night-b39c95qf-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

const prisma = new PrismaClient({
  datasources: { db: { url: NEON_URL } },
});

(async () => {
  const video = await prisma.video.findFirst({
    where: { status: 'SCHEDULED' },
    orderBy: { detectedAt: 'asc' },
  });
  if (!video) { console.log('No scheduled video found'); await prisma.$disconnect(); return; }

  const now = new Date(Date.now() + 30000);
  await prisma.video.update({ where: { id: video.id }, data: { scheduledAt: now } });
  await prisma.scheduledPost.updateMany({ where: { videoId: video.id }, data: { scheduledAt: now } });
  await prisma.platformJob.updateMany({ where: { videoId: video.id, status: 'PENDING' }, data: { scheduledAt: now } });

  console.log('Updated on NEON:', video.id, video.title || video.fileName);
  console.log('New scheduledAt:', now.toISOString());

  // Verify
  const job = await prisma.platformJob.findFirst({
    where: { videoId: video.id },
    include: { workspace: true, scheduledPost: true },
  });
  console.log('Job status:', job?.status, 'scheduledAt:', job?.scheduledAt.toISOString());
  console.log('workspace.paused:', job?.workspace.paused);
  console.log('workspace.automationEnabled:', job?.workspace.automationEnabled);

  await prisma.$disconnect();
})();
