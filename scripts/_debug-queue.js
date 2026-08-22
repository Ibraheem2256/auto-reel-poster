const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const videos = await prisma.video.findMany({
    where: { status: { in: ['PENDING','VALIDATED','QUEUED','SCHEDULED'] } },
    include: {
      platformJobs: { select: { id: true, platform: true, status: true, errorCode: true, errorMessage: true, attemptCount: true } },
      scheduledPost: { select: { scheduledAt: true } },
    },
    orderBy: { detectedAt: 'asc' },
    take: 5,
  });
  videos.forEach(v => {
    console.log('---');
    console.log('ID:', v.id);
    console.log('Title:', v.title || v.fileName);
    console.log('Status:', v.status);
    console.log('Scheduled:', v.scheduledPost?.scheduledAt?.toISOString() || 'none');
    v.platformJobs.forEach(j => {
      console.log('  Job:', j.platform, j.status, 'attempts:', j.attemptCount, j.errorCode || '', (j.errorMessage || '').substring(0, 150));
    });
  });
  await prisma.$disconnect();
})();
