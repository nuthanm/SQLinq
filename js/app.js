/* Site interactions + live GitHub progress */

const cfg = window.__SITE_CONFIG__;
if (!cfg) {
  console.error("Missing js/site-config.js — run npm run sync-config");
}

const state = {
  commits: [],
  repo: null,
  issuesOpen: null,
  issuesClosed: null,
  pullRequests: null,
};

const EMPTY_QUALITY_REPORT = {
  generatedAt: null,
  suiteVersion: null,
  releaseTarget: null,
  queries: [],
};

function applyBranding() {
  if (!cfg) return;
  document.title = `${cfg.productName} — ${cfg.productTagline}`;
  const meta = document.getElementById("metaDescription");
  if (meta) meta.setAttribute("content", cfg.siteDescription);
  const favicon = document.getElementById("siteFavicon");
  if (favicon && cfg.faviconPath) favicon.setAttribute("href", cfg.faviconPath);

  document.querySelectorAll("[data-bind]").forEach((el) => {
    const key = el.getAttribute("data-bind");
    if (cfg[key] != null) el.textContent = cfg[key];
  });

  const since = document.getElementById("sinceLabel");
  if (since) {
    since.dateTime = cfg.sinceDate;
    since.textContent = formatDisplayDate(cfg.sinceDate);
  }

  const liveSince = document.getElementById("liveSinceLabel");
  if (liveSince) {
    liveSince.dateTime = cfg.sinceDate;
    liveSince.textContent = formatDisplayDate(cfg.sinceDate);
  }

  const sinceInput = document.getElementById("sinceDate");
  if (sinceInput && !sinceInput.value) sinceInput.value = cfg.sinceDate;

  const credits = document.getElementById("creditsLine");
  if (credits) credits.textContent = cfg.creditsText;

  document.querySelectorAll("#githubCta, #githubCommitsLink").forEach((a) => {
    if (!(a instanceof HTMLAnchorElement)) return;
    if (a.id === "githubCommitsLink") a.href = `${cfg.githubUrl}/commits`;
    else a.href = cfg.githubUrl;
  });

  const year = document.getElementById("currentYear");
  if (year) year.textContent = String(new Date().getFullYear());
}

function formatDisplayDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function showView(name) {
  document.querySelectorAll(".view").forEach((view) => {
    const active = view.dataset.view === name;
    view.classList.toggle("is-active", active);
    view.hidden = !active;
  });
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.toggle("is-active", link.dataset.nav === name);
  });
  const nav = document.querySelector(".nav");
  if (nav) nav.classList.remove("is-open");
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (name === "transparency") loadGithubLive();
}

function routeToSection(viewName, targetId) {
  if (viewName) showView(viewName);
  if (!targetId) return;
  window.requestAnimationFrame(() => {
    const target = document.getElementById(targetId);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

document.querySelectorAll("[data-nav]").forEach((el) => {
  el.addEventListener("click", (e) => {
    e.preventDefault();
    const name = el.dataset.nav;
    if (name) showView(name);
  });
});

document.querySelectorAll("[data-route-view]").forEach((el) => {
  el.addEventListener("click", (e) => {
    e.preventDefault();
    routeToSection(el.dataset.routeView, el.dataset.routeTarget);
  });
});

const nav = document.querySelector(".nav");

document.querySelectorAll(".ext-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const id = tab.dataset.panel;
    document.querySelectorAll(".ext-tab").forEach((t) => {
      const on = t === tab;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", String(on));
    });
    document.querySelectorAll(".ide-panel").forEach((panel) => {
      const on = panel.dataset.panel === id;
      panel.classList.toggle("is-active", on);
      panel.hidden = !on;
    });
  });
});

document.querySelectorAll(".tree-node").forEach((node) => {
  node.addEventListener("click", () => {
    const open = node.classList.toggle("is-open");
    node.setAttribute("aria-expanded", String(open));
    const branch = node.nextElementSibling;
    if (branch) branch.hidden = !open;
  });
});

