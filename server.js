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

function buildPoolFromConnectionString(connectionString) {
  const value = String(connectionString || "").trim();
  if (!value) return null;
  return new Pool({
    connectionString: value,
    ssl: { rejectUnauthorized: false },
  });
}

function detectDatabaseTypeFromConnectionString(connectionString) {
  const connStr = String(connectionString || "").toLowerCase();
  
  if (/^server=|^data source=|^sqlserver|sql\.azure|\.database\.windows\.net/.test(connStr)) {
    return 'mssql';
  }
  if (/^postgres:\/\/|host=.*port=5432|postgresql/.test(connStr)) {
    return 'postgresql';
  }
  if (/^mysql:\/\/|host=.*port=3306/.test(connStr)) {
    return 'mysql';
  }
  if (/^oracle:\/\/|^(oci|oracledb):/.test(connStr)) {
    return 'oracle';
  }
  
  // Default to PostgreSQL if using pg driver
  return 'postgresql';
}

function deriveDbRecommendationsSqlServer(statsText) {
  const recs = [];
  const text = String(statsText || '');
  if (/Table.*Scan/i.test(text)) recs.push('Table Scan detected — consider adding a clustered or non-clustered index on the filtered columns.');
  if (/CPU time.*= (\d+)ms/i.test(text)) {
    const match = text.match(/CPU time.*= (\d+)ms/i);
    const cpuTime = parseInt(match[1], 10);
    if (cpuTime > 1000) recs.push('High CPU time detected — review query plan and consider index optimization.');
  }
  if (/elapsed time.*= (\d+)ms/i.test(text)) {
    const match = text.match(/elapsed time.*= (\d+)ms/i);
    const elapsedTime = parseInt(match[1], 10);
    if (elapsedTime > 5000) recs.push('Long execution time — optimize indexes and ensure statistics are current.');
  }
  if (/Sort/i.test(text)) recs.push('Sort operation detected — verify ORDER BY columns are indexed.');
  if (/Hash Match|Merge Join|Nested Loop/i.test(text)) recs.push('Complex join detected — ensure join columns have indexes and statistics.');
  if (!recs.length) recs.push('No major performance concerns detected.');
  return recs;
}

const pool = buildPool();
let conversionEventsTableEnsured = false;

async function ensureConversionEventsTable() {
  if (!pool || conversionEventsTableEnsured) return;
  await pool.query(
    `CREATE TABLE IF NOT EXISTS conversion_events (
      id BIGSERIAL PRIMARY KEY,
      source TEXT NOT NULL,
      connectivity_mode TEXT NOT NULL,
      parse_status TEXT NOT NULL,
      convert_status TEXT NOT NULL,
      correctness NUMERIC(5,2),
      exact_match BOOLEAN,
      time_ms NUMERIC(10,2),
      issue_ref TEXT,
      payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_conversion_events_created_at ON conversion_events(created_at DESC)`
  );
  conversionEventsTableEnsured = true;
}

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

