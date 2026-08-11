# Roadmap

Build the three tiers in order. Don't skip ahead. The rubric has to be stable before any pipeline code gets written, and the rolodex is the part that compounds.

## Tier 0: prompt-as-product (now)

Zero infrastructure. One rich prompt that names your sources and your rubric, run by hand. This is where you calibrate taste.

- Run [`prompts/tier0-weekly-scan.md`](prompts/tier0-weekly-scan.md) weekly for a few weeks.
- Each time, update TUNING and append to the TASTE LOG based on what it nailed and what it missed.
- When a pattern keeps showing up in the log, graduate it into [`rubric.md`](rubric.md), then mirror it as a one-line change in the prompt's compact rubric. **Don't write a line of pipeline code until the rubric is stable.**

**How to run it well.** A clean split for the manual phase: let a browsing agent (one that can run scheduled tasks and reach a live browser for sources like X that are hard to hit via API) do the sourcing, then hand candidates to a strong reasoning model for the judgment and brief-writing, where you want consistent taste. Two cautions on credit-metered browsing agents: they can drain credits fast (a single wide research run can be expensive), and you should keep anything sensitive out of third-party tools (see [`sources.md`](sources.md)).

## Tier 1: scheduled pipeline (the sweet spot)

Once the rubric is stable, codify it. The repository now includes this GitHub-native workflow:

- [`tools/weekly_scan.py`](tools/weekly_scan.py) pulls candidates from the public feeds using the query patterns in [`sources.md`](sources.md).
- It dedupes against [`rolodex/do-not-resurface.md`](rolodex/do-not-resurface.md) and the git-tracked [`rolodex/seen.json`](rolodex/seen.json), then assembles the run prompt from the canonical markdown, current TUNING, and recent taste-log lines. Final cuts remain permanent, while parking-lot candidates can return after an eight-week cooldown.
- It sends survivors to a configurable model endpoint for structured briefs and applies Protagonist >= 3 and Visible hook >= 3 as the only mechanical shortlist gates.
- It renders the exact Tier 0 report format and gates the report through [`tools/casting_eval.py`](tools/casting_eval.py).
- [`.github/workflows/weekly-scan.yml`](.github/workflows/weekly-scan.yml) supports manual dispatch and contains a disabled cron. Publishing runs commit successful seen-state changes to `main` and open a GitHub Issue only after the evaluator exits successfully.

The implementation is complete and tested, but the cron is intentionally disabled until the first live screening output is reviewed. Manual dispatch defaults to `dry_run: true`, which uploads the evaluated report without publishing an Issue or advancing memory. The gate to enabling the schedule is one reviewed dry run that passes `casting_eval.py` and reads like casting briefs rather than link slop.

### Live verification gate

