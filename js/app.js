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

function getApiBaseUrl() {
  const fromConfig = String(cfg?.apiBaseUrl || cfg?.siteUrl || "").trim();
  if (fromConfig) return fromConfig.replace(/\/+$/, "");
  if (typeof window !== "undefined" && window.location.protocol !== "file:") {
    return window.location.origin;
  }
  return "";
}

function apiUrl(path) {
  const base = getApiBaseUrl();
  if (!base) return path;
  return `${base}${path}`;
}

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

function parseRecognizedElements(text) {
  const match = String(text || "").match(/Recognized\s+([^\.]+)/i);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);
}

function normalizeElements(input) {
  const list = Array.isArray(input)
    ? input
    : String(input || "")
        .split(",")
        .map((part) => part.trim());
  const cleaned = list
    .map((part) => String(part || "").replace(/^clauses\s*:\s*/i, "").trim().toUpperCase())
    .filter(Boolean);
  return [...new Set(cleaned)];
}

function inferQueryType(elements) {
  const set = new Set(elements || []);
  if (set.has("SELECT ALL")) return "Basic select all columns";
  if (set.has("COLUMN PROJECTION") && set.has("TABLE ALIAS") && !set.has("WHERE") && !set.has("ORDER BY")) {
    return "Basic select with column names using alias";
  }
  if (set.has("COLUMN PROJECTION") && !set.has("WHERE") && !set.has("ORDER BY")) {
    return "Basic select with column names";
  }
  if (set.has("JOIN")) return "Join query";
  if (set.has("GROUP BY")) return "Aggregate query";
  if (set.has("WHERE") && set.has("ORDER BY")) return "Filtered + sorted SELECT";
  if (set.has("WHERE")) return "Filtered SELECT";
  if (set.has("ORDER BY")) return "Sorted SELECT";
  return "Basic SELECT";
}

function conceptLabel(target, connectivityMode) {
  if (target === "query") {
    return connectivityMode === "with"
      ? "LINQ query comprehension + DB connectivity"
      : "LINQ query comprehension (offline)";
  }
  if (target === "ef") {
    return connectivityMode === "with"
      ? "EF Core IQueryable pipeline + DB connectivity"
      : "EF Core IQueryable pipeline (offline)";
  }
  return connectivityMode === "with"
    ? "LINQ method chain + DB connectivity"
    : "LINQ method chain (offline)";
}

function normalizeQualityRows(rows) {
  return rows
    .filter((row) => !Boolean(row.isTest) && !String(row.name || "").toLowerCase().includes("fmanual"))
    .map((row, idx) => ({
    id: row.id || `Q${String(idx + 1).padStart(3, "0")}`,
    name: row.name || `Query ${idx + 1}`,
    area: row.area || "General",
    target: String(row.target || "method").toLowerCase(),
    connectivityMode: String(row.connectivityMode || "without").toLowerCase(),
    databaseType: String(row.databaseType || "without").toLowerCase(),
    queryType: row.queryType || null,
    queryElements: row.queryElements || row.clauseProfile || null,
    concept: row.concept || row.conversionConcept || null,
    createdAt: row.createdAt || null,
    parseStatus: row.parseStatus || "Pass",
    convertStatus: row.convertStatus || "Pass",
    correctness: Number(row.correctness ?? 0),
    exactMatch: Boolean(row.exactMatch),
    timeMs: Number(row.timeMs ?? 0),
    status: row.status || (row.exactMatch ? "Exact" : "Near match"),
    issue: row.issue || null,
  }))
    .map((row) => {
      const elements = normalizeElements(
        row.queryElements || parseRecognizedElements(row.status) || parseRecognizedElements(row.name)
      );
      return {
        ...row,
        queryElements: elements.length ? elements : ["SELECT"],
        queryType: row.queryType || inferQueryType(elements),
        concept: row.concept || conceptLabel(row.target, row.connectivityMode),
      };
    });
}

function isEdgeCaseRow(row) {
  const area = String(row?.area || "").toLowerCase();
  const name = String(row?.name || "").toLowerCase();
  return area.includes("edge") || name.includes("edge case") || name.includes("edge-case");
}

