const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const jobs = await prisma.platformJob.findMany({
    where: { status: { notIn: ['PENDING'] } },
    select: { id: true, platform: true, status: true, errorCode: true, errorMessage: true, attemptCount: true, videoId: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  jobs.forEach(j => {
    console.log('Job:', j.id, '| Video:', j.videoId, '| Platform:', j.platform, '| Status:', j.status, '| Attempts:', j.attemptCount);
    if (j.errorCode) console.log('  Error code:', j.errorCode);
    if (j.errorMessage) console.log('  Error msg:', j.errorMessage.substring(0, 200));
  });
  await prisma.$disconnect();
})();
