const { PrismaClient } = require('@prisma/client');

const NEON_URL = "postgresql://neondb_owner:npg_2ICiJGesOd3z@ep-falling-night-b39c95qf-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

const prisma = new PrismaClient({
  datasources: { db: { url: NEON_URL } },
});

(async () => {
  const now = new Date(Date.now() + 60000); // 1 min from now

  // Find next PENDING job and set it to publish
  const job = await prisma.platformJob.findFirst({
    where: { status: 'PENDING' },
    include: { video: true, workspace: true, scheduledPost: true },
    orderBy: { scheduledAt: 'asc' },
  });

  if (!job) {
    console.log('No PENDING jobs found!');
    // Show all job statuses
    const all = await prisma.platformJob.groupBy({ by: ['status'], _count: { _all: true } });
    console.log('Job statuses:', JSON.stringify(all));
    await prisma.$disconnect();
    return;
  }

  console.log('Found PENDING job:', job.id);
  console.log('  Video:', job.video.fileName, job.video.title?.substring(0, 50));
  console.log('  Current scheduledAt:', job.scheduledAt.toISOString());
  console.log('  SocialAccount:', job.socialAccount?.platformAccountId ?? 'MISSING!');
  console.log('  SocialAccountId:', job.socialAccountId ?? 'MISSING!');

  // Set to 30s from now
  const publishAt = new Date(Date.now() + 30000);
  await prisma.platformJob.update({ where: { id: job.id }, data: { scheduledAt: publishAt } });
  if (job.scheduledPost) {
    await prisma.scheduledPost.update({ where: { id: job.scheduledPost.id }, data: { scheduledAt: publishAt } });
  }
  await prisma.video.update({ where: { id: job.videoId }, data: { scheduledAt: publishAt } });

  console.log('\nUpdated to publish at:', publishAt.toISOString());
  console.log('Trigger publish in ~30 seconds!');

  await prisma.$disconnect();
})();
