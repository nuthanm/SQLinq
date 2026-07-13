import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);
const root = resolve(dirname(thisFile), "..");
const sourcePath = resolve(root, "data/quality-query-results.json");
const targetPath = resolve(root, "data/quality-report.json");

function normalizeStatus(value) {
  if (value === true) return "Pass";
  if (value === false) return "Fail";
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "pass" || lower === "ok" || lower === "true") return "Pass";
    if (lower === "partial") return "Partial";
    if (lower === "fail" || lower === "false") return "Fail";
  }
  return "Pass";
}

function rowStatus(row) {
  if (row.parseStatus === "Fail" || row.convertStatus === "Fail") return "Failed";
  if (row.parseStatus === "Partial" || row.convertStatus === "Partial") return "Partial";
  if (row.exactMatch) return "Exact";
  if (row.correctness >= 85) return "Near match";
  return "Partial";
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

const rawText = await readFile(sourcePath, "utf8");
const rawRows = JSON.parse(rawText);

const rows = rawRows.map((row) => {
  const parseStatus = normalizeStatus(row.parserOk);
  const convertStatus = normalizeStatus(row.converterOk);
  const correctness = Number(row.correctness ?? 0);
  const exactMatch = Boolean(row.exactMatch);

  return {
    id: row.id,
    name: row.name,
    area: row.area,
    parseStatus,
    convertStatus,
    correctness,
    exactMatch,
    timeMs: Number(row.timeMs ?? 0),
    status: rowStatus({ parseStatus, convertStatus, exactMatch, correctness }),
    issue: row.issue ?? null,
    failureReason: row.failureReason ?? null,
    releaseBucket: row.releaseBucket ?? null,
  };
});

const times = rows.map((r) => r.timeMs);
const failures = rows.filter((r) => r.status === "Failed");
const partials = rows.filter((r) => r.status === "Partial");
const exact = rows.filter((r) => r.exactMatch).length;
const avgCorrectness = rows.reduce((sum, r) => sum + r.correctness, 0) / (rows.length || 1);

const report = {
  generatedAt: new Date().toISOString(),
  suiteVersion: "generated-local",
  releaseTarget: "v0.3.0",
  totals: {
    totalQueries: rows.length,
    exactMatches: exact,
    failed: failures.length,
    partial: partials.length,
    avgCorrectness: Number(avgCorrectness.toFixed(2)),
    avgTimeMs: Number((times.reduce((sum, t) => sum + t, 0) / (times.length || 1)).toFixed(2)),
    medianTimeMs: Number(median(times).toFixed(2)),
    p95TimeMs: Number(percentile(times, 95).toFixed(2)),
  },
  queries: rows,
};

await writeFile(targetPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Quality report generated: ${targetPath}`);
