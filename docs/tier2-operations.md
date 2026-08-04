# Tier 2 operations

## Image and topology

`Dockerfile` builds one OCI image for three roles: `web`, `worker`, and the
one-shot `migrate` job. It uses the committed npm lockfile plus versioned Node
and PostgreSQL-client bases; pin `NODE_IMAGE` and `POSTGRES_IMAGE` to approved
digests in a release pipeline for byte-stable base selection. The image has no
provider-specific runtime.

Next is built in standalone mode inside the build stage. Canonical Python tools
and editorial files (`tools/`, `prompts/`, `rubric.md`, `sources.md`, and
`rolodex/`) are runtime data rather than Next modules, so the image copies them
exactly once beside `server.js`. This intentionally avoids asking NFT to trace
dynamic Python subprocess inputs, removes the whole-project trace warning, and
keeps the canonical files directly callable by both web and worker roles.

Build and start the example topology:

```sh
docker build --pull -t casting-director:local .
export POSTGRES_PASSWORD='use-a-secret-manager-generated-value'
export CASTING_APP_URL='https://casting.example.com'
export CASTING_AUTH_SECRET='at-least-32-random-characters-from-a-secret-manager'
export CASTING_LLM_API_KEY='...'
export CASTING_LLM_API_URL='https://provider.example/v1'
export CASTING_LLM_MODEL='model-name'
export CASTING_REPOSITORY_PROVIDER='github'
export CASTING_GITHUB_REPOSITORY='owner/repository'
export CASTING_GITHUB_TOKEN='fine-grained-contents-token'
export CASTING_SYNC_ACTOR_EMAIL='sync-operator@example.com'
export CASTING_WEBHOOK_SECRET='at-least-32-random-characters'
docker compose -f docker-compose.production.yml up -d
```

Terminate TLS at a reverse proxy and forward only to the loopback-bound web
port. Scale workers independently. Do not scale or restart `migrate`; run it
once per release before new web/worker tasks. `prisma migrate deploy` is
forward-only, so rehearse rollback as application rollback plus database
restore rather than attempting down migrations.

## Health and shutdown

The web healthcheck calls `/api/health`, which validates runtime configuration
and PostgreSQL connectivity and reports worker freshness separately. The worker
healthcheck validates database, LLM configuration, Python, and the canonical
worker import. Route liveness and readiness separately in orchestrators if
needed: process/container state is liveness; the supplied checks are readiness.

The entrypoint uses `exec`, so PID 1 signals reach Node. The worker marks itself
draining and finishes its current leased job on `SIGTERM`; its grace period
must exceed the LLM timeout. Expired leases are recoverable by another worker.
The web process receives 30 seconds to drain requests.

## Repository interoperability

`POST /api/rolodex/sync` is authenticated and idempotently queues durable
reconciliation for `rolodex/do-not-resurface.md` and `rolodex/taste-log.md`.
`GET /api/rolodex/sync` reports job failures, repository/database revisions,
hashes, and open conflicts. Candidate and taste-log writes enqueue durable
exports. A signed GitHub push webhook can enqueue imports at
`POST /api/rolodex/webhook`; deployments without webhooks can schedule the
authenticated sync endpoint instead.

`CASTING_REPOSITORY_PROVIDER=local` reads and atomically writes a configured
checkout. Set `CASTING_REPOSITORY_COMMIT=true` only when that runtime has a
writable Git checkout and an intentionally configured commit identity.
`CASTING_REPOSITORY_PROVIDER=github` uses the standard Contents REST API with
`CASTING_GITHUB_REPOSITORY`, `CASTING_GITHUB_BRANCH`, and a fine-grained token;
it does not require the application itself to run on GitHub.

Configure `CASTING_SYNC_ACTOR_EMAIL` as an active workspace member for worker
imports and use a random `CASTING_WEBHOOK_SECRET` of at least 32 characters.
Give the GitHub token contents read/write access only to the configured
repository. The example read-only container topology should use the GitHub
adapter; a local adapter needs a separate writable repository mount.

Sync state stores the last common per-entry snapshot plus repository and
database hashes. Same-entry changes on both sides become conflicts. Markdown
DNR removal always becomes a conflict, even if Postgres did not change. Resolve
these on `/rolodex`; choosing markdown is the only sync path that can explicitly
clear the DNR bit. Postgres remains authoritative while Tier 2 is running.

## Persistence and security

Only PostgreSQL is durable application state, including execution snapshots.
Web and worker filesystems are read-only and disposable; `/tmp` is bounded
ephemeral space used by Python evaluation. The canonical files in the image are
defaults/versioned inputs, not a writable source of truth. Persist the
`postgres-data` volume and keep backups outside it.

Containers run as UID/GID 10001, drop Linux capabilities, set
`no-new-privileges`, and expose no database port. Run the database on a private
network in a real deployment. Inject secrets with the platform secret manager,
never bake `.env` files into images, restrict backup files to operators, and
use separate least-privilege runtime, migration, and backup database roles
where the platform permits.

There is no production development identity or automatic auth bootstrap.
Provision each session deliberately with `npm run auth:bootstrap`. JSON bodies
and webhook payloads are bounded by `CASTING_MAX_REQUEST_BYTES`; webhook
signatures are checked before parsing. Structured logs redact bearer tokens,
credential URLs, and common secret assignments. Sync conflicts and exhausted
retries are persisted and reported rather than converted into success.

## Backup, inspection, and restore

The backup is a portable, owner/ACL-neutral PostgreSQL custom dump plus a
canonical config snapshot, manifest, and SHA-256 checksums. It intentionally
does not dump cluster roles or secret environment values.

```sh
# Preview only; creates nothing.
DATABASE_URL='postgresql://...' scripts/backup-postgres.sh \
  --output /secure/backups/casting-2026-08-04 --dry-run

# Destination must not already exist.
DATABASE_URL='postgresql://...' scripts/backup-postgres.sh \
  --output /secure/backups/casting-2026-08-04

# Offline integrity/catalog inspection; changes nothing.
scripts/backup-postgres.sh --inspect /secure/backups/casting-2026-08-04
scripts/restore-postgres.sh --backup /secure/backups/casting-2026-08-04
```

Restore first into a new, empty recovery database and run smoke checks. Writes
require both `--apply` and the exact target database name:

```sh
DATABASE_URL='postgresql://.../casting_recovery' \
  scripts/restore-postgres.sh \
  --backup /secure/backups/casting-2026-08-04 \
  --apply --confirm-db casting_recovery \
  --extract-config /secure/recovery-config
```

A non-empty database is refused. `--replace` opts into `pg_restore --clean` and
must only be used after a fresh backup and a tested maintenance window. Config
extraction also refuses an existing destination and is never automatic.

Recovery validation: inspect checksums, restore to an empty database, run
migrations from the restored release image, start one web and one worker,
verify `/api/health`, compare row/snapshot counts and recent completed scans,
exercise a disposable scan, then cut traffic over. Test this procedure and
record recovery time/objective at least quarterly.
