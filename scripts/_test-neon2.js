const { PrismaClient } = require('@prisma/client');

const NEON_URL = "postgresql://neondb_owner:npg_2ICiJGesOd3z@ep-falling-night-b39c95qf-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

const prisma = new PrismaClient({
  datasources: { db: { url: NEON_URL } },
});

(async () => {
  // Find PENDING jobs
  const jobs = await prisma.platformJob.findMany({
    where: { status: 'PENDING' },
    include: { video: true, workspace: true },
    orderBy: { scheduledAt: 'asc' },
    take: 5,
  });
  
  console.log('Pending jobs on NEON:', jobs.length);
  jobs.forEach(j => {
    console.log('  Job:', j.id, '| Video:', j.video.fileName, '| scheduledAt:', j.scheduledAt.toISOString());
    console.log('    workspace.paused:', j.workspace.paused, '| automationEnabled:', j.workspace.automationEnabled);
  });

  if (jobs.length > 0) {
    const job = jobs[0];
    const now = new Date(Date.now() + 30000);
    
    await prisma.video.update({ where: { id: job.videoId }, data: { scheduledAt: now } });
    await prisma.scheduledPost.updateMany({ where: { videoId: job.videoId }, data: { scheduledAt: now } });
    await prisma.platformJob.update({ where: { id: job.id }, data: { scheduledAt: now } });
    
    console.log('\nUpdated job:', job.id, 'to publish at:', now.toISOString());
    console.log('Video:', job.video.title || job.video.fileName);
  }

  await prisma.$disconnect();
})();
