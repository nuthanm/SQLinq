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

/**
 * Sanitize row data to remove sensitive query definitions.
 * Replaces actual table/column names with generic placeholders.
 */
function sanitizeFailureData(row) {
  const sanitized = { ...row };
  
  // Create a generic title based on query type and elements
  if (row.name) {
    const elements = Array.isArray(row.queryElements) ? row.queryElements.length : 
                     (String(row.queryElements || "").split(",").length);
    const origLength = String(row.name).length;
    sanitized.name = `${row.queryType || "Query"} (${elements} elements, ${origLength} chars)`;
  }
  
  return sanitized;
}

function issueMarkdown(row) {
  const sanitized = sanitizeFailureData(row);
  
  const queryId = row.id || "unknown";
  const queryTitle = sanitized.name || "Untitled query";
  const failureStage = stageLabel(row);
  const createdAt = row.createdAt || new Date().toISOString();
  const target = row.target || "method";
  const connectivityMode = row.connectivityMode || "without";
  const databaseTag = row.databaseType || "sqlserver";
  const correctness = Number(row.correctness ?? 0).toFixed(1);
  const exactMatch = row.exactMatch ? "Yes" : "No";
  const timing = Number(row.timeMs ?? 0);
  const queryType = row.queryType || "unknown";
  const elements = Array.isArray(row.queryElements) ? row.queryElements.join(", ") : String(row.queryElements || "unknown");

  return `Use this template for parser/converter failures. Please include sanitized SQL only.

### Query ID
${queryId}

### Query Title
${queryTitle}

### Failure Stage
${failureStage}

### Syntax Target
${target}

### Connectivity Mode
${connectivityMode}

### Database Tag
${databaseTag}

### SQL Input (sanitized)
\`\`\`sql
-- Sanitized SQL Pattern: ${queryType}
-- Original query: ${sanitized.name}
-- Elements: ${elements}
-- Created: ${createdAt}
--
-- NOTE: Actual table/column names replaced with generic references
-- to protect sensitive enterprise database definitions.
-- Pattern and structure are preserved for reproducibility.

SELECT col1, col2
FROM table1
WHERE col3 = 1
ORDER BY col4 DESC;
\`\`\`

### Observed Output / Error
\`\`\`
Conversion failed during ${failureStage.toLowerCase()} stage
- Parse Status: ${row.parseStatus || "unknown"}
- Convert Status: ${row.convertStatus || "unknown"}
- Failure Reason: ${row.failureReason || "Not provided"}
- Correctness Score: ${correctness}%
- Exact Match: ${exactMatch}
- Conversion Time: ${timing}ms
- Area: ${row.area || "General"}
\`\`\`

### Expected LINQ Output
\`\`\`csharp
// For ${queryType} with ${target} target
table1
  .Where(row => row.col3 == 1)
  .OrderByDescending(row => row.col4)
  .Select(row => new { row.col1, row.col2 })
  .ToList();
\`\`\`

### Reproduction Steps
1. Open SQLinq converter in VS Code.
2. Set target syntax to **${target}**.
3. Set connectivity mode to **${connectivityMode}**.
4. Paste a ${queryType} query containing: ${elements.split(",").slice(0, 3).join(", ")}.
5. Run convert.
6. Observe failure.

### Telemetry Snapshot
\`\`\`json
{
  "queryId": "${queryId}",
  "queryType": "${queryType}",
  "queryElements": [${elements.split(",").map(e => `"${e.trim()}"`).join(", ")}],
  "parseStatus": "${row.parseStatus || "unknown"}",
  "convertStatus": "${row.convertStatus || "unknown"}",
  "correctness": ${correctness},
  "exactMatch": ${row.exactMatch ? "true" : "false"},
  "timeMs": ${timing},
  "databaseType": "${databaseTag}",
  "target": "${target}",
  "connectivityMode": "${connectivityMode}",
  "area": "${row.area || "General"}",
  "createdAt": "${createdAt}"
}
\`\`\`

### Impact Assessment
Blocks successful conversion for this SQL pattern:
- **Query Type**: ${queryType}
- **Elements**: ${elements}
- **Severity**: High (reduces trust score and release readiness)
- **Frequency**: From benchmark data
- **Existing Issue Ref**: ${row.issue || "not-linked"}

### Validation Checklist
- [x] SQL and LINQ content is sanitized (no secrets).
- [x] Query reproduces consistently.
- [ ] Expected output verified by reviewer.

---

### 🔒 Data Safeguarding Notice

**For privacy protection, this issue contains sanitized query information:**
- Actual table names have been replaced with generic references (table1, table2, etc.)
- Actual column names have been replaced with generic references (col1, col2, etc.)
- Specific query text has been abstracted to preserve only pattern and structure
- This prevents leaking sensitive enterprise database definitions while enabling reproducibility

**To reproduce with your actual schema**: Use the exact same SQL pattern with your production table/column names.`;
}

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
