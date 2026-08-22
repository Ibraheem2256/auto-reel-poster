const { PrismaClient } = require('@prisma/client');

const NEON_URL = "postgresql://neondb_owner:npg_2ICiJGesOd3z@ep-falling-night-b39c95qf-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

const prisma = new PrismaClient({
  datasources: { db: { url: NEON_URL } },
});

(async () => {
  const accounts = await prisma.socialAccount.findMany({
    select: { id: true, platform: true, platformAccountId: true, accountName: true, status: true, expiresAt: true },
  });
  console.log('Social accounts:', accounts.length);
  accounts.forEach(a => console.log('  ', a.platform, a.id, 'name:', a.accountName, 'status:', a.status, 'expires:', a.expiresAt?.toISOString() ?? 'never'));

  const jobs = await prisma.platformJob.findMany({
    where: { status: 'PENDING' },
    select: { id: true, socialAccountId: true, platform: true, scheduledAt: true, video: { select: { fileName: true } } },
    orderBy: { scheduledAt: 'asc' },
    take: 5,
  });
  console.log('\nPending jobs:');
  jobs.forEach(j => {
    const exists = accounts.find(a => a.id === j.socialAccountId);
    console.log('  Job:', j.id, j.platform, 'socialAccountId:', j.socialAccountId ?? 'NULL', '-> account exists:', !!exists, '| video:', j.video.fileName);
  });

  await prisma.$disconnect();
})();
