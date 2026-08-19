/**
 * Local cron runner for self-hosted / non-serverless environments.
 * Usage: npm run cron:scan | publish | check | retry | cleanup | tokencheck
 * In production (Vercel/Cloudflare), use platform cron triggers hitting
 * /api/cron/<job> with the X-Cron-Secret header instead.
 */
import { loadEnvFile } from "node:process";
try {
  loadEnvFile();
} catch {
  // no .env file — rely on the process environment
}

const job = process.argv[2];
if (!job) {
  console.error("Usage: tsx scripts/cron.ts <scan|publish|check-status|retry|cleanup|token-check>");
  process.exit(1);
}

const secret = process.env.CRON_SECRET ?? "";
if (!secret) {
  console.error("CRON_SECRET is not set");
  process.exit(1);
}

const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

async function main() {
  const res = await fetch(`${baseUrl}/api/cron/${job}`, {
    method: "POST",
    headers: { "x-cron-secret": secret },
  });
  const body = await res.text();
  console.log(`${res.status}: ${body}`);
  if (!res.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});