function validateSqlSyntaxServer(sql) {
  const normalized = String(sql || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')
    .trim()
    .replace(/;+\s*$/, '');
  
  if (!normalized) return { valid: false, reason: 'SQL is empty' };
  
  // Check for trailing commas in SELECT
  const selectMatch = normalized.match(/^select\s+(.*?)\s+from/i);
  if (selectMatch) {
    const selectList = selectMatch[1].trim();
    if (/,\s*$/.test(selectList) || /^,/.test(selectList)) {
      return { valid: false, reason: 'Syntax error: invalid comma in SELECT clause' };
    }
  }
  
  // Check for trailing commas or incomplete clauses
  if (/,\s*(where|from|group|having|order|;|$)/i.test(normalized) || /(and\s*$|or\s*$|,\s*$)/i.test(normalized)) {
    return { valid: false, reason: 'Syntax error: trailing comma or incomplete clause' };
  }
  
  // Check for mismatched parentheses
  let parenDepth = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    if (ch === '(') parenDepth += 1;
    if (ch === ')') parenDepth -= 1;
    if (parenDepth < 0) return { valid: false, reason: 'Syntax error: mismatched parentheses' };
  }
  if (parenDepth !== 0) return { valid: false, reason: 'Syntax error: unclosed parentheses' };
  
  return { valid: true };
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
    queryText: payload.queryText || payload.sql || payload.querySummary || null,
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
    if (dbEnabled()) {
      const dbReport = await loadLatestQualityFromDb();
      if (dbReport) return res.json(dbReport);
      return res.json({
        ...dashSummary(),
        source: "database",
        message: "No database benchmark report is available yet.",
      });
    }

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
  
  // Validate SQL syntax before storing
  const queryText = payload.queryText || payload.sql || '';
  if (queryText) {
    const sqlCheck = validateSqlSyntaxServer(queryText);
    if (!sqlCheck.valid) {
      return res.status(400).json({
        accepted: false,
        stored: false,
        message: `SQL validation failed: ${sqlCheck.reason}. Event not persisted.`,
      });
    }
  }
  
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
    queryText: payload.queryText || payload.sql || null,
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
    await ensureConversionEventsTable();
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
    if (/relation\s+"?conversion_events"?\s+does not exist/i.test(String(err.message || ""))) {
      conversionEventsTableEnsured = false;
      return res.status(202).json({
        accepted: true,
        stored: false,
        message: "conversion_events table is missing; telemetry accepted but not persisted yet.",
      });
    }
    return res.status(500).json({ accepted: false, stored: false, message: err.message });
  }
});

const SQL_KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "ORDER", "BY", "GROUP", "HAVING", "TOP", "DISTINCT", "AS",
  "AND", "OR", "NOT", "IN", "IS", "NULL", "LIKE", "BETWEEN", "EXISTS", "CASE", "WHEN",
  "THEN", "ELSE", "END", "ON", "INNER", "LEFT", "RIGHT", "FULL", "OUTER", "JOIN", "CROSS",
  "APPLY", "UNION", "ALL", "INTERSECT", "EXCEPT", "OFFSET", "FETCH", "NEXT", "ROWS", "ROW",
  "ONLY", "ASC", "DESC", "WITH", "CTE", "OVER", "PARTITION", "INTO", "UPDATE", "DELETE", "SET",
  "VALUES", "INSERT", "TRUE", "FALSE", "LIMIT"
]);

function cleanSqlIdentifier(token) {
  return String(token || "").trim().replace(/^\[|\]$/g, "").replace(/^"|"$/g, "").replace(/^`|`$/g, "");
}

function maskSqlStrings(sql) {
  const values = [];
  const text = String(sql || "").replace(/'(?:''|[^'])*'/g, (m) => {
    const key = `__SQL_STR_${values.length}__`;
    values.push(m);
    return key;
  });
  return { text, values };
}

function unmaskSqlStrings(sql, values) {
  let out = String(sql || "");
  values.forEach((value, idx) => {
    out = out.replaceAll(`__SQL_STR_${idx}__`, value);
  });
  return out;
}

function looksLikeSql(text) {
  const sample = String(text || "").trim();
  if (!sample) return false;
  return /\b(select|with|insert|update|delete)\b/i.test(sample);
}

function pickRawSqlText(data) {
  const candidates = [
    data.queryText,
    data.sql,
    data.rawSql,
    data.originalSql,
    data.query,
    data.inputSql,
    data.sqlInput,
    data.querySummary,
  ];
  return candidates.find(looksLikeSql) || "";
}