Follow the [manual live-verification procedure](tests/README.md#5-live-verification-manual) before enabling the schedule. Dispatch [`.github/workflows/weekly-scan.yml`](.github/workflows/weekly-scan.yml) with `dry_run` left at `true`, download the uploaded `weekly-report.md`, and read the briefs. The repository needs the `CASTING_LLM_API_KEY` Actions secret plus the `CASTING_LLM_API_URL` and `CASTING_LLM_MODEL` variables. A dry run still sources, screens, renders, and evaluates the report, but it does not open an Issue or advance [`rolodex/seen.json`](rolodex/seen.json).

Passing the evaluator is necessary but not sufficient. If the shortlist does not read like people worth a conversation, diagnose prompt assembly first, the screening call second, and the source mix third. The first dispatch is also the first hosted-runner test of the Reddit connector. Check the run log for `blocked from this runner IP`; if it appears, use the OAuth upgrade documented in [`sources.md`](sources.md). Update `sources.md` with the hosted-runner finding either way.

## Tier 2: small app with a real rolodex

### Implementation status

Layers 1 through 4 are implemented. The application now includes a
provider-neutral durable scan job/lease engine, a separately run worker,
authenticated workspace-scoped product APIs, explicit session provisioning,
exact execution snapshots, and functional server-rendered/live Shortlist,
Live scan, Rolodex, Tuning, Taste log, and Scan history surfaces.

The static `web/` app and Python Tier 0/Tier 1 engine remain authoritative and
available. Layer 4 adds conflict-aware repository sync, local/git and GitHub
integration adapters, signed webhook ingestion, durable repository jobs,
deliberate Postgres backup/restore, and vendor-neutral OCI packaging. The scan
worker and tuning preview still call the existing Python prompt builder and
evaluator rather than translating their rules into TypeScript.

### Launch readiness

Repository validation is complete: 144 Python tests and 81 TypeScript tests
pass, along with TypeScript type checking, ESLint, the production Next.js build,
the main-branch CI workflow, and the static Pages release/deploy workflow.
Backup dry-run behavior and restore refusal safety have also been exercised.

The remaining work requires deployment credentials or infrastructure that is
not currently configured:

- Build and smoke-test the OCI `web`, `worker`, and `migrate` roles on a host
  with Docker or Podman.
- Provision staging Postgres, run migrations, create and inspect a real backup,
  restore it into a new empty database, and complete the recovery health checks
  in [`docs/tier2-operations.md`](docs/tier2-operations.md).
- Configure a fine-grained repository token and webhook secret, then exercise
  signed GitHub sync, conflict handling, retries, and idempotency against a
  staging repository.
- Configure `CASTING_LLM_API_KEY`, `CASTING_LLM_API_URL`, and
  `CASTING_LLM_MODEL`, then complete the Tier 1 live editorial dry run before
  enabling either schedule.
- Upgrade Next.js to the first available patched release at or above `16.3.0`.
  The current package-age policy does not yet allow that release, and the
  production dependency audit continues to report upstream high-severity
  advisories against the installed `16.2.1`.

### Build threshold and operating cost

Build Tier 2 only after the team trusts several weeks of Tier 1 reports. Tier 2 replaces a free static and scheduled workflow with an always-on application, Postgres, background work, backups, and a hosting bill. GitHub Pages cannot host the application server or database. Keep Tier 0 and the static Pages app working as the no-infrastructure path even after Tier 2 launches.

The gates, consent-and-care rules, verification rules, and linter release gate carry forward unchanged. Tier 2 may improve operations and memory, but it must not weaken the editorial contract. Every completed scan still passes `tools/casting_eval.py` with its run date before anyone can publish or act on the shortlist.

### Architecture and scan lifecycle

Use a server-rendered web application backed by Postgres and a durable job runner. The HTTP request that starts a scan creates a `pending` scan and returns immediately. A worker moves it through `running` to `completed` or `failed`, records source progress and per-source errors as it goes, persists candidates and briefs transactionally, renders the report markdown, runs the evaluator, and stores every violation. Only a scan with no ERROR-severity violation can become `completed`.

Allow one active scan per workspace. A second trigger while a scan is `pending` or `running` returns the active scan rather than creating competing work. Source failures remain isolated: a blocked feed is recorded on the scan, while reachable feeds continue. A complete source outage, model configuration error, database error, or evaluator error fails the scan with a clear operator-facing message.

### Data model

#### Candidate

Store one durable row per person and project identity, with merge history when two source records resolve to the same person.

| Group | Fields |
|---|---|
| Identity | `id`, `name`, `handle`, `project`, `project_url`, `source`, `source_family`, `source_url`, `fingerprint`, `region` |
| Casting brief | `hook`, `why_now`, `voice`, `arc`, `reach`, `caveat`, `sensitivity`, `rationale` |
| Scores | `protagonist_score`, `visible_hook_score`, `why_now_score`, `voice_score`, `arc_score`, `reach_score`, `overall_score` |
| Editorial controls | `is_evergreen`, `gate_passed`, `not_for_surfacing`, `parked_reason`, `do_not_resurface` |
| Rolodex | `status`, `tags`, `notes` |
| Provenance | `first_scan_id`, `latest_scan_id`, `first_seen_at`, `last_seen_at`, `created_at`, `updated_at` |

`status` is an enum with `new`, `contacted`, `passed`, `cast`, and `maybe-later`. `tags` is a normalized many-to-many relation rather than a comma-separated string. `notes` supports append-only note entries with author and timestamp so team context is not overwritten. `do_not_resurface` excludes the candidate from both the shortlist and parking lot. `not_for_surfacing` records a consent-and-care judgment and is distinct from an ordinary editorial pass.

`gate_passed` is derived from Protagonist >= 3 and Visible hook >= 3 at screening time and stored for auditability. It is never derived from an average. `overall_score` remains the model's editorial judgment. Keep the six dimension scores separately so tuning can be evaluated later without rewriting history.

#### Scan

| Group | Fields |
|---|---|
| Identity and state | `id`, `status`, `triggered_by`, `started_at`, `completed_at`, `created_at`, `updated_at` |
| Coverage | `sources_requested`, `sources_scanned`, `source_errors`, `candidates_fetched`, `candidates_deduped`, `candidates_screened`, `shortlist_count`, `parking_count` |
| Output | `summary`, `report_markdown`, `error` |
| Quality gate | `run_date`, `eval_passed`, `eval_violations` |
| Configuration snapshot | `prompt_hash`, `tuning_snapshot`, `taste_log_snapshot` |

`status` is an enum with `pending`, `running`, `completed`, and `failed`. `sources_requested`, `sources_scanned`, `source_errors`, tuning, taste history, and evaluator violations use structured JSON so the dashboard can render progress and operators can query failures. Each evaluator violation stores code, severity, message, and candidate reference when available.

#### TuningConfig

Store one active workspace configuration with `beat`, `hard_nos`, `more_of`, `created_at`, `updated_at`, and `updated_by`. Keep a revision table or immutable history so every scan can point to the exact tuning it used.

#### TasteLogEntry

Store `id`, `week_of`, `note`, `created_by`, `created_at`, and `updated_at`. Entries are ordered newest first for prompt injection, capped to the same recent-line limit as Tier 1, and export to the exact markdown shape used by `rolodex/taste-log.md`.

### API surface

All write routes require authenticated team access. Responses return structured validation errors and never silently ignore invalid fields.

| Method and route | Contract |
|---|---|
| `POST /api/scans` | Create or return the single active scan. Respond `202` with the scan ID and status. |
| `GET /api/scans/:id` | Poll status, source progress, counts, errors, report markdown, and evaluator violations. |
| `GET /api/scans` | Return paginated scan history with status, date, counts, and summary filters. |
| `GET /api/candidates` | Return paginated candidates with text search and filters for status, tags, source family, region, score, evergreen, gate, do-not-resurface, and not-for-surfacing. |
| `PATCH /api/candidates/:id` | Update status, tags, notes, do-not-resurface, not-for-surfacing, and parked reason with optimistic concurrency. |
| `POST /api/candidates/bulk` | Apply status, tags, or do-not-resurface changes to an explicit set of candidate IDs. |
| `GET /api/tuning` | Return active tuning and revision metadata. |
| `PUT /api/tuning` | Validate and replace active tuning while creating an immutable revision. |
| `GET /api/taste-log` | Return paginated entries newest first. |
| `POST /api/taste-log` | Add one dated taste observation. |
| `PATCH /api/taste-log/:id` | Correct an existing entry while preserving audit metadata. |
| `POST /api/rolodex/sync` | Authenticated, idempotent request that durably queues markdown reconciliation/import/export and returns job IDs. |
| `GET /api/rolodex/sync` | Return recent sync jobs, failures, repository/database revisions, hashes, and open-conflict count. |

### Dashboard

1. **Shortlist** shows the newest completed report as cards with scores, rationale, caveat, sensitivity, source links, and evaluator status. Quick actions set `contacted`, `cast`, `passed`, or `maybe-later`, add a note, and mark do-not-resurface without leaving the page.
2. **Live scan** starts a scan, polls its status, and shows each source as pending, running, completed, or failed. It displays fetched, deduped, screened, shortlisted, and parked counts plus model and evaluator errors. A failed scan keeps its partial diagnostics but never presents its report as shippable.
3. **Rolodex** provides full-text search, filters, sortable score and date columns, saved views, bulk status and tag actions, do-not-resurface controls, and an expandable note history. Candidate detail includes every source appearance and scan.
4. **Tuning** edits beat, hard nos, and more-of fields, previews the canonical generated prompt, shows revision history, and makes clear which revision the next scan will use.
5. **Scan history** lists every run with status, source coverage, counts, summary, errors, evaluator violations, and report markdown. Operators can compare runs but cannot retroactively alter a stored report.

### Two-way markdown sync

The database rolodex and `rolodex/do-not-resurface.md` must remain interoperable so the static Pages app and manual Tier 0 workflow keep working.

- Import parses the existing markdown table with the same normalization helper used by `casting_eval.py`. Rows create or update candidates and set `do_not_resurface`.
- Export writes stable, sorted markdown in the existing table format. It includes every database candidate marked do-not-resurface, plus status, date, and a short public-safe note.
- Database changes enqueue an export that opens a repository change through the configured repository integration. Repository changes trigger an import through a webhook or scheduled poll.
- Sync tracks the last imported repository revision and last exported database revision. If both sides changed the same normalized identity, it records a conflict and requires a human choice rather than overwriting either side.
- Deleting a markdown row does not silently clear do-not-resurface. The importer presents that as an explicit removal conflict because an accidental deletion could resurface a person.
- Taste-log import and export use the same revision and conflict rules. TUNING remains database-owned in Tier 2 but can export a readable snapshot with each scan.

This sync is a compatibility boundary, not a second source of editorial truth. Postgres is authoritative while Tier 2 is running; the markdown export is a durable, reviewable projection that preserves the no-infrastructure path.
