const { PrismaClient } = require('@prisma/client');

const NEON_URL = "postgresql://neondb_owner:npg_2ICiJGesOd3z@ep-falling-night-b39c95qf-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

const prisma = new PrismaClient({
  datasources: { db: { url: NEON_URL } },
});

(async () => {
  const job = await prisma.platformJob.findFirst({
    where: { id: 'cmt20yzot0006wv7xil1zgcex' },
    select: { id: true, status: true, errorCode: true, errorMessage: true, attemptCount: true, nextRetryAt: true, retryable: true },
  });
  console.log('Job:', JSON.stringify(job, null, 2));

  // Also check if social account token is valid
  const sa = await prisma.socialAccount.findFirst({
    where: { platform: 'YOUTUBE' },
    select: { id: true, status: true, expiresAt: true, lastError: true },
  });
  console.log('\nYouTube account:', JSON.stringify(sa, null, 2));

  await prisma.$disconnect();
})();