function sanitizeSqlIdentifiersInPlace(rawSql) {
  if (!looksLikeSql(rawSql)) return "";

  const { text: masked, values } = maskSqlStrings(rawSql);
  const tableMap = new Map();
  const columnMap = new Map();
  const aliasSet = new Set();

  const tableName = (token) => {
    const key = cleanSqlIdentifier(token).toLowerCase();
    if (!tableMap.has(key)) {
      const index = tableMap.size + 1;
      tableMap.set(key, index === 1 ? "[schema].[TableName]" : `[schema].[TableName${index}]`);
    }
    return tableMap.get(key);
  };

  const columnName = (token) => {
    const key = cleanSqlIdentifier(token).toLowerCase();
    if (!columnMap.has(key)) columnMap.set(key, `Col${columnMap.size + 1}`);
    return columnMap.get(key);
  };

  let sql = masked.replace(
    /\b(from|join|into|update|delete\s+from)\s+((?:\[[^\]]+\]|"[^"]+"|`[^`]+`|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:\[[^\]]+\]|"[^"]+"|`[^`]+`|[A-Za-z_][\w$]*)){0,2})(\s+(?:as\s+)?([A-Za-z_][\w$]*))?/gi,
    (match, kw, tableExpr, aliasPart, alias) => {
      const rawSegments = String(tableExpr)
        .split(".")
        .map((s) => s.trim())
        .filter(Boolean);
      const base = rawSegments.length ? rawSegments[rawSegments.length - 1] : tableExpr;
      const sanitizedTable = tableName(base);
      if (alias) aliasSet.add(String(alias).toLowerCase());
      return `${kw} ${sanitizedTable}${aliasPart || ""}`;
    }
  );

  sql = sql.replace(
    /([A-Za-z_][\w$]*|\[[^\]]+\]|"[^"]+"|`[^`]+`)\s*\.\s*(\*|[A-Za-z_][\w$]*|\[[^\]]+\]|"[^"]+"|`[^`]+`)/g,
    (match, left, right) => {
      if (right === "*") return `${left}.*`;
      return `${left}.${columnName(right)}`;
    }
  );

  sql = sql.replace(/\b[A-Za-z_][\w$]*\b/g, (token, offset, source) => {
    const upper = token.toUpperCase();
    const lower = token.toLowerCase();
    const prev = source[offset - 1] || "";
    const next = source[offset + token.length] || "";

    if (SQL_KEYWORDS.has(upper)) return token;
    if (aliasSet.has(lower)) return token;
    if (/^TableName\d*$/i.test(token) || /^Col\d+$/i.test(token)) return token;
    if (/^__SQL_STR_\d+__$/i.test(token)) return token;
    if (prev === "[" && next === "]") return token;
    if (prev === "@" || prev === "#") return token;
    if (next === "(") return token;
    return columnName(token);
  });

  return unmaskSqlStrings(sql, values);
}

function sanitizeFailureData(data) {
  const sanitized = { ...data };
  sanitized.sqlInput = sanitizeSqlIdentifiersInPlace(pickRawSqlText(data));
  return sanitized;
}

function toCollectionNameFromSqlTable(tableExpr) {
  const lastSegment = String(tableExpr || "")
    .split(".")
    .map((s) => s.trim())
    .filter(Boolean)
    .pop() || "TableName";
  const clean = cleanSqlIdentifier(lastSegment).replace(/[^A-Za-z0-9_]/g, "") || "TableName";
  return clean.charAt(0).toLowerCase() + clean.slice(1);
}

function qualifyWhereForRow(whereText) {
  return String(whereText || "")
    .replace(/\bAND\b/gi, "&&")
    .replace(/\bOR\b/gi, "||")
    .replace(/<>/g, "!=")
    .replace(/\s=\s/g, " == ")
    .replace(/\b([A-Za-z_][\w]*)\b/g, (token, ident, offset, source) => {
      const upper = ident.toUpperCase();
      const prev = source[offset - 1] || "";
      const next = source[offset + token.length] || "";
      if (prev === "." || prev === "@" || prev === "#") return token;
      if (next === "(") return token;
      if (["AND", "OR", "NOT", "NULL", "IN", "IS", "LIKE", "BETWEEN", "TRUE", "FALSE"].includes(upper)) return token;
      if (/^\d+$/.test(token)) return token;
      if (/^Col\d+$/i.test(token)) return `row.${token}`;
      return token;
    })
    .trim();
}

