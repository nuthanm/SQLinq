# SQLinq

Official project repository for SQLinq, a free developer tool focused on converting SQL queries into readable, idiomatic LINQ for everyday engineering workflows.

[![Website](https://img.shields.io/badge/website-live-0A7B83?style=for-the-badge)](https://sqlinq.vercel.app)
[![Node](https://img.shields.io/badge/node-%3E%3D18-1f6f43?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![VS Code](https://img.shields.io/badge/VS_Code-Extension-0065A9?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com/)
[![Phase](https://img.shields.io/badge/phase-1-8A3FFC?style=for-the-badge)](https://github.com/nuthanm/SQLinq)
[![GitHub Stars](https://img.shields.io/github/stars/nuthanm/SQLinq?style=for-the-badge)](https://github.com/nuthanm/SQLinq/stargazers)
[![GitHub Issues](https://img.shields.io/github/issues/nuthanm/SQLinq?style=for-the-badge)](https://github.com/nuthanm/SQLinq/issues)

## What This Project Is Building

SQLinq is being developed as a practical SQL-to-LINQ platform for both Visual Studio and VS Code, with an emphasis on:

- accurate and explainable conversion
- confidence and quality reporting
- transparent handling of unsupported patterns
- phase-based delivery with measurable progress

## Current Scope (Phase 1)

Phase 1 focuses on a stable and verifiable baseline:

- Microsoft SQL Server-first parsing and conversion
- offline conversion workflow (no DB required)
- pass, partial, and failure visibility
- issue-linked failure tracking for upcoming releases
- trust dashboard backed by benchmark result files

## Product Direction

SQLinq is being built to evolve from a converter into a broader SQL engineering assistant.

Planned direction includes:

- stronger dialect support through provider architecture
- improved LINQ emission styles (method/query/EF usage patterns)
- optional schema-aware validation when DB connectivity is enabled
- execution-plan oriented suggestions and diagnostics

## Architecture (Target)

```text
IDE Shell (VS / VS Code) -> Conversion Service -> IDialectProvider (MSSQL first)
                                               -> Emit (Method / Query / EF)
                                               -> Plan Advisor (optional)
```

## Repository Structure

- `index.html`, `about.html`, `privacy.html`, and related pages: public-facing website
- `server.js`: Express server for site and APIs
- `js/`, `css/`, `assets/`: frontend behavior and styling
- `data/`: quality metrics and reporting artifacts
- `db/schema.sql`: database schema for stored quality/event data
- `scripts/`: quality report generation and import scripts
- `vscode-extension/`: VS Code extension source and packaging

## Quick Start

### Requirements

- Node.js 18+

### Install

```bash
npm install
```

### Run Local Site

```bash
npm start
```

Default server entry point: `server.js`

## Available Commands

```bash
npm start              # sync config and run site/API server
npm run sync-config    # regenerate site config from env values
npm run quality-report # build quality summary from raw query outcomes
npm run import-quality # import generated quality report into database
```

## Connectivity Modes

### Without DB Connectivity

- SQL text to LINQ conversion
- recognized and unsupported clause visibility
- no schema validation or execution-plan retrieval

### With DB Connectivity

- includes all offline capabilities
- schema/type validation opportunities
- richer diagnostics and plan-oriented guidance

## Deployment

This project is configured for Vercel.

```bash
vercel
vercel --prod
```

Environment variable notes:

- `DATABASE_URL` is optional; required only for DB-backed API persistence
- `API_BASE_URL` can be set to your deployed domain (e.g. `https://your-domain.com`) so generated web config and extension runtime endpoint follow domain changes
- quality dashboard can fall back to local report data when DB is unavailable

## Roadmap Snapshot

- [x] baseline converter flow in VS Code extension
- [x] quality reporting pipeline and dashboard integration
- [ ] expand SQL dialect coverage beyond MSSQL
- [ ] deeper explanation output for conversion reasoning
- [ ] enhanced release analytics and benchmark automation

## Contributing

Contributions, bug reports, and feature requests are welcome.

1. Open an issue describing the problem or proposal.
2. Fork the repository and create a feature branch.
3. Submit a pull request with clear context and tests where applicable.

## Disclaimer

SQLinq is an independent project and is not affiliated with Microsoft. Validate naming and trademark requirements before marketplace publication.
