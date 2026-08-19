/**
 * Local cron daemon — runs every scheduled job on a loop so posts publish
 * automatically when their time arrives (no external trigger needed).
 *
 * Intervals:
 *   publish       every 60s        (fires due posts within ~1 minute of their time)
 *   scan          every SCAN_INTERVAL_MINUTES (default 10)
 *   check-status  every 5 minutes
 *   retry         every 5 minutes
 *   cleanup       every 60 minutes
 *   token-check   every 60 minutes
 *
 * Usage: npm run cron:daemon
 */
import { loadEnvFile } from "node:process";
try {
  loadEnvFile();
} catch {
  // no .env file — rely on the process environment
}

const secret = process.env.CRON_SECRET ?? "";
if (!secret) {
  console.error("CRON_SECRET is not set");
  process.exit(1);
}

const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
const scanIntervalMin = Number(process.env.SCAN_INTERVAL_MINUTES ?? 10) || 10;

interface JobDef {
  name: string;
  intervalMs: number;
  firstDelayMs: number;
}

const JOBS: JobDef[] = [
  { name: "publish", intervalMs: 60_000, firstDelayMs: 1_000 },
  { name: "check-status", intervalMs: 5 * 60_000, firstDelayMs: 8_000 },
  { name: "retry", intervalMs: 5 * 60_000, firstDelayMs: 15_000 },
  { name: "scan", intervalMs: scanIntervalMin * 60_000, firstDelayMs: 20_000 },
  { name: "token-check", intervalMs: 60 * 60_000, firstDelayMs: 45_000 },
  { name: "cleanup", intervalMs: 60 * 60_000, firstDelayMs: 60_000 },
];

function ts(): string {
  return new Date().toLocaleTimeString();
}

async function runJob(name: string): Promise<void> {
  try {
    const started = Date.now();
    const res = await fetch(`${baseUrl}/api/cron/${name}`, {
      method: "POST",
      headers: { "x-cron-secret": secret },
    });
    const body = await res.text().catch(() => "");
    const ms = Date.now() - started;
    if (res.ok) {
      console.log(`[${ts()}] ${name} OK (${ms}ms): ${body}`);
    } else {
      console.error(`[${ts()}] ${name} FAILED (${res.status}): ${body}`);
    }
  } catch (err) {
    console.error(`[${ts()}] ${name} ERROR: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function schedule(def: JobDef): void {
  setTimeout(() => {
    runJob(def.name);
    setInterval(() => runJob(def.name), def.intervalMs);
  }, def.firstDelayMs);
}

console.log(`[${ts()}] Cron daemon started -> ${baseUrl}`);
console.log(`[${ts()}] publish every 60s · scan every ${scanIntervalMin}min · check/retry every 5min`);
console.log(`[${ts()}] cleanup & token-check hourly. Press Ctrl+C to stop.`);

for (const def of JOBS) schedule(def);

// Keep the process alive (setInterval handles it, but be explicit).
process.stdin.resume();
