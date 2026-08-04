#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
DATABASE_URL="${DATABASE_URL:-}"
OUTPUT=""
DRY_RUN=false
INSPECT=""

usage() {
  cat <<'EOF'
Usage:
  backup-postgres.sh [--database-url URL] [--output DIRECTORY] [--dry-run]
  backup-postgres.sh --inspect BACKUP_DIRECTORY

Creates a new, owner-neutral custom-format PostgreSQL dump and a snapshot of
canonical editorial configuration. Existing destinations are never replaced.
DATABASE_URL may be supplied through the environment instead of an argument.
EOF
}

fail() { echo "backup-postgres: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"; }
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

inspect_backup() {
  local directory="$1" expected actual
  [[ -d "$directory" ]] || fail "backup directory does not exist: $directory"
  for file in database.dump config-snapshot.tar.gz manifest.txt checksums.sha256; do
    [[ -f "$directory/$file" ]] || fail "backup is incomplete: missing $file"
  done
  while read -r expected file; do
    file="${file#\*}"; file="${file# }"
    [[ "$file" != */* && -f "$directory/$file" ]] || fail "invalid checksum entry: $file"
    actual="$(sha256 "$directory/$file")"
    [[ "$actual" == "$expected" ]] || fail "checksum mismatch: $file"
  done < "$directory/checksums.sha256"
  need pg_restore
  need tar
  grep -qx 'format=casting-director-postgres-backup-v1' "$directory/manifest.txt" \
    || fail "unsupported backup format"
  pg_restore --list "$directory/database.dump" >/dev/null
  tar -tzf "$directory/config-snapshot.tar.gz"
  echo "Backup inspection passed: $directory"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --database-url) [[ $# -ge 2 ]] || fail "--database-url requires a value"; DATABASE_URL="$2"; shift 2 ;;
    --output) [[ $# -ge 2 ]] || fail "--output requires a value"; OUTPUT="$2"; shift 2 ;;
    --inspect) [[ $# -ge 2 ]] || fail "--inspect requires a value"; INSPECT="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

if [[ -n "$INSPECT" ]]; then
  [[ -z "$OUTPUT" && "$DRY_RUN" == false ]] || fail "--inspect cannot be combined with backup options"
  inspect_backup "$INSPECT"
  exit 0
fi

[[ -n "$DATABASE_URL" ]] || fail "DATABASE_URL or --database-url is required"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
OUTPUT="${OUTPUT:-$PROJECT_ROOT/backups/casting-director-$timestamp}"
[[ ! -e "$OUTPUT" ]] || fail "destination already exists: $OUTPUT"

if [[ "$DRY_RUN" == true ]]; then
  printf 'Would create backup: %s\n' "$OUTPUT"
  printf '%s\n' 'Would run pg_isready, pg_dump --format=custom, and snapshot canonical config.'
  exit 0
fi

need pg_isready; need pg_dump; need psql; need tar
parent="$(dirname -- "$OUTPUT")"
mkdir -p "$parent"
staging="${OUTPUT}.partial.$$"
[[ ! -e "$staging" ]] || fail "staging path already exists: $staging"
mkdir "$staging"
cleanup() { [[ ! -e "$staging" ]] || rm -rf -- "$staging"; }
trap cleanup EXIT

pg_isready --dbname="$DATABASE_URL" --quiet || fail "database is not ready"
pg_dump --dbname="$DATABASE_URL" --format=custom --compress=9 \
  --no-owner --no-acl --file="$staging/database.dump"

config_paths=(prompts rubric.md sources.md rolodex)
for path in "${config_paths[@]}"; do
  [[ -e "$PROJECT_ROOT/$path" ]] || fail "canonical config is missing: $path"
done
tar -C "$PROJECT_ROOT" -czf "$staging/config-snapshot.tar.gz" "${config_paths[@]}"

server_version="$(psql "$DATABASE_URL" --no-psqlrc --tuples-only --no-align \
  --command='SHOW server_version;' | tr -d '\r')"
{
  echo "format=casting-director-postgres-backup-v1"
  echo "created_at=$timestamp"
  echo "database_format=postgresql-custom"
  echo "server_version=$server_version"
  printf 'config_paths=%s\n' "${config_paths[*]}"
  echo "restore_ownership=false"
  echo "restore_acl=false"
} > "$staging/manifest.txt"

{
  printf '%s  %s\n' "$(sha256 "$staging/database.dump")" database.dump
  printf '%s  %s\n' "$(sha256 "$staging/config-snapshot.tar.gz")" config-snapshot.tar.gz
  printf '%s  %s\n' "$(sha256 "$staging/manifest.txt")" manifest.txt
} > "$staging/checksums.sha256"

mv -- "$staging" "$OUTPUT"
trap - EXIT
echo "Backup created: $OUTPUT"
