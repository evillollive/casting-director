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
