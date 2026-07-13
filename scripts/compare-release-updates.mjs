import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);
const root = resolve(dirname(thisFile), "..");
const updatesPath = resolve(root, "data", "release-updates.json");
const outPath = resolve(root, "data", "release-compare.json");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "";
    args[key] = value;
    if (value) i += 1;
  }
  return args;
}

function toSet(values) {
  return new Set((values || []).map((v) => String(v || "").trim()).filter(Boolean));
}

function pickRelease(records, tag, fallbackIndex) {
  if (tag) {
    return records.find((r) => String(r.releaseTag) === String(tag)) || null;
  }
  return records[fallbackIndex] || null;
}

const args = parseArgs(process.argv);
const raw = await readFile(updatesPath, "utf8");
const parsed = JSON.parse(raw);
const releases = Array.isArray(parsed.releases) ? parsed.releases : [];

if (releases.length < 2 && (!args.from || !args.to)) {
  throw new Error("At least two release records are needed to compare. Generate another release snapshot first.");
}

const toRelease = pickRelease(releases, args.to, 0);
const fromRelease = pickRelease(releases, args.from, 1);

if (!toRelease || !fromRelease) {
  throw new Error("Requested release tags were not found in data/release-updates.json");
}

const toOpen = toSet(toRelease.openIssues);
const fromOpen = toSet(fromRelease.openIssues);

const fixedIssues = [...fromOpen].filter((issue) => issue && !toOpen.has(issue));
const newIssues = [...toOpen].filter((issue) => issue && !fromOpen.has(issue));
const persistentIssues = [...toOpen].filter((issue) => issue && fromOpen.has(issue));

const compare = {
  generatedAt: new Date().toISOString(),
  fromRelease: {
    releaseTag: fromRelease.releaseTag,
    generatedAt: fromRelease.generatedAt,
    totalQueries: Number(fromRelease.totalQueries || 0),
    failures: Number(fromRelease.failures || 0),
    edgeCaseFailures: Number(fromRelease.edgeCaseFailures || 0),
    openIssueCount: fromOpen.size,
  },
  toRelease: {
    releaseTag: toRelease.releaseTag,
    generatedAt: toRelease.generatedAt,
    totalQueries: Number(toRelease.totalQueries || 0),
    failures: Number(toRelease.failures || 0),
    edgeCaseFailures: Number(toRelease.edgeCaseFailures || 0),
    openIssueCount: toOpen.size,
  },
  deltas: {
    totalQueries: Number(toRelease.totalQueries || 0) - Number(fromRelease.totalQueries || 0),
    failures: Number(toRelease.failures || 0) - Number(fromRelease.failures || 0),
    edgeCaseFailures: Number(toRelease.edgeCaseFailures || 0) - Number(fromRelease.edgeCaseFailures || 0),
    openIssues: toOpen.size - fromOpen.size,
  },
  fixedIssues,
  fixedIssueCount: fixedIssues.length,
  newIssues,
  newIssueCount: newIssues.length,
  persistentIssues,
  persistentIssueCount: persistentIssues.length,
};

await writeFile(outPath, `${JSON.stringify(compare, null, 2)}\n`, "utf8");

console.log(`Release comparison generated: ${fromRelease.releaseTag} -> ${toRelease.releaseTag}`);
console.log(`Output: ${outPath}`);
console.log(`Fixed issues: ${fixedIssues.length}, New issues: ${newIssues.length}, Persistent: ${persistentIssues.length}`);