function splitTopLevelCsv(text) {
  const parts = [];
  let current = "";
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(") depth += 1;
    if (ch === ")" && depth > 0) depth -= 1;
    if (ch === "," && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function buildExpectedLinqFromSanitizedSql(sqlInput, target) {
  const sql = String(sqlInput || "").trim().replace(/;\s*$/, "");
  const match = sql.match(/^SELECT\s+([\s\S]+?)\s+FROM\s+([\s\S]+)$/i);
  if (!match) return "// Unable to infer expected LINQ from this SQL shape.";

  let selectPart = match[1].trim();
  const fromRest = match[2].trim();

  let topN = null;
  const topMatch = selectPart.match(/^TOP\s*\(\s*(\d+)\s*\)\s+([\s\S]+)$/i);
  if (topMatch) {
    topN = Number(topMatch[1]);
    selectPart = topMatch[2].trim();
  }

  const fromTokens = fromRest.split(/\s+/);
  const tableExpr = fromTokens.shift() || "[schema].[TableName]";
  const tail = fromTokens.join(" ");
  const whereMatch = tail.match(/\bWHERE\b([\s\S]*?)(?=\bORDER\s+BY\b|$)/i);
  const orderMatch = tail.match(/\bORDER\s+BY\b([\s\S]*)$/i);

  const whereText = whereMatch ? qualifyWhereForRow(whereMatch[1].trim()) : "";
  const orderItems = orderMatch
    ? splitTopLevelCsv(orderMatch[1]).map((item) => {
      const m = item.trim().match(/^(.*?)(?:\s+(ASC|DESC))?$/i);
      const expr = (m && m[1] ? m[1] : item).trim();
      const dir = ((m && m[2]) || "ASC").toUpperCase();
      const rowExpr = /^Col\d+$/i.test(expr) ? `row.${expr}` : expr;
      return { rowExpr, desc: dir === "DESC" };
    })
    : [];

  const columns = splitTopLevelCsv(selectPart);
  const projection = columns.length === 1 && columns[0] === "*"
    ? "row"
    : `new { ${columns.map((col) => {
      const c = col.trim();
      return /^Col\d+$/i.test(c) ? `row.${c}` : c;
    }).join(", ")} }`;

  const collection = toCollectionNameFromSqlTable(tableExpr);

  if (String(target || "").toLowerCase() === "query") {
    const lines = [`from row in ${collection}`];
    if (whereText) lines.push(`where ${whereText}`);
    if (orderItems.length) {
      lines.push(`orderby ${orderItems.map((o) => `${o.rowExpr}${o.desc ? " descending" : ""}`).join(", ")}`);
    }
    lines.push(`select ${projection}`);
    const queryExpr = lines.join("\n");
    if (topN) {
      return `(${queryExpr})\n  .Take(${topN})\n  .ToList();`;
    }
    return `${queryExpr}\n  .ToList();`;
  }

  const methodLines = [collection];
  if (whereText) methodLines.push(`  .Where(row => ${whereText})`);
  orderItems.forEach((o, i) => {
    const method = i === 0 ? (o.desc ? "OrderByDescending" : "OrderBy") : (o.desc ? "ThenByDescending" : "ThenBy");
    methodLines.push(`  .${method}(row => ${o.rowExpr})`);
  });
  if (topN) methodLines.push(`  .Take(${topN})`);
  if (projection !== "row") methodLines.push(`  .Select(row => ${projection})`);
  methodLines.push("  .ToList();");
  return methodLines.join("\n");
}

async function createGitHubIssue(failureData) {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER || "nuthanm";
  const repo = process.env.GITHUB_REPO || "SQLinq";

  if (!token) {
    throw new Error("GITHUB_TOKEN not configured in environment");
  }

  const sanitized = sanitizeFailureData(failureData);
  
  const queryId = sanitized.id || "unknown";
  const queryTitle = sanitized.name || "Untitled query";
  const failureStage = sanitized.parseStatus === "Fail" ? "Parser" : "Converter";
  const syntaxTarget = sanitized.target || "method";
  const connectivityMode = sanitized.connectivityMode || "without";
  const databaseTag = sanitized.databaseType || "sqlserver";
  const correctness = Number(sanitized.correctness ?? 0).toFixed(1);
  const exactMatch = sanitized.exactMatch ? "Yes" : "No";
  const timing = Number(sanitized.timeMs ?? 0);
  const queryType = sanitized.queryType || "unknown";
  const sqlInput = sanitized.sqlInput || "-- SQL text unavailable in telemetry.\n-- Please paste the failing SQL and keep only identifiers anonymized.";
  const expectedLinqOutput = buildExpectedLinqFromSanitizedSql(sqlInput, syntaxTarget);

  const querySearchId = String(queryId || "").trim();

  if (querySearchId) {
    const searchQuery = encodeURIComponent(`repo:${owner}/${repo} is:issue in:title ${querySearchId}`);
    const existingRes = await fetch(`https://api.github.com/search/issues?q=${searchQuery}&per_page=1`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Accept": "application/vnd.github+json",
      },
    });

    if (existingRes.ok) {
      const existingJson = await existingRes.json();
      const existing = Array.isArray(existingJson?.items) ? existingJson.items[0] : null;
      if (existing?.number) {
        return {
          issueNumber: existing.number,
          issueUrl: existing.html_url,
          queryId,
          alreadyExists: true,
        };
      }
    }
  }

  // Format issue body to match the GitHub issue form template
  // The form fields are automatically parsed from the markdown headers
  const body = `Use this template for parser/converter failures. Please include sanitized SQL only.

### Query ID
${queryId}

### Query Title
${queryTitle}

### Failure Stage
${failureStage}

### Syntax Target
${syntaxTarget}

### Connectivity Mode
${connectivityMode}

### Database Tag
${databaseTag}

### SQL Input (sanitized)
\`\`\`sql
${sqlInput}
\`\`\`

### Observed Output / Error
\`\`\`
Conversion failed during ${failureStage.toLowerCase()} stage
- Parse Status: ${sanitized.parseStatus || "unknown"}
- Convert Status: ${sanitized.convertStatus || "unknown"}
- Failure Reason: ${sanitized.failureReason || "Not provided"}
- Correctness Score: ${correctness}%
- Exact Match: ${exactMatch}
- Conversion Time: ${timing}ms
\`\`\`

### Expected LINQ Output
\`\`\`csharp
${expectedLinqOutput}
\`\`\`

### Reproduction Steps
1. Open SQLinq converter in VS Code.
2. Set target syntax to **${syntaxTarget}**.
3. Set connectivity mode to **${connectivityMode}**.
4. Paste a ${queryType} query containing: ${Array.isArray(sanitized.queryElements) ? sanitized.queryElements.slice(0, 3).join(", ") : "SELECT, FROM, WHERE"}.
5. Run convert.
6. Observe failure.

### Telemetry Snapshot
\`\`\`json
{
  "queryId": "${queryId}",
  "queryType": "${queryType}",
  "parseStatus": "${sanitized.parseStatus || "unknown"}",
  "convertStatus": "${sanitized.convertStatus || "unknown"}",
  "correctness": ${correctness},
  "exactMatch": ${sanitized.exactMatch ? "true" : "false"},
  "timeMs": ${timing},
  "databaseType": "${databaseTag}",
  "area": "${sanitized.area || "General"}"
}
\`\`\`

### Impact Assessment
Blocks successful conversion for this SQL pattern:
- **Query Type**: ${queryType}
- **Elements**: ${Array.isArray(sanitized.queryElements) ? sanitized.queryElements.join(", ") : "multiple"}
- **Severity**: High (reduces trust score and release readiness)
- **Frequency**: Unknown (from benchmark data)

### Validation Checklist
- [x] SQL and LINQ content is sanitized (no secrets).
- [x] Query reproduces consistently.
- [ ] Expected output verified by reviewer.

---

### 🔒 Data Safeguarding Notice

**For privacy protection, this issue contains sanitized query information:**
- Actual table names are replaced with placeholders like [schema].[TableName]
- Actual column names are replaced with placeholders like Col1, Col2
- Specific query text has been abstracted to preserve only pattern and structure
- This prevents leaking sensitive enterprise database definitions while enabling reproducibility

**To reproduce with your actual schema**: Use the exact same SQL pattern with your production table/column names.`;

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: `[Conversion Failure]: ${queryId} ${queryTitle}`,
      body: body,
      labels: ["bug", "conversion", "needs-triage"],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API error: ${response.status} ${errorText}`);
  }

  const issue = await response.json();
  return {
    issueNumber: issue.number,
    issueUrl: issue.html_url,
    queryId: queryId,
    alreadyExists: false,
  };
}

async function updateQueryIssueRef(queryId, issueNumber) {
  if (!pool) return;
  try {
    await pool.query(
      `UPDATE benchmark_queries
       SET issue_ref = $1
       WHERE query_id = $2`,
      [`#${issueNumber}`, queryId]
    );
  } catch (err) {
    console.error(`Failed to update issue ref for query ${queryId}:`, err.message);
  }
}

