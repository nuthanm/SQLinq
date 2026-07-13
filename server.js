require("dotenv").config();

const path = require("path");
const fs = require("fs/promises");
const express = require("express");
const { Pool } = require("pg");

const app = express();
const PORT = Number(process.env.PORT || 5173);
const root = __dirname;

const CLEAN_ROUTES = {
  "/": "index.html",
  "/release-planning": "release-planning.html",
  "/about": "about.html",
  "/contact": "contact.html",
  "/copyright": "copyright.html",
  "/privacy": "privacy.html",
  "/terms": "terms.html",
  "/sitemap": "sitemap.html",
  "/github-stats": "github-stats.html",
  "/visual-workflow": "visual-workflow.html",
  "/metric-details": "metric-details.html",
};

app.use(express.json({ limit: "1mb" }));

// Canonicalize legacy .html and extension URLs before static files are served.
app.get("/:page.html", (req, res, next) => {
  const page = `/${req.params.page.toLowerCase()}`;
  if (Object.prototype.hasOwnProperty.call(CLEAN_ROUTES, page)) {
    return res.redirect(301, page);
  }
  return next();
});

app.get("/extension", (_req, res) => {
  res.redirect(301, "/#extension");
});

app.get("/extension/vscode", (_req, res) => {
  res.redirect(301, "/#extension");
});

app.use(express.static(root));

Object.entries(CLEAN_ROUTES).forEach(([route, file]) => {
  if (route === "/") return;
  app.get(route, (_req, res) => {
    res.sendFile(path.join(root, file));
  });
});

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

function deriveQueryType(clauses) {
  const set = new Set((clauses || []).map((c) => String(c).toUpperCase()));
  const has = (name) => set.has(name);
  if (has('SELECT ALL')) return 'Basic select all columns';
  if (has('COLUMN PROJECTION') && has('TABLE ALIAS') && !has('WHERE') && !has('ORDER BY')) {
    return 'Basic select with column names using alias';
  }
  if (has('COLUMN PROJECTION') && !has('WHERE') && !has('ORDER BY')) {
    return 'Basic select with column names';
  }
  if (has('JOIN')) return 'Join query';
  if (has('GROUP BY')) return 'Aggregate query';
  if (has('WHERE') && has('ORDER BY')) return 'Filtered + sorted SELECT';
  if (has('WHERE')) return 'Filtered SELECT';
  if (has('ORDER BY')) return 'Sorted SELECT';
  return 'Basic SELECT';
}

function targetConceptLabel(target) {
  if (target === 'query') return 'LINQ query comprehension';
  if (target === 'ef') return 'EF Core IQueryable pipeline';
  return 'LINQ method chain';
}

function summarizeConversionEvent(row, index) {
  const payload = row.payload || {};
  const sqlSummary = String(payload.querySummary || payload.message || '').trim();
  const connectivityMode = payload.connectivityMode || row.connectivity_mode || 'without';
  const target = payload.target || 'method';
  const databaseType = payload.databaseType || (connectivityMode === 'with' ? 'connected' : 'without');
  const area = `${connectivityMode} connectivity`;
  const clauses = Array.isArray(payload.queryElementsDetailed)
    ? payload.queryElementsDetailed.map((c) => String(c || '').toUpperCase()).filter(Boolean)
    : Array.isArray(payload.clauseProfile)
      ? payload.clauseProfile.map((c) => String(c || '').toUpperCase()).filter(Boolean)
    : [];
  const queryElements = clauses.length ? clauses : ['SELECT'];
  const queryType = String(payload.queryTypeLabel || '').trim() || deriveQueryType(queryElements);
  const concept = `${targetConceptLabel(target)} · ${connectivityMode === 'with' ? 'with DB connectivity' : 'without DB connectivity'}`;
  const displayName = sqlSummary && !/^clauses\s*:/i.test(sqlSummary)
    ? sqlSummary.slice(0, 72)
    : queryType;

  return {
    id: payload.queryId || `E${String(row.id).padStart(4, '0')}`,
    name: displayName,
    area,
    queryType,
    queryElements,
    concept,
    queryFingerprint: payload.queryFingerprint || null,
    target,
    connectivityMode,
    databaseType,
    createdAt: row.created_at,
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
      WHERE COALESCE(payload->>'isTest', 'false') <> 'true'
       AND COALESCE(payload->>'queryFingerprint', '') NOT ILIKE 'fmanual%'
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
  const connectivityMode = String(payload.connectivityMode || "without").toLowerCase() === "with"
    ? "with"
    : "without";
  const targetRaw = String(payload.target || "method").toLowerCase();
  const target = ["method", "query", "ef"].includes(targetRaw) ? targetRaw : "method";
  const allowedDbTypes = new Set(["mssql", "postgresql", "mysql", "oracle", "sqlite", "connected"]);
  const dbRaw = String(payload.databaseType || "connected").toLowerCase();
  const databaseType = connectivityMode === "with"
    ? (allowedDbTypes.has(dbRaw) ? dbRaw : "connected")
    : "without";
  const isTest = Boolean(payload.isTest)
    || String(payload.source || "").toLowerCase().includes("test")
    || String(payload.queryFingerprint || "").toLowerCase().startsWith("fmanual");
  const sanitizedPayload = {
    source: payload.source || "vscode-extension",
    isTest,
    connectivityMode,
    target,
    databaseType,
    parseStatus: payload.parseStatus || "Unknown",
    convertStatus: payload.convertStatus || "Unknown",
    correctness: payload.correctness == null ? null : Number(payload.correctness),
    exactMatch: payload.exactMatch == null ? null : Boolean(payload.exactMatch),
    timeMs: payload.timeMs == null ? null : Number(payload.timeMs),
    issue: payload.issue || null,
    message: payload.message || null,
    queryFingerprint: payload.queryFingerprint || null,
    querySummary: payload.querySummary || null,
    queryTypeLabel: payload.queryTypeLabel || null,
    sqlLength: payload.sqlLength == null ? null : Number(payload.sqlLength),
    clauseProfile: Array.isArray(payload.clauseProfile) ? payload.clauseProfile : [],
    queryElementsDetailed: Array.isArray(payload.queryElementsDetailed) ? payload.queryElementsDetailed : [],
  };

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
        sanitizedPayload.source,
        sanitizedPayload.connectivityMode,
        sanitizedPayload.parseStatus,
        sanitizedPayload.convertStatus,
        sanitizedPayload.correctness,
        sanitizedPayload.exactMatch,
        sanitizedPayload.timeMs,
        sanitizedPayload.issue,
        sanitizedPayload,
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
