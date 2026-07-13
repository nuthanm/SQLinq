import "dotenv/config";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const thisFile = fileURLToPath(import.meta.url);
const root = resolve(dirname(thisFile), "..");
const reportPath = resolve(root, "data", "quality-report.json");

if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL. Configure Neon connection string in .env first.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const client = await pool.connect();

try {
  const text = await readFile(reportPath, "utf8");
  const report = JSON.parse(text);

  await client.query("BEGIN");

  const runRes = await client.query(
    `INSERT INTO benchmark_runs (suite_version, release_target, generated_at, totals)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [
      report.suiteVersion || "unknown",
      report.releaseTarget || "unknown",
      report.generatedAt || new Date().toISOString(),
      report.totals || {},
    ]
  );

  const runId = runRes.rows[0].id;

  for (const q of report.queries || []) {
    await client.query(
      `INSERT INTO benchmark_queries (
        run_id, query_id, name, area, parse_status, convert_status,
        correctness, exact_match, time_ms, status, issue_ref, failure_reason, release_bucket
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12, $13
      )`,
      [
        runId,
        q.id,
        q.name,
        q.area,
        q.parseStatus,
        q.convertStatus,
        Number(q.correctness ?? 0),
        Boolean(q.exactMatch),
        Number(q.timeMs ?? 0),
        q.status,
        q.issue,
        q.failureReason,
        q.releaseBucket,
      ]
    );
  }

  await client.query("COMMIT");
  console.log(`Imported quality report into benchmark_runs id=${runId}`);
} catch (err) {
  await client.query("ROLLBACK");
  console.error("Failed to import quality report:", err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
