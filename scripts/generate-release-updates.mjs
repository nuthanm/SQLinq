import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);
const root = resolve(dirname(thisFile), "..");

const qualityPath = resolve(root, "data", "quality-report.json");
const updatesPath = resolve(root, "data", "release-updates.json");
const issuesPath = resolve(root, "issues", "conversion-failures", "README.md");

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "";
    out[key] = value;
    if (value) i += 1;
  }
  return out;
}

function parseIssueFilesCount(text) {
  const m = String(text || "").match(/Failures exported:\s*(\d+)/i);
  return m ? Number(m[1]) : 0;
}

function isFailure(q) {
  const parse = String(q.parseStatus || "").toLowerCase();
  const convert = String(q.convertStatus || "").toLowerCase();
  const status = String(q.status || "").toLowerCase();
  return parse === "fail" || convert === "fail" || status === "failed";
}

function isEdgeCase(q) {
  const area = String(q.area || "").toLowerCase();
  const name = String(q.name || "").toLowerCase();
  return area.includes("edge") || name.includes("edge case") || name.includes("edge-case");
}

function toSet(arr) {
  return new Set((arr || []).map((v) => String(v || "").trim()).filter(Boolean));
}

async function readJsonSafe(path, fallback) {
  try {
    const text = await readFile(path, "utf8");
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

const args = parseArgs(process.argv);
const quality = await readJsonSafe(qualityPath, { queries: [], totals: {}, releaseTarget: "v-next" });
const existing = await readJsonSafe(updatesPath, { generatedAt: null, releases: [] });

let issueReadme = "";
try {
  issueReadme = await readFile(issuesPath, "utf8");
} catch {
  issueReadme = "";
}

const rows = Array.isArray(quality.queries) ? quality.queries : [];
const totals = quality.totals || {};
const failureRows = rows.filter(isFailure);
const edgeRows = rows.filter(isEdgeCase);
const edgeFailures = edgeRows.filter(isFailure);

const currentIssues = toSet(failureRows.map((q) => q.issue));

const previousReleases = Array.isArray(existing.releases) ? existing.releases : [];
const previousIssueSet = previousReleases.length ? toSet(previousReleases[0].openIssues || []) : new Set();
const fixedIssues = [...previousIssueSet].filter((issue) => issue && !currentIssues.has(issue));

const releaseTag =
  args.release ||
  process.env.RELEASE_TAG ||
  quality.releaseTarget ||
  `v${new Date().toISOString().slice(0, 10)}`;

const generatedAt = new Date().toISOString();
const totalQueries = Number(totals.totalQueries ?? rows.length ?? 0);
const exactMatches = Number(totals.exactMatches ?? rows.filter((q) => q.exactMatch).length);
const failures = Number(totals.failed ?? failureRows.length);
const partials = Number(totals.partial ?? rows.filter((q) => String(q.convertStatus || "").toLowerCase() === "partial").length);

const pushedChanges = [
  `${totalQueries} benchmark queries evaluated`,
  `${exactMatches} exact matches`,
  `${failures} failed conversions and ${partials} partial conversions`,
  `${edgeRows.length} edge-case scenarios tracked (${edgeFailures.length} failures)`,
  `${fixedIssues.length} previously open conversion issues resolved in this release cycle`,
];

const newRecord = {
  releaseTag,
  generatedAt,
  sourceQualityGeneratedAt: quality.generatedAt || null,
  sourceSuiteVersion: quality.suiteVersion || null,
  totalQueries,
  exactMatches,
  failures,
  partials,
  edgeCaseTotal: edgeRows.length,
  edgeCaseFailures: edgeFailures.length,
  openIssues: [...currentIssues],
  fixedIssues,
  fixedIssueCount: fixedIssues.length,
  failureIssueDraftCount: parseIssueFilesCount(issueReadme),
  pushedChanges,
};

const withoutCurrent = previousReleases.filter((r) => String(r.releaseTag) !== String(releaseTag));
const updated = {
  generatedAt,
  releases: [newRecord, ...withoutCurrent],
};

await mkdir(resolve(root, "data"), { recursive: true });
await writeFile(updatesPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");

console.log(`Release updates generated for ${releaseTag}`);
console.log(`Output: ${updatesPath}`);
console.log(`Fixed issues detected: ${fixedIssues.length}`);
