require("dotenv").config();

const path = require("path");
const fs = require("fs/promises");
const express = require("express");
const { Pool } = require("pg");

const app = express();
const PORT = Number(process.env.PORT || 5173);
const root = __dirname;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(root));

function dbEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

function buildPool() {
  if (!dbEnabled()) return null;
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
}

const pool = buildPool();

function dashSummary() {
  return {
    generatedAt: null,
    suiteVersion: null,
    releaseTarget: null,
    totals: {
      totalQueries: null,
      exactMatches: null,
      failed: null,
      partial: null,
      avgCorrectness: null,
      avgTimeMs: null,
      medianTimeMs: null,
      p95TimeMs: null,
    },
    queries: [],
    source: "unavailable",
    message: "No benchmark report is available yet. Run benchmark pipeline or import report.",
  };
}

async function loadLatestQualityFromDb() {
  if (!pool) return null;

  const runRes = await pool.query(
    `SELECT id, suite_version, release_target, generated_at, totals
     FROM benchmark_runs
     ORDER BY generated_at DESC
     LIMIT 1`
  );

  if (!runRes.rows.length) return null;

  const run = runRes.rows[0];
  const qRes = await pool.query(
    `SELECT query_id, name, area, parse_status, convert_status, correctness,
            exact_match, time_ms, status, issue_ref, failure_reason, release_bucket
     FROM benchmark_queries
     WHERE run_id = $1
     ORDER BY query_id ASC`,
    [run.id]
  );

  return {
    generatedAt: run.generated_at,
    suiteVersion: run.suite_version,
    releaseTarget: run.release_target,
    totals: run.totals || {},
    queries: qRes.rows.map((r) => ({
      id: r.query_id,
      name: r.name,
      area: r.area,
      parseStatus: r.parse_status,
      convertStatus: r.convert_status,
      correctness: Number(r.correctness),
      exactMatch: Boolean(r.exact_match),
      timeMs: Number(r.time_ms),
      status: r.status,
      issue: r.issue_ref,
      failureReason: r.failure_reason,
      releaseBucket: r.release_bucket,
    })),
    source: "database",
    message: null,
  };
}

function summarizeConversionEvent(row, index) {
  const payload = row.payload || {};
  const sqlText = String(payload.sql || payload.message || '').trim();
  const firstLine = sqlText.split(/\r?\n/).find(Boolean) || '';
  const displayName = firstLine ? firstLine.slice(0, 72) : `Conversion event ${index + 1}`;
  const area = payload.connectivityMode
    ? `${payload.connectivityMode} connectivity`
    : row.connectivity_mode || 'Live conversion';

  return {
    id: payload.queryId || `E${String(row.id).padStart(4, '0')}`,
    name: displayName,
    area,
    parseStatus: row.parse_status,
    convertStatus: row.convert_status,
    correctness: Number(row.correctness || 0),
    exactMatch: Boolean(row.exact_match),
    timeMs: Number(row.time_ms || 0),
    status: Boolean(row.exact_match) ? 'Exact' : (row.convert_status === 'Partial' ? 'Partial' : 'Failed'),
    issue: row.issue_ref || null,
  };
}

async function loadLatestConversionEventsFromDb() {
  if (!pool) return null;

  const res = await pool.query(
    `SELECT id, source, connectivity_mode, parse_status, convert_status, correctness,
            exact_match, time_ms, issue_ref, payload, created_at
     FROM conversion_events
     ORDER BY created_at DESC
     LIMIT 50`
  );

  if (!res.rows.length) return null;

  const rows = res.rows;
  const total = rows.length;
  const exactMatches = rows.filter((row) => row.exact_match).length;
  const failed = rows.filter((row) => row.convert_status === 'Fail').length;
  const partial = rows.filter((row) => row.convert_status === 'Partial').length;
  const correctnessAvg = rows.reduce((sum, row) => sum + Number(row.correctness || 0), 0) / total;
  const avgTimeMs = rows.reduce((sum, row) => sum + Number(row.time_ms || 0), 0) / total;

  return {
    generatedAt: rows[0].created_at,
    suiteVersion: 'live-events',
    releaseTarget: 'database',
    totals: {
      totalQueries: total,
      exactMatches,
      failed,
      partial,
      avgCorrectness: Number(correctnessAvg.toFixed(2)),
      avgTimeMs: Number(avgTimeMs.toFixed(2)),
      medianTimeMs: null,
      p95TimeMs: null,
    },
    queries: rows.map((row, index) => summarizeConversionEvent(row, index)),
    source: 'conversion-events',
    message: null,
  };
}

