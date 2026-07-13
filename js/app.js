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

function applyBranding() {
  if (!cfg) return;
  document.title = `${cfg.productName} — ${cfg.productTagline}`;
  const meta = document.getElementById("metaDescription");
  if (meta) meta.setAttribute("content", cfg.siteDescription);

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
  const menuToggle = document.getElementById("menuToggle");
  if (nav) nav.classList.remove("is-open");
  if (menuToggle) menuToggle.setAttribute("aria-expanded", "false");
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (name === "transparency") loadGithubLive();
}

document.querySelectorAll("[data-nav]").forEach((el) => {
  el.addEventListener("click", (e) => {
    e.preventDefault();
    const name = el.dataset.nav;
    if (name) showView(name);
  });
});

const menuToggle = document.getElementById("menuToggle");
const nav = document.querySelector(".nav");
if (menuToggle && nav) {
  menuToggle.addEventListener("click", () => {
    const open = nav.classList.toggle("is-open");
    menuToggle.setAttribute("aria-expanded", String(open));
  });
}

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

applyBranding();

const hash = (location.hash || "").replace("#", "");
if (hash && document.querySelector(`[data-view="${hash}"]`)) {
  showView(hash);
}