function targetLabel(target) {
  if (target === "query") return "Query syntax";
  if (target === "ef") return "EF Core IQueryable";
  if (target === "method") return "Method syntax";
  return target || "Unknown";
}

function connectivityLabel(mode) {
  return mode === "with" ? "With DB" : "Without DB";
}

function databaseLabel(dbType) {
  const normalized = String(dbType || "").trim().toLowerCase();
  if (!normalized || normalized === "without" || normalized === "none") return "Without database";
  if (normalized === "connected") return "Connected (type not reported)";
  if (normalized === "sqlserver" || normalized === "mssql" || normalized === "sql server") return "SQL SERVER";
  if (normalized === "postgres" || normalized === "postgresql" || normalized === "postgress") return "POSTGRESS";
  return `Reported: ${normalized.toUpperCase()}`;
}

function ensureDefaultDatabaseGroups(groups) {
  const defaults = ["sqlserver", "postgress"];
  const byKey = new Map((groups || []).map((g) => [String(g.key || "").toLowerCase(), g]));

  defaults.forEach((key) => {
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        total: 0,
        exactRate: 0,
        avgCorrectness: 0,
        avgTime: 0,
      });
    }
  });

  const ordered = [];
  defaults.forEach((key) => {
    const item = byKey.get(key);
    if (item) ordered.push(item);
    byKey.delete(key);
  });

  const remaining = [...byKey.values()].sort((a, b) => b.total - a.total);
  return [...ordered, ...remaining];
}

