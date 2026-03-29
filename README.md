# af3-matrix

A lightweight internal tool for organizing and analyzing matrix-based protein–protein interaction screens using AlphaFold Server (AF3).

It is designed to replace repetitive manual workflows by enabling batch job generation, structured result parsing, and region-specific interface analysis across many protein pairs.

## Overview

AlphaFold Server is powerful, but screening multiple protein–protein combinations requires:

- manually configuring each job
- tracking submissions across daily quotas
- downloading and organizing results
- inspecting each model individually (often in Chimera or PyMOL)

Streamlining this process into a single workflow, this program:

1. Defines proteins and interaction matrix
2. Generates AF3-compatible JSON jobs in bulk
3. Uploads AF3 result archives
4. Automatically parses predictions from extracted outputs
5. Exposes APIs to list results, fetch pair detail, and run interface / region / composite scoring (up to five models per pair)

## Tech stack

- **Next.js** 15 (Pages Router) + **React** 18
- **Tailwind CSS** 4
- **Backend:** Node API routes under `pages/api/`
- **Persistence (choose one):**
  - **Local (default):** filesystem under `data/af3-matrix/` (or `AF3_DATA_DIR`)
  - **Serverless / Vercel:** **Vercel Blob** (parsed JSON + extracted files + export batches) + **Supabase** (Postgres: session manifests + ingest index)

## Configuration

Copy `.env.example` to `.env.local` for local development.

### Local-only mode (default)

Do **not** set the three cloud variables below. All session data, ingests, and exports are written under:

`{projectRoot}/data/af3-matrix/`

You can override the folder with `AF3_DATA_DIR` (path relative to the project root or absolute). This is ignored when cloud storage is active.

### Cloud mode (Vercel Blob + Supabase)

Set **all** of the following; if any is missing, the app stays in local filesystem mode:

| Variable | Purpose |
|----------|---------|
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob read/write token |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-only; never expose to the client) |

**Supabase schema:** run the SQL in `supabase/migrations/20250328120000_af3_matrix.sql` (Supabase SQL editor or CLI). That creates `af3_session_manifests` and `af3_ingests`. Row Level Security is enabled; the service role bypasses RLS for these server-side APIs.

**Vercel:** add the same env vars to the project and redeploy. Large uploads are still subject to Vercel request/body limits.

## HTTP API (summary)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/pairs/generate` | Validate proteins, build bait x prey pairs, save manifest |
| `POST` | `/api/af3/export` | Load manifest, chunk AF Server jobs, persist batch JSON (disk or Blob) |
| `POST` | `/api/results/upload` | Multipart ZIP → extract → parse → persist envelope + extracted tree |
| `GET` | `/api/results` | `?sessionId=` (optional `ingestId=`) — list ingests and pair summaries |
| `GET` | `/api/results/[pairId]` | `?sessionId=` & optional `ingestId=` — full job + per-model metrics + `pairSummary` |
| `POST` | `/api/analysis/pair` | Structural interface (Cα cutoff), region overlap, composite score (≤5 models) |

Session and ingest identifiers are opaque strings returned by the generate/upload flows; the client must pass `sessionId` (and `ingestId` when disambiguating) to results and analysis routes.

## Key features (current codebase)

### Matrix-based screening

- Define bait × prey combinations from named sequences (see `lib/pairs.js`).
- Optional **regions** per protein (1-based inclusive indices) for overlap metrics.

### AF3 job generation

- Bulk export of AlphaFold Server–compatible JSON (`lib/af3-export.js`).
- Configurable batch size within documented min/max bounds.

### Parsing

- Defensive parsing of AF3-style ZIP trees: ranking CSV, top model, seed/sample folders (`lib/parse-af3.js`).
- Confidence fields surfaced from summary/full JSON where present (e.g. ipTM, pTM, ranking-style scores).

### Interface detection & scoring

- **Cα–Cα distance cutoff** interface residues (`lib/interface-analysis.js`; default cutoff documented in that module).
- **Region overlap** recall / Jaccard-style metrics vs interface residue sets (`lib/region-overlap.js`).
- **Composite ranking** combining confidence, interface footprint, and region overlap; aggregates across up to five models (`lib/scoring.js`).

### UI

- Matrix / heatmap-style interaction grid and modals for generating jobs and uploading results (`components/`).
- Pair detail panel is still largely **placeholder / mock metrics** for layout; it does not yet embed a live structure viewer (e.g. Mol*) wired to real API data.

## Installation (local development)

```bash
git clone https://github.com/sarthaktexas/af3-matrix.git
cd af3-matrix
npm install
npm run dev
```

Open the app at the URL shown in the terminal (typically `http://localhost:3000`).

## Workflow

1. Upload or define protein sequences (UI and/or `POST /api/pairs/generate`).
2. Select bait and prey sets and optional regions.
3. Generate AF3 job batches (`POST /api/af3/export` or UI).
4. Submit jobs via **AlphaFold Server** (manual step; Google account and quotas apply).
5. Upload AF3 result ZIPs (`POST /api/results/upload` or UI).
6. Query results (`GET /api/results`, `GET /api/results/[pairId]`) and optional structural analysis (`POST /api/analysis/pair`).
7. Use the matrix UI for prioritization (scores in the UI may still be demo data until fully wired to the APIs).

## Project layout (selected)

- `pages/api/` — API routes
- `lib/storage*.js`, `lib/supabase-admin.js` — persistence (local vs Blob + Supabase)
- `lib/parse-af3.js` — AF3 output discovery and parsing
- `lib/pairs.js`, `lib/af3-export.js` — pair generation and batch export
- `lib/interface-analysis.js`, `lib/region-overlap.js`, `lib/scoring.js` — structure and ranking logic
- `lib/results-query.js` — ingest listing and pair summaries for results APIs
- `lib/ingest-to-matrix.js` — map upload summaries into matrix cell keys (`bait:prey`)
- `supabase/migrations/` — SQL for cloud mode
- `components/` — React UI

## Notes

- AlphaFold Server interaction (login, submission, quotas) remains **manual**.
- **Local mode** needs write access to the data directory; **cloud mode** needs valid Blob and Supabase credentials.
- Parsed envelopes can be large (including embedded/truncated JSON indexes); detail APIs avoid returning the heaviest maps where possible.

## License

Licensed for the [Falzone Lab](https://falzonelab.com).

This software is intended for internal/research use.
If you would like to use or adapt this tool, please cite appropriately.

## Citation

If you use af3-matrix in your work, please cite:

Mohanty, S. af3-matrix: Matrix-Based Protein–Protein Interaction Screening and Region-Aware Interface Analysis Using AlphaFold Server; GitHub, 2026. https://github.com/sarthaktexas/af3-matrix
