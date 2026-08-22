const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const now = new Date();
  console.log('Now:', now.toISOString());

  // Simulate the exact query from claimDueJobs
  const due = await prisma.platformJob.findMany({
    where: {
      status: "PENDING",
      scheduledAt: { lte: now },
      workspace: { paused: false },
      OR: [
        { scheduledPost: { is: null } },
        { scheduledPost: { scheduleId: null } },
        { workspace: { automationEnabled: true } },
      ],
    },
    include: {
      video: true,
      socialAccount: true,
      scheduledPost: true,
      workspace: true,
    },
    orderBy: { scheduledAt: "asc" },
    take: 10,
  });
  console.log('Due jobs found:', due.length);
  due.forEach(j => {
    console.log('  Job:', j.id, j.platform, j.status, 'video:', j.video.fileName, 'socialAccount:', j.socialAccount?.id ?? 'NULL');
  });
  await prisma.$disconnect();
})();