function summarizeGroups(rows, keySelector) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = keySelector(row);
    if (!groups.has(key)) {
      groups.set(key, { key, total: 0, exact: 0, correctness: 0, time: 0 });
    }
    const g = groups.get(key);
    g.total += 1;
    if (row.exactMatch) g.exact += 1;
    g.correctness += row.correctness;
    g.time += row.timeMs;
  });

  return [...groups.values()]
    .map((g) => ({
      key: g.key,
      total: g.total,
      exactRate: g.total ? (g.exact / g.total) * 100 : 0,
      avgCorrectness: g.total ? g.correctness / g.total : 0,
      avgTime: g.total ? g.time / g.total : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

function renderGroupTable(tableId, groups, labelSelector) {
  const body = document.querySelector(`#${tableId} tbody`);
  if (!body) return;

  if (!groups.length) {
    body.innerHTML = '<tr><td colspan="5">No grouped metrics yet.</td></tr>';
    return;
  }

  body.innerHTML = groups.map((g) => `
    <tr>
      <td>${escapeHtml(labelSelector(g.key))}</td>
      <td>${g.total}</td>
      <td>${g.exactRate.toFixed(1)}%</td>
      <td>${g.avgCorrectness.toFixed(1)}%</td>
      <td>${toMs(g.avgTime)}</td>
    </tr>
  `).join("");
}

function renderGroupGraph(containerId, groups, labelSelector) {
  const root = document.getElementById(containerId);
  if (!root) return;

  if (!groups.length) {
    root.innerHTML = '<p class="caption">No grouped metrics yet.</p>';
    return;
  }

  const width = 520;
  const height = 220;
  const margin = { top: 18, right: 16, bottom: 46, left: 34 };
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;
  const maxBars = Math.max(1, groups.length);
  const band = chartW / maxBars;
  const barW = Math.max(18, band * 0.52);

  const bars = groups.map((g, i) => {
    const value = Math.max(0, Math.min(100, g.exactRate));
    const x = margin.left + i * band + (band - barW) / 2;
    const h = (value / 100) * chartH;
    const y = margin.top + chartH - h;
    const cx = margin.left + i * band + band / 2;
    return `
      <rect class="chart-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="4"></rect>
      <text class="chart-value" x="${cx.toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle">${value.toFixed(1)}%</text>
      <text class="chart-label" x="${cx.toFixed(1)}" y="${(height - 22).toFixed(1)}" text-anchor="middle">${escapeHtml(labelSelector(g.key))}</text>
      <text class="chart-label" x="${cx.toFixed(1)}" y="${(height - 8).toFixed(1)}" text-anchor="middle">${g.total} q</text>
    `;
  }).join("");

  const grid = [0, 25, 50, 75, 100].map((t) => {
    const y = margin.top + chartH - (t / 100) * chartH;
    return `
      <line class="chart-grid" x1="${margin.left}" y1="${y.toFixed(1)}" x2="${(width - margin.right).toFixed(1)}" y2="${y.toFixed(1)}"></line>
      <text class="chart-label" x="${(margin.left - 8).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="end">${t}</text>
    `;
  }).join("");

  root.innerHTML = `
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
      ${grid}
      <line class="chart-axis" x1="${margin.left}" y1="${(margin.top + chartH).toFixed(1)}" x2="${(width - margin.right).toFixed(1)}" y2="${(margin.top + chartH).toFixed(1)}"></line>
      <line class="chart-axis" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${(margin.top + chartH).toFixed(1)}"></line>
      ${bars}
    </svg>
  `;
}

function renderTimeTrendChart(rows) {
  const root = document.getElementById("qaTimeTrendGraph");
  if (!root) return;

  const points = rows
    .map((row, idx) => ({
      xLabel: row.createdAt ? new Date(row.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : `#${idx + 1}`,
      y: Number(row.timeMs || 0),
    }))
    .sort((a, b) => a.xLabel.localeCompare(b.xLabel));

  if (!points.length) {
    root.innerHTML = '<p class="caption">No trend data yet.</p>';
    return;
  }

  const width = 980;
  const height = 280;
  const margin = { top: 18, right: 16, bottom: 48, left: 44 };
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;
  const maxY = Math.max(1, ...points.map((p) => p.y));

  const coords = points.map((p, i) => {
    const x = margin.left + (points.length === 1 ? chartW / 2 : (i / (points.length - 1)) * chartW);
    const y = margin.top + chartH - (p.y / maxY) * chartH;
    return { ...p, x, y };
  });

  const path = coords.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const yTicks = [0, maxY * 0.25, maxY * 0.5, maxY * 0.75, maxY].map((v) => Number(v.toFixed(1)));

  const grid = yTicks.map((t) => {
    const y = margin.top + chartH - (t / maxY) * chartH;
    return `
      <line class="chart-grid" x1="${margin.left}" y1="${y.toFixed(1)}" x2="${(width - margin.right).toFixed(1)}" y2="${y.toFixed(1)}"></line>
      <text class="chart-label" x="${(margin.left - 8).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="end">${t}</text>
    `;
  }).join("");

  const dots = coords.map((p) => `
    <circle class="chart-point" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3"></circle>
    <text class="chart-label" x="${p.x.toFixed(1)}" y="${(height - 12).toFixed(1)}" text-anchor="middle">${escapeHtml(p.xLabel)}</text>
  `).join("");

  root.innerHTML = `
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
      ${grid}
      <line class="chart-axis" x1="${margin.left}" y1="${(margin.top + chartH).toFixed(1)}" x2="${(width - margin.right).toFixed(1)}" y2="${(margin.top + chartH).toFixed(1)}"></line>
      <line class="chart-axis" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${(margin.top + chartH).toFixed(1)}"></line>
      <path class="chart-line" d="${path}"></path>
      ${dots}
    </svg>
  `;
}

function renderSegmentedMetrics(rows) {
  const byDb = ensureDefaultDatabaseGroups(summarizeGroups(rows, (row) => row.databaseType));
  const byConnectivity = summarizeGroups(rows, (row) => row.connectivityMode);
  const byTarget = summarizeGroups(rows, (row) => row.target);

  renderGroupTable("qaDbTable", byDb, databaseLabel);
  renderGroupTable("qaConnectivityTable", byConnectivity, connectivityLabel);
  renderGroupTable("qaTargetTable", byTarget, targetLabel);

  renderGroupGraph("qaDbGraph", byDb, databaseLabel);
  renderGroupGraph("qaConnectivityGraph", byConnectivity, connectivityLabel);
  renderGroupGraph("qaTargetGraph", byTarget, targetLabel);
  renderTimeTrendChart(rows);
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
      "qaEdgeTotal",
      "qaEdgeFailures",
      "qaEdgeFixRate",
    ].forEach((id) => set(id, "-"));

    const body = document.querySelector("#qaTable tbody");
    if (body) {
      body.innerHTML = '<tr><td colspan="14">- No benchmark data published yet. Run benchmark pipeline and import report.</td></tr>';
    }
    renderSegmentedMetrics([]);
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
  const edgeRows = rows.filter((row) => isEdgeCaseRow(row));
  const edgeFailures = edgeRows.filter((row) => row.convertStatus === "Fail" || row.status === "Failed");
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
  set("qaEdgeTotal", `${edgeRows.length}/${total}`);
  set("qaEdgeFailures", `${edgeFailures.length}/${edgeRows.length || 0}`);
  set("qaEdgeFixRate", edgeRows.length ? `${(((edgeRows.length - edgeFailures.length) / edgeRows.length) * 100).toFixed(1)}%` : "n/a");

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
          <td>${escapeHtml(row.queryType || "Basic SELECT")}</td>
          <td>${escapeHtml((row.queryElements || ["SELECT"]).join(", "))}</td>
          <td>${escapeHtml(row.concept || conceptLabel(row.target, row.connectivityMode))}</td>
          <td>${escapeHtml(targetLabel(row.target))}</td>
          <td>${escapeHtml(connectivityLabel(row.connectivityMode))}</td>
          <td>${escapeHtml(databaseLabel(row.databaseType))}</td>
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

  renderSegmentedMetrics(rows);

  const caption = document.getElementById("qaCaption");
  if (caption) {
    const suiteVersion = report?.suiteVersion || "local";
    const generatedAt = report?.generatedAt ? new Date(report.generatedAt).toLocaleString() : "n/a";
    const releaseTarget = report?.releaseTarget || "n/a";
    caption.textContent = `Suite ${suiteVersion} for ${releaseTarget} · ${total} queries · exact ${exact}/${total} · avg correctness ${correctnessAvg.toFixed(1)}% · avg convert ${toMs(avgTime)} · updated ${generatedAt}`;
  }
}

function setupMetricsViewToggle() {
  const tabs = document.querySelectorAll("[data-metrics-view]");
  const panels = document.querySelectorAll("[data-metrics-view-panel]");
  if (!tabs.length || !panels.length) return;

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const view = tab.getAttribute("data-metrics-view");
      tabs.forEach((btn) => {
        const active = btn === tab;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-selected", String(active));
      });

      panels.forEach((panel) => {
        const active = panel.getAttribute("data-metrics-view-panel") === view;
        panel.classList.toggle("is-active", active);
        panel.hidden = !active;
      });
    });
  });
}

