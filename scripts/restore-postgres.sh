#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

DATABASE_URL="${DATABASE_URL:-}"
BACKUP=""
APPLY=false
DRY_RUN=false
REPLACE=false
CONFIRM_DB=""
EXTRACT_CONFIG=""

usage() {
  cat <<'EOF'
Usage:
  restore-postgres.sh --backup DIRECTORY [--inspect]
  restore-postgres.sh --backup DIRECTORY --dry-run [--replace]
  restore-postgres.sh --backup DIRECTORY --apply --confirm-db NAME [--replace]
                      [--extract-config NEW_DIRECTORY]

The default action only inspects the bundle. Database writes require --apply
and exact database-name confirmation. A non-empty target is refused unless the
separate destructive --replace flag is present.
EOF
}

fail() { echo "restore-postgres: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"; }
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

inspect_backup() {
  local expected actual file archived_path
  [[ -d "$BACKUP" ]] || fail "backup directory does not exist: $BACKUP"
  for file in database.dump config-snapshot.tar.gz manifest.txt checksums.sha256; do
    [[ -f "$BACKUP/$file" ]] || fail "backup is incomplete: missing $file"
  done
  while read -r expected file; do
    file="${file#\*}"; file="${file# }"
    [[ "$file" != */* && -f "$BACKUP/$file" ]] || fail "invalid checksum entry: $file"
    actual="$(sha256 "$BACKUP/$file")"
    [[ "$actual" == "$expected" ]] || fail "checksum mismatch: $file"
  done < "$BACKUP/checksums.sha256"
  need pg_restore
  need tar
  grep -qx 'format=casting-director-postgres-backup-v1' "$BACKUP/manifest.txt" \
    || fail "unsupported backup format"
  pg_restore --list "$BACKUP/database.dump" >/dev/null
  while IFS= read -r archived_path; do
    [[ "$archived_path" != /* && "$archived_path" != ../* && "$archived_path" != *"/../"* ]] \
      || fail "unsafe config archive path: $archived_path"
  done < <(tar -tzf "$BACKUP/config-snapshot.tar.gz")
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup) [[ $# -ge 2 ]] || fail "--backup requires a value"; BACKUP="$2"; shift 2 ;;
    --database-url) [[ $# -ge 2 ]] || fail "--database-url requires a value"; DATABASE_URL="$2"; shift 2 ;;
    --inspect) shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    --apply) APPLY=true; shift ;;
    --replace) REPLACE=true; shift ;;
    --confirm-db) [[ $# -ge 2 ]] || fail "--confirm-db requires a value"; CONFIRM_DB="$2"; shift 2 ;;
    --extract-config) [[ $# -ge 2 ]] || fail "--extract-config requires a value"; EXTRACT_CONFIG="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ -n "$BACKUP" ]] || fail "--backup is required"
[[ ! ("$APPLY" == true && "$DRY_RUN" == true) ]] || fail "--apply and --dry-run are mutually exclusive"
inspect_backup

if [[ "$APPLY" == false && "$DRY_RUN" == false ]]; then
  [[ "$REPLACE" == false && -z "$CONFIRM_DB" && -z "$EXTRACT_CONFIG" ]] \
    || fail "--replace, --confirm-db, and --extract-config require --apply or --dry-run"
  cat "$BACKUP/manifest.txt"
  echo "Backup inspection passed; no data was changed."
  exit 0
fi

if [[ "$DRY_RUN" == true ]]; then
  echo "Backup inspection passed."
  if [[ "$REPLACE" == true ]]; then
    echo "Would restore database.dump with replacement enabled."
  else
    echo "Would restore database.dump into an empty database."
  fi
  [[ -z "$EXTRACT_CONFIG" ]] || echo "Would extract config snapshot to: $EXTRACT_CONFIG"
  exit 0
fi

[[ -n "$DATABASE_URL" ]] || fail "DATABASE_URL or --database-url is required for --apply"
[[ -n "$CONFIRM_DB" ]] || fail "--confirm-db NAME is required for --apply"
need psql
target_db="$(psql "$DATABASE_URL" --no-psqlrc --tuples-only --no-align \
  --command='SELECT current_database();' | tr -d '\r')"
[[ "$target_db" == "$CONFIRM_DB" ]] || fail "confirmation does not match target database"

table_count="$(psql "$DATABASE_URL" --no-psqlrc --tuples-only --no-align --command="
  SELECT count(*) FROM pg_catalog.pg_tables
  WHERE schemaname NOT IN ('pg_catalog', 'information_schema');" | tr -d '\r[:space:]')"
[[ "$table_count" =~ ^[0-9]+$ ]] || fail "could not inspect target database"
if (( table_count > 0 )) && [[ "$REPLACE" != true ]]; then
  fail "target database is non-empty; use --replace only after taking a backup"
fi

restore_args=(--exit-on-error --single-transaction --no-owner --no-acl --dbname="$DATABASE_URL")
if [[ "$REPLACE" == true ]]; then
  restore_args+=(--clean --if-exists)
fi
pg_restore "${restore_args[@]}" "$BACKUP/database.dump"

if [[ -n "$EXTRACT_CONFIG" ]]; then
  [[ ! -e "$EXTRACT_CONFIG" ]] || fail "config destination already exists: $EXTRACT_CONFIG"
  mkdir -p "$EXTRACT_CONFIG"
  tar -xzf "$BACKUP/config-snapshot.tar.gz" -C "$EXTRACT_CONFIG"
fi
echo "Database restore completed: $target_db"
