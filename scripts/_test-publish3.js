const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const ws = await prisma.workspace.findFirst();
  console.log('Workspace:', ws?.id);
  console.log('paused:', ws?.paused);
  console.log('automationEnabled:', ws?.automationEnabled);
  console.log('autoEditEnabled:', ws?.autoEditEnabled);

  // Check if job meets criteria
  const job = await prisma.platformJob.findFirst({
    where: { videoId: 'cmsw9qnox001xa36ec3vnaig4' },
    include: { scheduledPost: true, workspace: true },
  });
  if (job) {
    console.log('\nJob:', job.id);
    console.log('Status:', job.status);
    console.log('scheduledAt:', job.scheduledAt.toISOString());
    console.log('scheduledPost:', job.scheduledPost ? { scheduleId: job.scheduledPost.scheduleId } : null);
    console.log('workspace.paused:', job.workspace.paused);
    console.log('workspace.automationEnabled:', job.workspace.automationEnabled);
    const now = new Date();
    console.log('now:', now.toISOString());
    console.log('is due:', job.scheduledAt <= now);
  }
  await prisma.$disconnect();
})();
