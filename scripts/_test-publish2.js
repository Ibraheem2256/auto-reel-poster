const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const video = await prisma.video.findFirst({
    where: { id: 'cmsw9qnox001xa36ec3vnaig4' },
    include: {
      platformJobs: true,
      scheduledPost: true,
    },
  });
  if (!video) { console.log('Video not found'); return; }
  console.log('Status:', video.status);
  console.log('scheduledAt:', video.scheduledAt?.toISOString());
  console.log('scheduledPost:', video.scheduledPost?.scheduledAt?.toISOString());
  video.platformJobs.forEach(j => {
    console.log('Job:', j.platform, j.status, 'scheduledAt:', j.scheduledAt.toISOString(), 'nextRetry:', j.nextRetryAt?.toISOString());
  });
  await prisma.$disconnect();
})();
