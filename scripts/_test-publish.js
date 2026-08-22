const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  // Pick the first SCHEDULED video and set it to publish NOW
  const video = await prisma.video.findFirst({
    where: { status: 'SCHEDULED' },
    orderBy: { detectedAt: 'asc' },
  });
  if (!video) { console.log('No scheduled video found'); return; }

  const now = new Date(Date.now() + 30000); // 30 seconds from now
  await prisma.video.update({ where: { id: video.id }, data: { scheduledAt: now } });
  await prisma.scheduledPost.updateMany({ where: { videoId: video.id }, data: { scheduledAt: now } });
  await prisma.platformJob.updateMany({ where: { videoId: video.id, status: 'PENDING' }, data: { scheduledAt: now } });

  console.log('Updated video:', video.id, video.title || video.fileName);
  console.log('New scheduledAt:', now.toISOString());
  console.log('Will publish in ~30 seconds via cron trigger');
  await prisma.$disconnect();
})();