document.querySelectorAll(".install-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const id = tab.dataset.install;
    document.querySelectorAll(".install-tab").forEach((btn) => {
      const on = btn === tab;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", String(on));
    });
    document.querySelectorAll(".install-panel").forEach((panel) => {
      const on = panel.dataset.installPanel === id;
      panel.classList.toggle("is-active", on);
      panel.hidden = !on;
    });
  });
});

async function ghFetch(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 180)}`);
  }
  return res.json();
}

async function loadAllCommits(sinceIso) {
  const owner = cfg.githubOwner;
  const repo = cfg.githubRepo;
  const collected = [];
  let page = 1;
  const sinceParam = sinceIso ? `&since=${encodeURIComponent(`${sinceIso}T00:00:00Z`)}` : "";

  while (page <= 10) {
    const batch = await ghFetch(
      `/repos/${owner}/${repo}/commits?per_page=100&page=${page}${sinceParam}`
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    collected.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return collected;
}

function setLivePill(text, mode) {
  const pill = document.getElementById("livePill");
  if (!pill) return;
  pill.textContent = text;
  pill.classList.remove("is-live", "is-error");
  if (mode) pill.classList.add(mode);
}

function renderMetrics() {
  const stars = document.getElementById("statStars");
  const forks = document.getElementById("statForks");
  const pullRequests = document.getElementById("statPullRequests");
  const issues = document.getElementById("statIssues");
  const commits = document.getElementById("statCommits");
  if (state.repo) {
    if (stars) stars.textContent = Number(state.repo.stargazers_count).toLocaleString();
    if (forks) forks.textContent = Number(state.repo.forks_count).toLocaleString();
  }
  if (pullRequests) {
    pullRequests.textContent =
      state.pullRequests == null ? "—" : Number(state.pullRequests).toLocaleString();
  }
  if (issues) {
    issues.textContent =
      state.issuesOpen == null ? "—" : Number(state.issuesOpen).toLocaleString();
  }
  if (commits) commits.textContent = state.commits.length.toLocaleString();

  const open = state.issuesOpen;
  const closed = state.issuesClosed;
  const identified = open != null && closed != null ? open + closed : null;
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  set("bugOpen", open == null ? "—" : String(open));
  set("bugClosed", closed == null ? "—" : String(closed));
  set("bugIdentified", identified == null ? "—" : String(identified));
  if (identified && identified > 0 && closed != null) {
    set("bugFixPct", `${((closed / identified) * 100).toFixed(1)}%`);
  } else {
    set("bugFixPct", identified === 0 ? "n/a" : "—");
  }
}

function renderCommitTable() {
  const body = document.querySelector("#commitTable tbody");
  const caption = document.getElementById("commitCaption");
  const sinceInput = document.getElementById("sinceDate");
  if (!body) return;

  const since = sinceInput?.value || cfg.sinceDate;
  const rows = state.commits.filter((c) => {
    const d = (c.commit?.author?.date || "").slice(0, 10);
    return !since || d >= since;
  });

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="4">No commits found for the selected Since date.</td></tr>`;
  } else {
    body.innerHTML = rows
      .map((c, i) => {
        const sha = (c.sha || "").slice(0, 7);
        const date = (c.commit?.author?.date || "").slice(0, 10);
        const author = c.commit?.author?.name || c.author?.login || "—";
        const message = (c.commit?.message || "").split("\n")[0];
        const url = c.html_url || "#";
        return `<tr style="animation-delay:${i * 25}ms">
          <td><a href="${url}" target="_blank" rel="noopener"><code>${sha}</code></a></td>
          <td>${date}</td>
          <td>${escapeHtml(author)}</td>
          <td>${escapeHtml(message)}</td>
        </tr>`;
      })
      .join("");
  }

  if (caption) {
    caption.textContent = `Showing ${rows.length} live commit(s) since ${since} · ${cfg.githubOwner}/${cfg.githubRepo}`;
  }
}

