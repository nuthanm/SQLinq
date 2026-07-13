import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);
const root = resolve(dirname(thisFile), "..");
const reportPath = resolve(root, "data", "quality-report.json");
const issuesDir = resolve(root, "issues", "conversion-failures");

function nowIsoCompact() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function toSlug(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 70) || "query";
}

function isFailure(row) {
  const parse = String(row.parseStatus || "").toLowerCase();
  const convert = String(row.convertStatus || "").toLowerCase();
  const status = String(row.status || "").toLowerCase();
  return parse === "fail" || convert === "fail" || status === "failed";
}

function stageLabel(row) {
  const parse = String(row.parseStatus || "").toLowerCase();
  const convert = String(row.convertStatus || "").toLowerCase();
  if (parse === "fail") return "Parser";
  if (convert === "fail") return "Converter";
  return "Unknown";
}

function issueMarkdown(row) {
  const queryId = row.id || "unknown";
  const title = row.name || "Untitled query";
  const stage = stageLabel(row);
  const createdAt = row.createdAt || new Date().toISOString();
  const target = row.target || "method";
  const connectivityMode = row.connectivityMode || "without";
  const dbTag = row.databaseType || "unknown";
  const correctness = Number(row.correctness ?? 0).toFixed(1);
  const exact = row.exactMatch ? "Yes" : "No";
  const timing = Number(row.timeMs ?? 0);
  const issueRef = row.issue || "not-linked";
  const queryType = row.queryType || "unknown";
  const elements = Array.isArray(row.queryElements) ? row.queryElements.join(", ") : String(row.queryElements || "unknown");

  return `# [Conversion Failure] ${queryId} - ${title}

## 1. Summary
- Query ID: ${queryId}
- Query Title: ${title}
- Failure Stage: ${stage}
- Status: ${row.status || "Failed"}
- Severity: High

## 2. Query Metadata
| Field | Value |
|---|---|
| Query Type | ${queryType} |
| Elements | ${elements} |
| Syntax Target | ${target} |
| Connectivity Mode | ${connectivityMode} |
| Database Tag | ${dbTag} |
| Parse Status | ${row.parseStatus || "unknown"} |
| Convert Status | ${row.convertStatus || "unknown"} |
| Correctness | ${correctness}% |
| Exact Match | ${exact} |
| Convert Time | ${timing} ms |
| Existing Issue Ref | ${issueRef} |
| Event Time | ${createdAt} |

## 3. Failure Details
- Failure Reason: ${row.failureReason || "Not provided by report"}
- Converter Status Message: ${row.status || "Failed"}
- Regression Area: ${row.area || "General"}

## 4. Reproduction Steps
1. Open SQLinq converter in VS Code.
2. Set target to ${target}.
3. Set connectivity mode to ${connectivityMode}.
4. Run conversion for query ${queryId}.
5. Observe parser/converter failure.

## 5. Expected vs Actual
### Expected
- Query should convert to valid LINQ for this supported pattern or return a clearly scoped unsupported-clause warning.

### Actual
- Conversion failed during ${stage.toLowerCase()} stage.

## 6. Impact
- Blocks successful conversion for this query shape.
- Reduces trust score and release readiness.

## 7. Action Checklist
- [ ] Reproduce locally and confirm failure.
- [ ] Add/adjust parser or conversion rule.
- [ ] Add regression test in test suite.
- [ ] Verify output in method/query/ef targets as applicable.
- [ ] Link/close this issue with fix commit.
`;
}

const reportText = await readFile(reportPath, "utf8");
const report = JSON.parse(reportText);
const rows = Array.isArray(report.queries) ? report.queries : [];
const failures = rows.filter(isFailure);

await mkdir(issuesDir, { recursive: true });

const stamp = nowIsoCompact();
const created = [];

for (const row of failures) {
  const id = row.id || "unknown";
  const name = row.name || "query";
  const fileName = `${id}-${toSlug(name)}.md`;
  const filePath = resolve(issuesDir, fileName);
  await writeFile(filePath, issueMarkdown(row), "utf8");
  created.push(fileName);
}

const index = [
  "# Conversion Failure Issue Snapshot",
  "",
  `Generated at: ${new Date().toISOString()}`,
  `Source report: data/quality-report.json`,
  `Total queries: ${rows.length}`,
  `Failures exported: ${created.length}`,
  "",
  "## Generated issue files",
  ...(created.length ? created.map((f) => `- ${f}`) : ["- None (no failures in report)"]),
  "",
  "## Notes",
  "- Files in this folder are structured local issue drafts.",
  "- Create GitHub issues from these drafts using the Conversion Failure Report template.",
  "",
].join("\n");

await writeFile(resolve(issuesDir, "README.md"), index, "utf8");
console.log(`Failure issue drafts created: ${created.length}`);
console.log(`Output folder: ${issuesDir}`);
console.log(`Run stamp: ${stamp}`);
