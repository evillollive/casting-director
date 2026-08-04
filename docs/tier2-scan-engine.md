# Tier 2 scan engine

Tier 2 layer 2 runs scans outside the Next.js request lifecycle. PostgreSQL is
the handoff boundary: `POST /api/scans` creates one `Scan` and one `ScanJob` in
the same transaction, then returns `202`. A separately run worker claims jobs
with `FOR UPDATE SKIP LOCKED`, owns them through an expiring random lease token,
and heartbeats while the canonical Python engine runs.

## Durable lifecycle

- The partial unique index on `scans.workspaceId` remains the authority for one
  `PENDING` or `RUNNING` scan per workspace.
- A claim increments the bounded attempt count. Retry delays use capped
  exponential backoff.
- An expired lease can be reclaimed only with a new token. Every progress,
  prompt, result, retry, and completion write checks and locks the current
  token, so an old worker cannot write after recovery.
- An expired final attempt becomes an operator-visible `LEASE_EXHAUSTED`
  failure. `Scan.error`, `ScanJob.failureCode`, per-source errors, counts, and
  prompt snapshots remain queryable.
- Dedupe memory and do-not-resurface inputs are snapshotted and hashed when the
  scan is created, so retries cannot change editorial inputs mid-run. Only
  completed, evaluator-passing appearances feed future scan memory.
- `SIGINT` and `SIGTERM` stop new claims and allow the current leased scan to
  finish. If the process or host exits abruptly, another worker reclaims the
  lease after its expiry.

## Canonical Python boundary

`tools/tier2_scan_worker.py` is an NDJSON process protocol around the existing
Tier 1 modules. It emits source, count, and exact prompt events before returning
the final result. It uses the existing source connectors, identity
normalization, dedupe memory, prompt builder, model client, gate properties,
report renderer, and `tools/casting_eval.py --asof RUN_DATE --json`.

The TypeScript worker does not implement rubric logic. It supplies
database-backed do-not-resurface and prior scan memory, then transactionally
stores candidate identity, the immutable screening brief, provenance, report,
and every evaluator violation. A result with any `ERROR` violation is stored as
`FAILED`; the detail API exposes its report only as
`diagnosticReportMarkdown`, never as shippable output.

## Local operation

Configure `.env` with PostgreSQL, application/auth settings, and a
chat-compatible model endpoint:

```bash
npm ci
npm run db:migrate
npm run worker -- --healthcheck
```

Run the web and worker processes separately:

```bash
npm run dev
npm run worker
```

`npm run worker -- --once` claims at most one available job, which is useful
for local operation and process supervisors. The worker needs the repository
checkout because it executes `tools/tier2_scan_worker.py` and the canonical
evaluator. No deployment-vendor SDK or queue service is required.

`GET /api/health` reports database status, fresh ready workers, queued jobs, and
expired leases. Worker logs are one JSON object per line and include the worker,
scan, attempt, failure code, and retry outcome without logging model secrets.

## Authenticated scan API

The session adapter accepts a bearer token or `casting_session` cookie, hashes
the token, verifies an unrevoked session and active user, and requires
membership in `CASTING_WORKSPACE_SLUG`.

Provision the first workspace and expiring session explicitly:

```bash
npm run auth:bootstrap -- --email you@example.com --name "Your name"
```

Enter the returned token at `/sign-in`. The application exchanges it for an
HTTP-only, same-site cookie (also `Secure` in production). There is no fallback
development user, and product writes always authenticate the database session
and workspace membership. `AuthAdapter` remains the replaceable boundary for a
future external identity provider.

```text
POST /api/scans
GET  /api/scans?limit=25&status=FAILED&from=2026-08-01
GET  /api/scans/:id
```

Creation requires `runDate` and unique active `sourceKeys`. History uses cursor
pagination and structured date/status/summary filters. Detail responses include
source progress, counts, retry state, failures, candidates, and evaluator
violations. Exact prompt, tuning, taste-log, and non-secret model snapshots plus
SHA-256 hashes remain attached to the scan audit record.

## Layer 3 product APIs and pages

Authenticated candidate APIs provide cursor pagination, text search and
roadmap filters, optimistic single-candidate edits, append-only authored notes,
normalized workspace tags, status audit rows, and atomic bulk changes for
explicit IDs. Tuning writes create immutable revisions; taste-log corrections
preserve authorship and revision audit data.

The live application includes Shortlist, Live scan, Rolodex, Tuning, Taste log,
and Scan history. The tuning preview runs through
`tools/prompt_builder.py`; the TypeScript application does not contain a second
rubric or evaluator. Failed scans retain source errors, retry state, evaluator
violations, and an optional diagnostic report, but only completed,
evaluator-passing reports appear on Shortlist.

Repository two-way sync, backups, and deployment topology are intentionally
deferred to layer 4. The static `web/` application remains the supported
no-infrastructure path.