app.post("/api/github-issues/create", async (req, res) => {
  try {
    const failureData = req.body || {};

    if (!failureData.id) {
      return res.status(400).json({ ok: false, message: "Missing query ID" });
    }

    const result = await createGitHubIssue(failureData);

    if (failureData.id) {
      await updateQueryIssueRef(failureData.id, result.issueNumber);
    }

    return res.json({
      ok: true,
      issueNumber: result.issueNumber,
      issueUrl: result.issueUrl,
      alreadyExists: Boolean(result.alreadyExists),
      message: result.alreadyExists
        ? `Issue #${result.issueNumber} already exists`
        : `Issue #${result.issueNumber} created successfully`,
    });
  } catch (err) {
    console.error("GitHub issue creation failed:", err.message);
    return res.status(500).json({
      ok: false,
      message: err.message || "Failed to create GitHub issue",
    });
  }
});

function deriveDbRecommendations(explainText) {
  const recs = [];
  const text = String(explainText || '');
  if (/Seq Scan/i.test(text)) recs.push('Seq Scan detected — consider adding an index on the filtered column(s).');
  if (/cost=\d+\.\d+\.\.(\d{4,})/i.test(text)) recs.push('High estimated cost — review WHERE predicates and ensure statistics are up to date.');
  if (/Sort\s+.*cost/i.test(text) && /Sort Method:\s*external/i.test(text)) recs.push('External sort used — increase work_mem or add a covering index for the ORDER BY columns.');
  if (/Hash Join/i.test(text)) recs.push('Hash Join used — verify join columns are indexed and statistics are current.');
  if (/Nested Loop/i.test(text) && /rows=\d{5,}/i.test(text)) recs.push('Nested Loop over many rows — consider a Hash Join or Merge Join by ensuring index availability.');
  if (!recs.length) recs.push('No major performance concerns detected in the execution plan.');
  return recs;
}

