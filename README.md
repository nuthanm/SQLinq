# SQLinq

**Free SQL to LINQ for Visual Studio and VS Code.**

Convert complex T-SQL into idiomatic LINQ inside the IDE — with explainable rewrites, execution-plan suggestions, and a dialect-provider architecture built to grow beyond Microsoft SQL Server.

> Phase 1 focus: **Microsoft SQL Server** · **Visual Studio** · **VS Code** · **forever free**

**Repository:** https://github.com/nuthanm/SQLinq

---

## Rename the product (`.env` only)

Product branding is controlled from `.env`. Change the name there, then sync:

```bash
# edit .env → PRODUCT_NAME=YourName
npm run sync-config
```

That regenerates `js/site-config.js`. Keep product naming out of scattered source files — use `window.__SITE_CONFIG__` / `data-bind` instead.

| Key | Purpose |
|---|---|
| `PRODUCT_NAME` | Display name (default: SQLinq) |
| `PRODUCT_TAGLINE` | Short tagline |
| `PRODUCT_PHASE` | Current phase label |
| `PRODUCT_SINCE_DATE` | Public “since” clock for progress views |
| `GITHUB_OWNER` / `GITHUB_REPO` / `GITHUB_URL` | Live stats + commit grid |
| `CREDITS_TEXT` | Acknowledgments on the site footer |

Copy from `.env.example` if needed.

---

## Web application

Run the app with the Node server:

```bash
npm start
```

This serves the landing page and API from `server.js`.

| Area | Contents |
|---|---|
| Product | Brand-first landing |
| Get started | Shared IDE flow (per-editor polish later) |
| Live progress | **Live** GitHub stars/forks/issues + commit heatmap + filterable commit grid |
| Engineering | Topics + `IDialectProvider` sketch |
| Extension app | Conversion workflow, concepts, results, quality confidence, issue-linked failures |

Live progress calls the public GitHub API for `GITHUB_OWNER/GITHUB_REPO` and quality APIs from this app backend.

---

## Phase 1 (production scope)

Phase 1 intentionally ships a working, trust-focused subset:

- SQL to LINQ conversion without database connectivity
- conversion quality and confidence metrics
- parser/converter pass/partial/failure visibility
- issue-linked failure tracking for upcoming releases

This phase-first approach prevents shipping non-working features and keeps each release verifiable.

---

## Architecture (target)

```
IDE Shell (VS / VS Code) → Conversion Service → IDialectProvider (MSSQL first)
                                              → Emit (Method / Query / EF)
                                              → Plan Advisor (optional)
```

VS and VS Code UIs can diverge later while sharing the conversion core.

---

## Connectivity modes (developer-facing)

Both the web application and VS Code extension UI now expose two modes:

- Without DB connectivity
    - SQL text to LINQ conversion (offline)
    - recognized-clause summary
    - unsupported-clause warnings
    - no schema validation or execution-plan retrieval
- With DB connectivity
    - everything in offline mode
    - schema/type validation opportunities
    - execution-plan guidance and optional sample-row checks

This keeps the baseline workflow free and offline, while making richer validation explicit when teams opt into database connectivity.

---

## Neon/PostgreSQL integration

Database-backed tracking uses `DATABASE_URL` (Neon compatible).

### Schema

- SQL schema: `db/schema.sql`
- Events endpoint for extension sync: `POST /api/events/conversion`

Apply schema in your Neon database (psql or migration workflow), then start app.

### Quality report ingestion

1. Generate report from benchmark rows:

```bash
npm run quality-report
```

2. Import into Neon DB:

```bash
npm run import-quality
```

3. Landing page reads from `/api/dashboard/quality`.

If no data is available, UI shows `-` with meaningful messaging.

---

## Quality tracking pipeline (real UI stats)

The trust dashboard is now driven by benchmark data files instead of hardcoded counts.

### Files

- Raw per-query outcomes: `data/quality-query-results.json`
- Generated report consumed by UI: `data/quality-report.json`
- Generator script: `scripts/generate-quality-report.mjs`

### Update flow

1. Write or export each benchmark query outcome to `data/quality-query-results.json`:
    - parser result (`parserOk`)
    - converter result (`converterOk`)
    - correctness percentage
    - exact match boolean
    - conversion time in ms
    - issue link (if partial/failed)
    - failure reason and release bucket
2. Generate UI report:

```bash
npm run quality-report
```

3. The dashboard in `index.html` reads `data/quality-report.json` and shows:
    - correctness, exact-match rate, confidence
    - success/partial/failure counts
    - parser failures and converter failures
    - slowest/p95 timing
    - per-query parse/convert status with issue links

This gives developers clear trust signals while enforcing that partial and failed queries are tracked into upcoming releases.

---

## Deploy to Vercel

This project is configured for Vercel with `vercel.json` and a serverless Express entry in `server.js`.

### Prerequisites

- Node.js 18+
- A Vercel account

### Deploy with Vercel CLI

```bash
npm install -g vercel
vercel login
vercel
```

For production deployment:

```bash
vercel --prod
```

### Environment variables

Set these in Vercel Project Settings → Environment Variables:

- `DATABASE_URL` (optional, required for DB-backed APIs)
- any values you also keep in `.env` for branding/site config (if needed at build/runtime)

If `DATABASE_URL` is not set:

- `/api/health` stays available
- `/api/dashboard/quality` falls back to `data/quality-report.json`
- `/api/events/conversion` returns accepted=false/stored=false by design

### Post-deploy checks

After deployment, verify:

- `GET /api/health`
- `GET /api/dashboard/quality`
- site loads at `/` and deep links like `/#home`

---

## Acknowledgments

Website and extension UX structure were shaped with AI pair-programming assistance (**Composer**).

---

## Disclaimer

Application UI and documentation scaffolding. Not affiliated with Microsoft. Confirm trademark clearance before Marketplace publish if the public name changes.
