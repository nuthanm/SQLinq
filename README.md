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

## Website prototype

Open `index.html` locally, or:

```bash
npm start
```

| Area | Contents |
|---|---|
| Product | Brand-first landing |
| Get started | Shared IDE flow (per-editor polish later) |
| Live progress | **Live** GitHub stars/forks/issues + commit heatmap + filterable commit grid |
| Engineering | Topics + `IDialectProvider` sketch |
| Extension prototype | Conversion, plan, results, concept hierarchy, extras |

Live progress calls the public GitHub API for `GITHUB_OWNER/GITHUB_REPO`. Unauthenticated requests are rate-limited; use Refresh if the grid pauses.

---

## Architecture (target)

```
IDE Shell (VS / VS Code) → Conversion Service → IDialectProvider (MSSQL first)
                                              → Emit (Method / Query / EF)
                                              → Plan Advisor (optional)
```

VS and VS Code UIs can diverge later while sharing the conversion core.

---

## Acknowledgments

Website prototype and extension UX structure were shaped with AI pair-programming assistance (**Composer**).

---

## Disclaimer

Prototype UI and documentation scaffolding. Not affiliated with Microsoft. Confirm trademark clearance before Marketplace publish if the public name changes.