app.post("/api/db/execute", async (req, res) => {
  const { sql, explain = false, connectionString } = req.body || {};
  if (!sql || typeof sql !== "string" || !sql.trim()) {
    return res.status(400).json({ ok: false, message: "sql is required." });
  }

  const requestPool = buildPoolFromConnectionString(connectionString);
  const activePool = requestPool || pool;
  if (!activePool) {
    return res.status(503).json({ ok: false, message: "Database not configured. Provide a connection string in the extension UI or set DATABASE_URL on the server." });
  }

  const stripped = sql.trim().replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "").trim();
  if (!/^(SELECT|WITH|EXPLAIN)\b/i.test(stripped)) {
    return res.status(400).json({ ok: false, message: "Only SELECT queries are permitted for live execution." });
  }

  try {
    const start = Date.now();
    const safeQuery = /LIMIT\s+\d+/i.test(stripped) ? sql : `${sql.replace(/;\s*$/, "")} LIMIT 100`;
    const result = await activePool.query(safeQuery);
    const elapsedMs = Date.now() - start;

    let explainOutput = null;
    let recommendations = [];

    if (explain) {
      try {
        const explainSql = sql.trim().replace(/;\s*$/, "");
        const planResult = await activePool.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${explainSql}`);
        explainOutput = planResult.rows.map((r) => Object.values(r)[0]).join("\n");
        recommendations = deriveDbRecommendations(explainOutput);
      } catch (explainErr) {
        explainOutput = `EXPLAIN failed: ${explainErr.message}`;
        recommendations = ['Could not retrieve execution plan.'];
      }
    }

    return res.json({
      ok: true,
      rowCount: result.rowCount,
      columns: result.fields ? result.fields.map((f) => f.name) : [],
      rows: result.rows.slice(0, 100),
      elapsedMs,
      explainOutput,
      recommendations,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  } finally {
    if (requestPool) {
      await requestPool.end().catch(() => {});
    }
  }
});

app.post("/api/db/detect", async (req, res) => {
  const { connectionString } = req.body || {};
  const connStr = String(connectionString || "").trim();

  if (!connStr) {
    // Use server default pool
    if (!pool) {
      return res.json({
        ok: false,
        connected: false,
        databaseType: null,
        databaseName: null,
        message: 'No connection configured.',
      });
    }
    try {
      const result = await pool.query('SELECT current_database() as db, version() as version');
      const dbName = result.rows[0]?.db || 'unknown';
      return res.json({
        ok: true,
        connected: true,
        databaseType: 'postgresql',
        databaseName: dbName,
        message: `Connected to PostgreSQL: ${dbName}`,
      });
    } catch (err) {
      return res.json({
        ok: false,
        connected: false,
        databaseType: 'postgresql',
        databaseName: null,
        message: `Connection failed: ${err.message}`,
      });
    }
  }

  // Detect from connection string
  const dbType = detectDatabaseTypeFromConnectionString(connStr);
  const requestPool = buildPoolFromConnectionString(connStr);

  if (!requestPool) {
    return res.json({
      ok: false,
      connected: false,
      databaseType: dbType,
      databaseName: null,
      message: `Invalid connection string for ${dbType}`,
    });
  }

  try {
    const result = await requestPool.query('SELECT current_database() as db');
    const dbName = result.rows[0]?.db || 'unknown';
    await requestPool.end();
    return res.json({
      ok: true,
      connected: true,
      databaseType: dbType,
      databaseName: dbName,
      message: `Connected to ${dbType}: ${dbName}`,
    });
  } catch (err) {
    await requestPool.end().catch(() => {});
    return res.json({
      ok: false,
      connected: false,
      databaseType: dbType,
      databaseName: null,
      message: `Connection failed: ${err.message}`,
    });
  }
});

app.post("/api/release-compare/save", async (req, res) => {
  try {
    const payload = req.body || {};
    if (!payload.fromRelease || !payload.toRelease || !payload.deltas) {
      return res.status(400).json({ ok: false, message: "Invalid compare payload." });
    }

    const out = {
      ...payload,
      generatedAt: new Date().toISOString(),
    };

    const target = path.join(root, "data", "release-compare.json");
    await fs.writeFile(target, `${JSON.stringify(out, null, 2)}\n`, "utf8");
    return res.json({ ok: true, message: "Release compare snapshot saved." });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
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
