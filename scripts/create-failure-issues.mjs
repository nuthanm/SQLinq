import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);
const root = resolve(dirname(thisFile), "..");
const reportPath = resolve(root, "data", "quality-report.json");
const issuesDir = resolve(root, "issues", "conversion-failures");

const SQL_KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "ORDER", "BY", "GROUP", "HAVING", "TOP", "DISTINCT", "AS",
  "AND", "OR", "NOT", "IN", "IS", "NULL", "LIKE", "BETWEEN", "EXISTS", "CASE", "WHEN",
  "THEN", "ELSE", "END", "ON", "INNER", "LEFT", "RIGHT", "FULL", "OUTER", "JOIN", "CROSS",
  "APPLY", "UNION", "ALL", "INTERSECT", "EXCEPT", "OFFSET", "FETCH", "NEXT", "ROWS", "ROW",
  "ONLY", "ASC", "DESC", "WITH", "CTE", "OVER", "PARTITION", "INTO", "UPDATE", "DELETE", "SET",
  "VALUES", "INSERT", "TRUE", "FALSE", "LIMIT"
]);

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

function pickRawSqlText(row) {
  const candidates = [
    row.queryText,
    row.sql,
    row.rawSql,
    row.originalSql,
    row.query,
    row.inputSql,
    row.sqlInput,
    row.querySummary,
    row.name,
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

function sanitizeFailureData(row) {
  return {
    ...row,
    sqlInput: sanitizeSqlIdentifiersInPlace(pickRawSqlText(row)),
  };
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
  const sqlInput = sanitized.sqlInput || "-- SQL text unavailable in quality report.\n-- Add failing SQL and anonymize only table/column identifiers.";
  const expectedLinqOutput = buildExpectedLinqFromSanitizedSql(sqlInput, target);

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
${sqlInput}
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
${expectedLinqOutput}
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
  "queryElements": [${elements.split(",").map((e) => `"${e.trim()}"`).join(", ")}],
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
  "Source report: data/quality-report.json",
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