function setReleaseUpdatesPill(text, mode = "live") {
  const pill = document.getElementById("releaseUpdatesPill");
  if (!pill) return;
  pill.textContent = text;
  pill.classList.remove("is-live", "is-error");
  pill.classList.add(mode === "error" ? "is-error" : "is-live");
}

function setReleaseComparePill(text, mode = "live") {
  const pill = document.getElementById("releaseComparePill");
  if (!pill) return;
  pill.textContent = text;
  pill.classList.remove("is-live", "is-error");
  pill.classList.add(mode === "error" ? "is-error" : "is-live");
}

let currentReleaseCompare = null;

function renderIssueList(id, values) {
  const root = document.getElementById(id);
  if (!root) return;
  const list = Array.isArray(values) ? values : [];
  if (!list.length) {
    root.innerHTML = "<li>None</li>";
    return;
  }
  root.innerHTML = list.map((v) => `<li>${escapeHtml(String(v))}</li>`).join("");
}

function issueSet(values) {
  return new Set((values || []).map((v) => String(v || "").trim()).filter(Boolean));
}

function buildCompareFromRecords(fromRelease, toRelease) {
  if (!fromRelease || !toRelease) return null;

  const fromOpen = issueSet(fromRelease.openIssues);
  const toOpen = issueSet(toRelease.openIssues);
  const fixedIssues = [...fromOpen].filter((issue) => !toOpen.has(issue));
  const newIssues = [...toOpen].filter((issue) => !fromOpen.has(issue));
  const persistentIssues = [...toOpen].filter((issue) => fromOpen.has(issue));

  return {
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
}

function populateReleaseCompareControls(records) {
  const fromSelect = document.getElementById("releaseCompareFrom");
  const toSelect = document.getElementById("releaseCompareTo");
  const runBtn = document.getElementById("releaseCompareRun");
  const saveBtn = document.getElementById("releaseCompareSave");
  if (!(fromSelect instanceof HTMLSelectElement) || !(toSelect instanceof HTMLSelectElement)) return;

  const list = Array.isArray(records) ? records : [];
  fromSelect.innerHTML = "";
  toSelect.innerHTML = "";

  if (!list.length) {
    fromSelect.disabled = true;
    toSelect.disabled = true;
    if (runBtn instanceof HTMLButtonElement) runBtn.disabled = true;
    if (saveBtn instanceof HTMLButtonElement) saveBtn.disabled = true;
    return;
  }

  list.forEach((r, idx) => {
    const tag = String(r.releaseTag || `release-${idx + 1}`);
    const label = `${tag} (${r.generatedAt ? new Date(r.generatedAt).toLocaleDateString() : "n/a"})`;
    const optA = document.createElement("option");
    optA.value = tag;
    optA.textContent = label;
    const optB = document.createElement("option");
    optB.value = tag;
    optB.textContent = label;
    fromSelect.appendChild(optA);
    toSelect.appendChild(optB);
  });

  fromSelect.disabled = false;
  toSelect.disabled = false;
  if (runBtn instanceof HTMLButtonElement) runBtn.disabled = false;
  if (saveBtn instanceof HTMLButtonElement) {
    saveBtn.disabled = false;
    saveBtn.onclick = saveCurrentReleaseCompare;
  }

  toSelect.selectedIndex = 0;
  fromSelect.selectedIndex = list.length > 1 ? 1 : 0;

  const runCompare = () => {
    const fromTag = fromSelect.value;
    const toTag = toSelect.value;
    const fromRelease = list.find((r) => String(r.releaseTag) === fromTag) || null;
    const toRelease = list.find((r) => String(r.releaseTag) === toTag) || null;

    if (!fromRelease || !toRelease) {
      renderReleaseCompare(null);
      setReleaseComparePill("Invalid release selection", "error");
      return;
    }
    if (fromTag === toTag) {
      renderReleaseCompare(null);
      setReleaseComparePill("Choose two different releases", "error");
      return;
    }

    const compare = buildCompareFromRecords(fromRelease, toRelease);
    renderReleaseCompare(compare);
    setReleaseComparePill(`Compared ${fromTag} -> ${toTag}`, "live");
  };

  fromSelect.onchange = runCompare;
  toSelect.onchange = runCompare;
  if (runBtn instanceof HTMLButtonElement) {
    runBtn.onclick = runCompare;
  }
}

function renderReleaseCompare(compare) {
  const body = document.querySelector("#releaseCompareTable tbody");
  if (!body) return;

  if (!compare || !compare.fromRelease || !compare.toRelease || !compare.deltas) {
    currentReleaseCompare = null;
    body.innerHTML = '<tr><td colspan="8">No explicit compare data available yet.</td></tr>';
    renderIssueList("releaseCompareFixedList", []);
    renderIssueList("releaseCompareNewList", []);
    renderIssueList("releaseComparePersistentList", []);
    return;
  }

  currentReleaseCompare = compare;

  const fromTag = compare.fromRelease.releaseTag || "n/a";
  const toTag = compare.toRelease.releaseTag || "n/a";
  const openDelta = Number(compare.deltas.openIssues || 0);
  const failDelta = Number(compare.deltas.failures || 0);
  const edgeDelta = Number(compare.deltas.edgeCaseFailures || 0);
  const openText = openDelta > 0 ? `+${openDelta}` : String(openDelta);
  const failText = failDelta > 0 ? `+${failDelta}` : String(failDelta);
  const edgeText = edgeDelta > 0 ? `+${edgeDelta}` : String(edgeDelta);

  body.innerHTML = `<tr>
    <td>${escapeHtml(fromTag)}</td>
    <td>${escapeHtml(toTag)}</td>
    <td>${openText}</td>
    <td>${failText}</td>
    <td>${edgeText}</td>
    <td>${Number(compare.fixedIssueCount || 0)}</td>
    <td>${Number(compare.newIssueCount || 0)}</td>
    <td>${Number(compare.persistentIssueCount || 0)}</td>
  </tr>`;

  renderIssueList("releaseCompareFixedList", compare.fixedIssues);
  renderIssueList("releaseCompareNewList", compare.newIssues);
  renderIssueList("releaseComparePersistentList", compare.persistentIssues);
}

async function saveCurrentReleaseCompare() {
  if (!currentReleaseCompare) {
    setReleaseComparePill("Run compare before saving", "error");
    return;
  }

  setReleaseComparePill("Saving compare snapshot...");
  try {
    const res = await fetch(apiUrl("/api/release-compare/save"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(currentReleaseCompare),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `save failed (${res.status})`);
    }
    setReleaseComparePill("Compare snapshot saved", "live");
  } catch (err) {
    setReleaseComparePill("Save failed", "error");
    console.warn("Save compare snapshot failed:", err);
  }
}

function renderReleaseUpdates(records) {
  const body = document.querySelector("#releaseUpdatesTable tbody");
  const deltaBody = document.querySelector("#releaseDeltaTable tbody");
  const caption = document.getElementById("releaseUpdatesCaption");
  const pushList = document.getElementById("releasePushList");
  if (!body) return;

  if (!Array.isArray(records) || !records.length) {
    body.innerHTML = '<tr><td colspan="7">No release update records available yet.</td></tr>';
    if (deltaBody) {
      deltaBody.innerHTML = '<tr><td colspan="5">No issue delta history available yet.</td></tr>';
    }
    if (pushList) {
      pushList.innerHTML = "<li>No push details available yet.</li>";
    }
    if (caption) {
      caption.textContent = "Run npm run release-update to generate automatic release summary entries.";
    }
    return;
  }

  body.innerHTML = records
    .slice(0, 8)
    .map((r) => {
      const total = Number(r.totalQueries || 0);
      const exact = Number(r.exactMatches || 0);
      const failures = Number(r.failures || 0);
      const edgeFailures = Number(r.edgeCaseFailures || 0);
      const fixed = Number(r.fixedIssueCount || 0);
      const exactRate = total ? `${((exact / total) * 100).toFixed(1)}%` : "0.0%";
      const generatedAt = r.generatedAt ? new Date(r.generatedAt).toLocaleString() : "n/a";
      return `<tr>
        <td>${escapeHtml(r.releaseTag || "n/a")}</td>
        <td>${escapeHtml(generatedAt)}</td>
        <td>${total}</td>
        <td>${exactRate}</td>
        <td>${failures}</td>
        <td>${edgeFailures}</td>
        <td>${fixed}</td>
      </tr>`;
    })
    .join("");

  if (deltaBody) {
    deltaBody.innerHTML = records
      .slice(0, 10)
      .map((r, idx) => {
        const openSet = new Set((r.openIssues || []).map((v) => String(v || "").trim()).filter(Boolean));
        const prev = records[idx + 1] || null;
        const prevSet = new Set((prev?.openIssues || []).map((v) => String(v || "").trim()).filter(Boolean));
        const newInCycle = [...openSet].filter((issue) => !prevSet.has(issue));
        const fixedInCycle = prev ? [...prevSet].filter((issue) => !openSet.has(issue)) : [];
        const openDelta = prev ? openSet.size - prevSet.size : null;

        return `<tr>
          <td>${escapeHtml(r.releaseTag || "n/a")}</td>
          <td>${openSet.size}</td>
          <td>${newInCycle.length}</td>
          <td>${fixedInCycle.length}</td>
          <td>${openDelta == null ? "-" : (openDelta > 0 ? `+${openDelta}` : String(openDelta))}</td>
        </tr>`;
      })
      .join("");
  }

  if (caption) {
    const latest = records[0];
    caption.textContent = `Latest: ${latest.releaseTag || "n/a"} · total ${latest.totalQueries || 0} · failures ${latest.failures || 0} · edge-case failures ${latest.edgeCaseFailures || 0} · fixed issues ${latest.fixedIssueCount || 0}.`;
  }

  if (pushList) {
    const latest = records[0] || {};
    const lines = Array.isArray(latest.pushedChanges) && latest.pushedChanges.length
      ? latest.pushedChanges
      : ["No generated push details available."];
    pushList.innerHTML = lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  }
}

async function loadReleaseUpdates() {
  if (!document.getElementById("releaseUpdatesTable")) return;
  setReleaseUpdatesPill("Loading release updates...");
  try {
    const res = await fetch("/data/release-updates.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`release updates unavailable (${res.status})`);
    const payload = await res.json();
    const records = Array.isArray(payload?.releases) ? payload.releases : [];
    renderReleaseUpdates(records);
    setReleaseUpdatesPill("Auto-generated release updates", "live");
  } catch (err) {
    renderReleaseUpdates([]);
    setReleaseUpdatesPill("Release updates unavailable", "error");
    console.warn("Release updates load failed:", err);
  }
}

async function loadReleaseCompare() {
  if (!document.getElementById("releaseCompareTable")) return;
  setReleaseComparePill("Loading release comparison...");
  try {
    const [compareRes, updatesRes] = await Promise.all([
      fetch("/data/release-compare.json", { cache: "no-store" }),
      fetch("/data/release-updates.json", { cache: "no-store" }),
    ]);

    let comparePayload = null;
    if (compareRes.ok) comparePayload = await compareRes.json();

    let releases = [];
    if (updatesRes.ok) {
      const updatesPayload = await updatesRes.json();
      releases = Array.isArray(updatesPayload?.releases) ? updatesPayload.releases : [];
      populateReleaseCompareControls(releases);
    }

    if (comparePayload && comparePayload.fromRelease && comparePayload.toRelease) {
      renderReleaseCompare(comparePayload);
      setReleaseComparePill("Explicit release compare", "live");
      return;
    }

    if (releases.length >= 2) {
      const fallbackCompare = buildCompareFromRecords(releases[1], releases[0]);
      renderReleaseCompare(fallbackCompare);
      setReleaseComparePill(`Compared ${releases[1].releaseTag} -> ${releases[0].releaseTag}`, "live");
      return;
    }

    renderReleaseCompare(null);
    setReleaseComparePill("No release history for compare", "error");
  } catch (err) {
    renderReleaseCompare(null);
    setReleaseComparePill("Release compare unavailable", "error");
    console.warn("Release compare load failed:", err);
  }
}

async function loadQualityDashboard() {
  setQualityPill("Loading live conversion data…");
  try {
    const liveRes = await fetch(apiUrl("/api/dashboard/conversion-events"), { cache: "no-store" });
    if (liveRes.ok) {
      const liveReport = await liveRes.json();
      if (Array.isArray(liveReport?.queries) && liveReport.queries.length) {
        renderQualityDashboard(liveReport);
        setQualityPill("Live conversion events", "live");
        return;
      }
    }

    const res = await fetch(apiUrl("/api/dashboard/quality"), { cache: "no-store" });
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
setupMetricsViewToggle();
if (document.getElementById("qaTable")) {
  loadQualityDashboard();
}
if (document.getElementById("releaseUpdatesTable")) {
  loadReleaseUpdates();
}
if (document.getElementById("releaseCompareTable")) {
  loadReleaseCompare();
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
