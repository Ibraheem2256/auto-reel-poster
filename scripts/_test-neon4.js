const { PrismaClient } = require('@prisma/client');

const NEON_URL = "postgresql://neondb_owner:npg_2ICiJGesOd3z@ep-falling-night-b39c95qf-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

const prisma = new PrismaClient({
  datasources: { db: { url: NEON_URL } },
});

(async () => {
  const job = await prisma.platformJob.findFirst({
    where: { id: 'cmt220vak0004kysr6gsub3lo' },
    include: { workspace: true, scheduledPost: true },
  });
  if (!job) { console.log('Job not found!'); return; }

  console.log('Job ID:', job.id);
  console.log('Status:', job.status);
  console.log('scheduledAt:', job.scheduledAt?.toISOString());
  console.log('scheduledPost:', JSON.stringify(job.scheduledPost ? { id: job.scheduledPost.id, scheduleId: job.scheduledPost.scheduleId } : null));
  console.log('workspace.paused:', job.workspace.paused);
  console.log('workspace.automationEnabled:', job.workspace.automationEnabled);
  
  const now = new Date();
  console.log('\nNow:', now.toISOString());
  console.log('Due (scheduledAt <= now):', job.scheduledAt ? job.scheduledAt <= now : 'no scheduledAt');
  
  // Check what the OR clause evaluates to
  const sp = job.scheduledPost;
  const OR0 = sp === null;
  const OR1 = sp?.scheduleId === null;
  const OR2 = job.workspace.automationEnabled;
  console.log('\nOR[0] scheduledPost is null:', OR0);
  console.log('OR[1] scheduleId is null:', OR1);
  console.log('OR[2] automationEnabled:', OR2);
  console.log('Any OR true:', OR0 || OR1 || OR2);

  await prisma.$disconnect();
})();