function renderHeatmap() {
  const root = document.getElementById("commitHeatmap");
  const caption = document.getElementById("heatCaption");
  if (!root) return;

  const counts = new Map();
  for (const c of state.commits) {
    const day = (c.commit?.author?.date || "").slice(0, 10);
    if (!day) continue;
    counts.set(day, (counts.get(day) || 0) + 1);
  }

  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 52 * 7 + ((7 - ((start.getDay() + 6) % 7)) % 7));

  const cells = [];
  const walk = new Date(start);
  while (walk <= end) {
    const key = walk.toISOString().slice(0, 10);
    const n = counts.get(key) || 0;
    const level = n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4;
    cells.push(
      `<div class="heat-cell heat-${level}" title="${key}: ${n} commit(s)"></div>`
    );
    walk.setDate(walk.getDate() + 1);
  }
  root.innerHTML = cells.join("");

  if (caption) {
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    caption.textContent = `Source: GitHub API · last ~53 weeks · ${total} commit(s) in loaded window · refreshed ${new Date().toLocaleString()}`;
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function toMs(value) {
  return `${Number(value).toFixed(1)} ms`;
}

function extractIssueNumber(issue) {
  const m = String(issue || "").match(/(\d+)/);
  return m ? m[1] : null;
}

function rankFailureAreas(rows) {
  const counts = new Map();
  rows.forEach((row) => {
    counts.set(row.area, (counts.get(row.area) || 0) + 1);
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([area]) => area);
}

function getConfidenceBand(score) {
  if (score >= 90) return "High";
  if (score >= 75) return "Medium";
  return "Low";
}

function normalizeQualityRows(rows) {
  return rows.map((row, idx) => ({
    id: row.id || `Q${String(idx + 1).padStart(3, "0")}`,
    name: row.name || `Query ${idx + 1}`,
    area: row.area || "General",
    parseStatus: row.parseStatus || "Pass",
    convertStatus: row.convertStatus || "Pass",
    correctness: Number(row.correctness ?? 0),
    exactMatch: Boolean(row.exactMatch),
    timeMs: Number(row.timeMs ?? 0),
    status: row.status || (row.exactMatch ? "Exact" : "Near match"),
    issue: row.issue || null,
  }));
}

function setQualityPill(text, mode = "live") {
  const pill = document.getElementById("qaSuitePill");
  if (!pill) return;
  pill.textContent = text;
  pill.classList.remove("is-live", "is-error");
  pill.classList.add(mode === "error" ? "is-error" : "is-live");
}

function renderQualityDashboard(report) {
  const rows = normalizeQualityRows(report?.queries || []);
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  if (!rows.length) {
    [
      "qaCorrectnessPct",
      "qaExactMatches",
      "qaTotalQueries",
      "qaExactMatchRate",
      "qaConfidenceLevel",
      "qaAvgTime",
      "qaMedianTime",
      "qaP95Time",
      "qaFastest",
      "qaSlowest",
      "qaFailures",
      "qaParserFailures",
      "qaPartials",
      "qaIssueCoverage",
      "qaNextReleaseFocus",
    ].forEach((id) => set(id, "-"));

    const body = document.querySelector("#qaTable tbody");
    if (body) {
      body.innerHTML = '<tr><td colspan="8">- No benchmark data published yet. Run benchmark pipeline and import report.</td></tr>';
    }
    const caption = document.getElementById("qaCaption");
    if (caption) {
      caption.textContent = "No benchmark report available yet. Publish data from benchmark pipeline to enable live trust metrics.";
    }
    return;
  }

  const total = rows.length;
  const exact = rows.filter((row) => row.exactMatch).length;
  const failures = rows.filter((row) => row.convertStatus === "Fail" || row.status === "Failed");
  const parserFailures = rows.filter((row) => row.parseStatus === "Fail");
  const partials = rows.filter((row) => row.parseStatus === "Partial" || row.convertStatus === "Partial" || row.status === "Partial");
  const issueLinked = failures.filter((row) => row.issue).length;
  const correctnessAvg = rows.reduce((sum, row) => sum + row.correctness, 0) / total;
  const exactRate = (exact / total) * 100;
  const failureRate = (failures.length / total) * 100;
  const confidence = Math.max(
    0,
    Math.min(100, correctnessAvg * 0.55 + exactRate * 0.35 + (100 - failureRate) * 0.1)
  );

  const timings = rows.map((row) => row.timeMs);
  const avgTime = timings.reduce((sum, val) => sum + val, 0) / timings.length;
  const median = percentile(timings, 50);
  const p95 = percentile(timings, 95);
  const fastest = Math.min(...timings);
  const slowest = Math.max(...timings);

  set("qaCorrectnessPct", `${correctnessAvg.toFixed(1)}%`);
  set("qaExactMatches", `${exact}/${total}`);
  set("qaTotalQueries", String(total));
  set("qaExactMatchRate", `${exactRate.toFixed(1)}%`);
  set("qaConfidenceLevel", `${getConfidenceBand(confidence)} (${confidence.toFixed(1)}%)`);
  set("qaAvgTime", toMs(avgTime));
  set("qaMedianTime", toMs(median));
  set("qaP95Time", toMs(p95));
  set("qaFastest", toMs(fastest));
  set("qaSlowest", toMs(slowest));
  set("qaFailures", `${failures.length}/${total}`);
  set("qaParserFailures", `${parserFailures.length}/${total}`);
  set("qaPartials", `${partials.length}/${total}`);
  set("qaIssueCoverage", failures.length ? `${((issueLinked / failures.length) * 100).toFixed(1)}%` : "100%");
  set("qaNextReleaseFocus", rankFailureAreas(failures).join(" + ") || "Stabilization");

  const body = document.querySelector("#qaTable tbody");
  if (body) {
    body.innerHTML = rows
      .map((row) => {
        const issueNo = extractIssueNumber(row.issue);
        const issueCell = issueNo && cfg?.githubUrl
          ? `<a href="${cfg.githubUrl}/issues/${issueNo}" target="_blank" rel="noopener">${escapeHtml(row.issue)}</a>`
          : row.issue
            ? escapeHtml(row.issue)
            : "—";
        const statusClass = row.status === "Exact" ? "qa-good" : row.status === "Near match" ? "qa-warn" : "qa-risk";
        return `<tr>
          <td>${escapeHtml(row.id)} · ${escapeHtml(row.name)}</td>
          <td>${escapeHtml(row.parseStatus)}</td>
          <td>${escapeHtml(row.convertStatus)}</td>
          <td>${row.correctness.toFixed(1)}%</td>
          <td>${row.exactMatch ? "Yes" : "No"}</td>
          <td>${toMs(row.timeMs)}</td>
          <td><span class="qa-pill ${statusClass}">${escapeHtml(row.status)}</span></td>
          <td>${issueCell}</td>
        </tr>`;
      })
      .join("");
  }

  const caption = document.getElementById("qaCaption");
  if (caption) {
    const suiteVersion = report?.suiteVersion || "local";
    const generatedAt = report?.generatedAt ? new Date(report.generatedAt).toLocaleString() : "n/a";
    const releaseTarget = report?.releaseTarget || "n/a";
    caption.textContent = `Suite ${suiteVersion} for ${releaseTarget} · ${total} queries · exact ${exact}/${total} · avg correctness ${correctnessAvg.toFixed(1)}% · avg convert ${toMs(avgTime)} · updated ${generatedAt}`;
  }
}

async function loadQualityDashboard() {
  setQualityPill("Loading live conversion data…");
  try {
    const liveRes = await fetch("/api/dashboard/conversion-events", { cache: "no-store" });
    if (liveRes.ok) {
      const liveReport = await liveRes.json();
      if (Array.isArray(liveReport?.queries) && liveReport.queries.length) {
        renderQualityDashboard(liveReport);
        setQualityPill("Live conversion events", "live");
        return;
      }
    }

    const res = await fetch("/api/dashboard/quality", { cache: "no-store" });
    if (!res.ok) throw new Error(`dashboard quality API unavailable (${res.status})`);
    const report = await res.json();
    renderQualityDashboard(report);
    setQualityPill(report?.source === "database" ? "Live benchmark report" : "Latest report", "live");
  } catch (err) {
    console.warn("Benchmark report unavailable:", err);
    renderQualityDashboard(EMPTY_QUALITY_REPORT);
    setQualityPill("No benchmark report", "error");
  }
}

function stripSqlNoise(sql) {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .trim()
    .replace(/;+\s*$/, "");
}

function splitTopLevel(text) {
  const parts = [];
  let current = "";
  let depth = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const prev = text[i - 1];

    if (ch === "'" && prev !== "\\" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && prev !== "\\" && !inSingle) {
      inDouble = !inDouble;
    } else if (!inSingle && !inDouble) {
      if (ch === "(") depth += 1;
      if (ch === ")" && depth > 0) depth -= 1;
      if (ch === "," && depth === 0) {
        if (current.trim()) parts.push(current.trim());
        current = "";
        continue;
      }
    }

    current += ch;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

function cleanIdentifier(identifier) {
  return String(identifier).replace(/[\[\]"]/g, "");
}

function getTableName(tableToken) {
  return cleanIdentifier(tableToken).split(".").pop() || cleanIdentifier(tableToken);
}

function inferAlias(tableToken) {
  const base = getTableName(tableToken).replace(/[^A-Za-z0-9_]/g, "");
  return (base[0] || "x").toLowerCase();
}

function toCollectionName(tableToken) {
  const base = getTableName(tableToken).replace(/[^A-Za-z0-9_]/g, "");
  return (base[0] || "x").toLowerCase() + base.slice(1);
}

function isClauseStarter(token) {
  return /^(where|order|group|having|join|inner|left|right|full|cross|union|intersect|except)$/i.test(token);
}

function qualifySqlExpression(expression, alias) {
  const reserved = new Set([
    "AND",
    "OR",
    "NOT",
    "NULL",
    "TRUE",
    "FALSE",
    "LIKE",
    "IN",
    "IS",
    "ASC",
    "DESC",
    "BETWEEN",
  ]);

  let result = String(expression).trim();

  result = result.replace(/\b([A-Za-z_][\w]*)\s+LIKE\s+'([^']*)'/gi, (_match, column, pattern) => {
    const columnRef = `${alias}.${column}`;
    const body = String(pattern).replace(/"/g, '\\"');
    const startsWithWildcard = body.startsWith("%");
    const endsWithWildcard = body.endsWith("%");
    const stripped = body.replace(/^%+|%+$/g, "");

    if (startsWithWildcard && endsWithWildcard) {
      return `${columnRef}.Contains("${stripped}")`;
    }
    if (startsWithWildcard) {
      return `${columnRef}.EndsWith("${stripped}")`;
    }
    if (endsWithWildcard) {
      return `${columnRef}.StartsWith("${stripped}")`;
    }
    return `${columnRef} == "${body}"`;
  });

  result = result.replace(/\bIS\s+NOT\s+NULL\b/gi, "!= null");
  result = result.replace(/\bIS\s+NULL\b/gi, "== null");
  result = result.replace(/\bAND\b/gi, "&&");
  result = result.replace(/\bOR\b/gi, "||");
  result = result.replace(/\bNOT\b/gi, "!");
  result = result.replace(/<>/g, "!=");
  result = result.replace(/\s=\s/g, " == ");

  return result.replace(/\b([A-Za-z_][\w]*)\b/g, (match, ident, offset, source) => {
    const upper = ident.toUpperCase();
    const prev = source[offset - 1];
    const next = source[offset + match.length];

    if (reserved.has(upper)) return ident;
    if (prev === "." || prev === "@" || prev === "#") return ident;
    if (next === "(") return ident;
    if (/^\d+$/.test(ident)) return ident;
    if (ident === alias) return ident;

    return `${alias}.${ident}`;
  });
}

function parseOrderBy(orderText, alias) {
  return splitTopLevel(orderText).map((part) => {
    const match = part.match(/^(.*?)(?:\s+(ASC|DESC))?$/i);
    const expression = match?.[1]?.trim() || part.trim();
    const direction = (match?.[2] || "ASC").toUpperCase();
    return {
      expression: qualifySqlExpression(expression, alias),
      descending: direction === "DESC",
    };
  });
}

function buildSelectProjection(columns, alias) {
  const items = splitTopLevel(columns.replace(/^DISTINCT\s+/i, "")).filter(Boolean);
  if (items.length === 0 || (items.length === 1 && items[0] === "*")) return alias;

  const projected = items.map((item) => {
    const cleaned = cleanIdentifier(item).trim();
    if (cleaned === "*") return alias;
    if (/^[A-Za-z_][\w.]*$/.test(cleaned)) {
      const columnName = cleaned.split(".").pop() || cleaned;
      return `${alias}.${columnName}`;
    }
    return qualifySqlExpression(cleaned, alias);
  });

  return `new { ${projected.join(", ")} }`;
}

function parseBasicSelect(sql) {
  const normalized = stripSqlNoise(sql);
  const selectMatch = normalized.match(/^select\s+([\s\S]+?)\s+from\s+([\s\S]+)$/i);
  if (!selectMatch) {
    return {
      ok: false,
      error: "Only basic SELECT ... FROM ... queries are supported yet.",
    };
  }

  const columns = selectMatch[1].trim();
  const fromRest = selectMatch[2].trim();
  const tokens = fromRest.split(/\s+/);
  const table = tokens.shift();
  if (!table) {
    return {
      ok: false,
      error: "Missing table name after FROM.",
    };
  }

  let alias = null;
  if (tokens.length && !isClauseStarter(tokens[0])) {
    alias = tokens.shift();
  }

  const tail = tokens.join(" ").trim();
  const whereMatch = tail.match(/\bwhere\b([\s\S]*?)(?=\border\s+by\b|$)/i);
  const orderMatch = tail.match(/\border\s+by\b([\s\S]*)$/i);
  const unsupported = [];

  if (/\bgroup\s+by\b/i.test(tail)) unsupported.push("GROUP BY");
  if (/\bhaving\b/i.test(tail)) unsupported.push("HAVING");
  if (/\bjoin\b/i.test(tail)) unsupported.push("JOIN");
  if (/\bunion\b/i.test(tail)) unsupported.push("UNION");

  return {
    ok: true,
    table,
    alias: alias || inferAlias(table),
    collection: toCollectionName(table),
    columns,
    where: whereMatch?.[1]?.trim() || "",
    orderBy: orderMatch?.[1]?.trim() || "",
    unsupported,
  };
}

function buildMethodChain(parsed) {
  const selectProjection = buildSelectProjection(parsed.columns, parsed.alias);
  const orderItems = parsed.orderBy ? parseOrderBy(parsed.orderBy, parsed.alias) : [];
  const chain = [parsed.collection];

  if (parsed.where) {
    chain.push(`Where(${parsed.alias} => ${qualifySqlExpression(parsed.where, parsed.alias)})`);
  }

  for (let i = 0; i < orderItems.length; i += 1) {
    const item = orderItems[i];
    const method = i === 0 ? (item.descending ? "OrderByDescending" : "OrderBy") : item.descending ? "ThenByDescending" : "ThenBy";
    chain.push(`${method}(${parsed.alias} => ${item.expression})`);
  }

  if (selectProjection !== parsed.alias) {
    chain.push(`Select(${parsed.alias} => ${selectProjection})`);
  }

  return `${chain[0]}${chain.length > 1 ? `\n  .${chain.slice(1).join("\n  .")}` : ""};`;
}

function buildQuerySyntax(parsed) {
  const selectProjection = buildSelectProjection(parsed.columns, parsed.alias);
  const orderItems = parsed.orderBy ? parseOrderBy(parsed.orderBy, parsed.alias) : [];
  const lines = [`from ${parsed.alias} in ${parsed.collection}`];

  if (parsed.where) {
    lines.push(`where ${qualifySqlExpression(parsed.where, parsed.alias)}`);
  }

  if (orderItems.length) {
    const orderText = orderItems
      .map((item) => `${item.expression}${item.descending ? " descending" : ""}`)
      .join(", ");
    lines.push(`orderby ${orderText}`);
  }

  lines.push(`select ${selectProjection}`);
  return lines.join("\n");
}

function buildEfCoreSyntax(parsed) {
  const selectProjection = buildSelectProjection(parsed.columns, parsed.alias);
  const orderItems = parsed.orderBy ? parseOrderBy(parsed.orderBy, parsed.alias) : [];
  const lines = [parsed.collection];

  if (parsed.where) {
    lines.push(`  .Where(${parsed.alias} => ${qualifySqlExpression(parsed.where, parsed.alias)})`);
  }

  for (let i = 0; i < orderItems.length; i += 1) {
    const item = orderItems[i];
    const method = i === 0 ? (item.descending ? "OrderByDescending" : "OrderBy") : item.descending ? "ThenByDescending" : "ThenBy";
    lines.push(`  .${method}(${parsed.alias} => ${item.expression})`);
  }

  if (selectProjection !== parsed.alias) {
    lines.push(`  .Select(${parsed.alias} => ${selectProjection})`);
  }

  return `${lines.join("\n")};`;
}

function convertBasicSql(sql, target) {
  const parsed = parseBasicSelect(sql);
  if (!parsed.ok) return parsed;

  const targetKey = target || "method";
  let output = "";

  if (targetKey === "query") {
    output = buildQuerySyntax(parsed);
  } else if (targetKey === "ef") {
    output = buildEfCoreSyntax(parsed);
  } else {
    output = buildMethodChain(parsed);
  }

  const recognized = ["SELECT", "FROM"];
  if (parsed.where) recognized.push("WHERE");
  if (parsed.orderBy) recognized.push("ORDER BY");

  const notes = [`Recognized ${recognized.join(", ")}.`];
  if (parsed.unsupported.length) {
    notes.push(`Unsupported yet: ${parsed.unsupported.join(", ")}.`);
  }

  return {
    ok: true,
    output,
    status: notes.join(" "),
  };
}

const sqlInput = document.getElementById("sqlInput");
const linqPreview = document.getElementById("linqPreview");
const conversionTarget = document.getElementById("conversionTarget");
const convertStatus = document.getElementById("convertStatus");
const copyConversion = document.getElementById("copyConversion");
const connectivityMode = document.getElementById("connectivityMode");
const connectivityOutputList = document.getElementById("connectivityOutputList");

function getConnectivityOutputs(mode) {
  if (mode === "with") {
    return [
      "LINQ output with recognized clauses and warnings.",
      "Schema-aware validation possibilities (table and column checks).",
      "Execution-plan suggestions and optional sample-row previews.",
      "Higher confidence for type mapping and performance guidance.",
    ];
  }

  return [
    "LINQ output from SQL text only (offline mode).",
    "Recognized clause summary and unsupported clause notes.",
    "No live schema validation or execution-plan retrieval.",
    "Fast local conversion with no database dependency.",
  ];
}

function renderConnectivityOutputs(mode) {
  if (!connectivityOutputList) return;
  const rows = getConnectivityOutputs(mode);
  connectivityOutputList.innerHTML = rows.map((row) => `<li>${escapeHtml(row)}</li>`).join("");
}

function renderBasicConversion() {
  if (!sqlInput || !linqPreview || !conversionTarget || !convertStatus) return;

  const targetMap = {
    "Method syntax": "method",
    "Query syntax": "query",
    "EF Core IQueryable": "ef",
  };
  const result = convertBasicSql(sqlInput.value, targetMap[conversionTarget.value] || "method");

  if (!result.ok) {
    linqPreview.textContent = "";
    convertStatus.textContent = result.error;
    renderConnectivityOutputs(connectivityMode?.value || "without");
    return;
  }

  const mode = connectivityMode?.value || "without";
  const modeLabel = mode === "with" ? "With DB connectivity" : "Without DB connectivity";
  linqPreview.textContent = result.output;
  convertStatus.textContent = `${result.status} Mode: ${modeLabel}.`;
  renderConnectivityOutputs(mode);
}

if (sqlInput && conversionTarget && linqPreview && convertStatus) {
  sqlInput.addEventListener("input", renderBasicConversion);
  conversionTarget.addEventListener("change", renderBasicConversion);
  if (connectivityMode) connectivityMode.addEventListener("change", renderBasicConversion);
  renderBasicConversion();
}

if (copyConversion) {
  copyConversion.addEventListener("click", async () => {
    const text = linqPreview?.textContent || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      if (convertStatus) convertStatus.textContent = "LINQ preview copied to clipboard.";
    } catch {
      if (convertStatus) convertStatus.textContent = "Copy failed in this browser context.";
    }
  });
}

let loading = false;
async function loadGithubLive(force = false) {
  if (!cfg) return;
  if (loading) return;
  if (state.repo && !force) {
    renderMetrics();
    renderCommitTable();
    renderHeatmap();
    return;
  }

  loading = true;
  setLivePill("Refreshing from GitHub…");
  try {
    const sinceInput = document.getElementById("sinceDate");
    const since = sinceInput?.value || cfg.sinceDate;
    const owner = cfg.githubOwner;
    const repo = cfg.githubRepo;

    const [repoInfo, commits, openIssues, closedIssues] = await Promise.all([
      ghFetch(`/repos/${owner}/${repo}`),
      loadAllCommits(since),
      ghFetch(`/search/issues?q=repo:${owner}/${repo}+type:issue+state:open&per_page=1`),
      ghFetch(`/search/issues?q=repo:${owner}/${repo}+type:issue+state:closed&per_page=1`),
    ]);
    const openPullRequests = await ghFetch(
      `/search/issues?q=repo:${owner}/${repo}+type:pr+state:open&per_page=1`
    );

    state.repo = repoInfo;
    state.commits = commits;
    state.issuesOpen = openIssues.total_count ?? 0;
    state.issuesClosed = closedIssues.total_count ?? 0;
    state.pullRequests = openPullRequests.total_count ?? 0;

    renderMetrics();
    renderCommitTable();
    renderHeatmap();
    setLivePill("Live · GitHub API", "is-live");
  } catch (err) {
    console.error(err);
    setLivePill("GitHub API unavailable (rate limit or network)", "is-error");
    const body = document.querySelector("#commitTable tbody");
    if (body && !state.commits.length) {
      body.innerHTML = `<tr><td colspan="4">${escapeHtml(err.message || String(err))}</td></tr>`;
    }
  } finally {
    loading = false;
  }
}

const sinceInput = document.getElementById("sinceDate");
if (sinceInput) {
  sinceInput.addEventListener("change", async () => {
    state.commits = [];
    await loadGithubLive(true);
  });
}

const refreshBtn = document.getElementById("refreshGithub");
if (refreshBtn) {
  refreshBtn.addEventListener("click", () => loadGithubLive(true));
}

const scrollDock = document.querySelector(".scroll-dock");
const scrollTopBtn = document.getElementById("scrollTopBtn");
const scrollBottomBtn = document.getElementById("scrollBottomBtn");

function updateScrollControls() {
  if (!scrollDock) return;

  const doc = document.documentElement;
  const top = window.scrollY || doc.scrollTop || 0;
  const viewport = window.innerHeight || doc.clientHeight;
  const full = doc.scrollHeight;
  const max = Math.max(0, full - viewport);
  const nearTop = top <= 32;
  const nearBottom = max - top <= 32;
  const shouldShow = max > 180;

  scrollDock.classList.toggle("is-visible", shouldShow);

  if (scrollTopBtn instanceof HTMLButtonElement) {
    scrollTopBtn.disabled = nearTop;
  }
  if (scrollBottomBtn instanceof HTMLButtonElement) {
    scrollBottomBtn.disabled = nearBottom;
  }
}

if (scrollTopBtn instanceof HTMLButtonElement) {
  scrollTopBtn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

if (scrollBottomBtn instanceof HTMLButtonElement) {
  scrollBottomBtn.addEventListener("click", () => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
  });
}

window.addEventListener("scroll", updateScrollControls, { passive: true });
window.addEventListener("resize", updateScrollControls);

applyBranding();
if (document.getElementById("qaTable")) {
  loadQualityDashboard();
}
updateScrollControls();

function syncViewFromHash() {
  const hash = (location.hash || "").replace("#", "");
  if (hash && document.querySelector(`[data-view="${hash}"]`)) {
    showView(hash);
  }
}

window.addEventListener("hashchange", syncViewFromHash);
syncViewFromHash();