async function loadLatestQualityFromFile() {
  const p = path.join(root, "data", "quality-report.json");
  try {
    const text = await fs.readFile(p, "utf8");
    const parsed = JSON.parse(text);
    return {
      ...parsed,
      source: "file",
      message: null,
    };
  } catch {
    return null;
  }
}

app.get("/api/health", async (_req, res) => {
  const out = {
    ok: true,
    dbConnected: false,
    databaseUrlConfigured: dbEnabled(),
    timestamp: new Date().toISOString(),
  };

  if (pool) {
    try {
      await pool.query("SELECT 1");
      out.dbConnected = true;
    } catch {
      out.dbConnected = false;
    }
  }

  res.json(out);
});

app.get("/api/dashboard/quality", async (_req, res) => {
  try {
    const dbReport = await loadLatestQualityFromDb();
    if (dbReport) return res.json(dbReport);

    const fileReport = await loadLatestQualityFromFile();
    if (fileReport) return res.json(fileReport);

    return res.json(dashSummary());
  } catch (err) {
    return res.status(500).json({
      ...dashSummary(),
      source: "error",
      message: err.message,
    });
  }
});

app.get("/api/dashboard/conversion-events", async (_req, res) => {
  try {
    const eventReport = await loadLatestConversionEventsFromDb();
    if (eventReport) return res.json(eventReport);
    return res.json({
      generatedAt: null,
      suiteVersion: null,
      releaseTarget: null,
      totals: {
        totalQueries: 0,
        exactMatches: 0,
        failed: 0,
        partial: 0,
        avgCorrectness: 0,
        avgTimeMs: 0,
        medianTimeMs: null,
        p95TimeMs: null,
      },
      queries: [],
      source: 'conversion-events',
      message: 'No conversion events are available yet.',
    });
  } catch (err) {
    return res.status(500).json({
      generatedAt: null,
      suiteVersion: null,
      releaseTarget: null,
      totals: {
        totalQueries: 0,
        exactMatches: 0,
        failed: 0,
        partial: 0,
        avgCorrectness: 0,
        avgTimeMs: 0,
        medianTimeMs: null,
        p95TimeMs: null,
      },
      queries: [],
      source: 'error',
      message: err.message,
    });
  }
});

app.post("/api/events/conversion", async (req, res) => {
  const payload = req.body || {};

  if (!pool) {
    return res.status(202).json({
      accepted: false,
      stored: false,
      message: "DATABASE_URL is not configured. Event not persisted.",
    });
  }

  try {
    await pool.query(
      `INSERT INTO conversion_events (
        source, connectivity_mode, parse_status, convert_status,
        correctness, exact_match, time_ms, issue_ref, payload
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        payload.source || "vscode-extension",
        payload.connectivityMode || "without",
        payload.parseStatus || "Unknown",
        payload.convertStatus || "Unknown",
        payload.correctness == null ? null : Number(payload.correctness),
        payload.exactMatch == null ? null : Boolean(payload.exactMatch),
        payload.timeMs == null ? null : Number(payload.timeMs),
        payload.issue || null,
        payload,
      ]
    );
    return res.status(202).json({ accepted: true, stored: true });
  } catch (err) {
    return res.status(500).json({ accepted: false, stored: false, message: err.message });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(root, "index.html"));
});

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    const mode = dbEnabled() ? "database-enabled" : "database-disabled";
    console.log(`SQLinq app running at http://localhost:${PORT} (${mode})`);
  });
}
