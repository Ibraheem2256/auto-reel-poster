/**
 * Starts an embedded PostgreSQL instance for local development.
 * No installation required — binaries are downloaded on npm install.
 *
 * Usage:
 *   node scripts/start-db.mjs          # start & wait (prints "READY")
 *   node scripts/start-db.mjs stop     # stop a previously started instance
 */
import EmbeddedPostgres from "embedded-postgres";

const PORT = Number(process.env.DB_PORT ?? 5432);
const DATA_DIR = "./.pgdata";
const DB_NAME = "auto_reel_poster";

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: "postgres",
  password: "postgres",
  port: PORT,
  persistent: true,
});

async function start() {
  try {
    await pg.initialise();
  } catch (err) {
    // Already initialised — fine.
  }
  try {
    await pg.start();
  } catch (err) {
    console.error("Postgres failed to start. Is port " + PORT + " already in use?");
    console.error(String(err).slice(0, 500));
    process.exit(1);
  }
  try {
    await pg.createDatabase(DB_NAME);
    console.log("Database '" + DB_NAME + "' ready.");
  } catch {
    // Already exists.
  }
  console.log("READY");
}

async function stop() {
  try {
    await pg.stop();
    console.log("STOPPED");
  } catch (err) {
    console.error(String(err).slice(0, 300));
  }
}

if (process.argv[2] === "stop") {
  await stop();
} else {
  await start();
}