#!/usr/bin/env bash
# Compute the next semantic version tag from Conventional Commits since the
# most recent tag, and print it (e.g. "v1.3.0"). Prints "NONE" when there are
# no new commits since the last tag.
#
# Bump rules (evaluated over every commit since the last tag):
#   major  -> a commit with "!" before the ":" (e.g. "feat!:" / "feat(x)!:")
#             or a "BREAKING CHANGE" line in the body/footer
#   minor  -> any "feat:" commit
#   patch  -> any "fix:"/"perf:" commit, OR any other commit type
#             (chore/docs/refactor/etc.) so every merge still ships a version
#
# Usage:
#   next-version.sh              # use real git history
#   next-version.sh --log FILE   # test mode: NUL-separated commit messages
set -euo pipefail

last_tag="$(git describe --tags --abbrev=0 2>/dev/null || echo "")"
if [ -z "$last_tag" ]; then base="v0.0.0"; range=""; else base="$last_tag"; range="${last_tag}..HEAD"; fi

ver="${base#v}"
major="${ver%%.*}"; rest="${ver#*.}"; minor="${rest%%.*}"; patch="${rest#*.}"
[[ "$major" =~ ^[0-9]+$ ]] || major=0
[[ "$minor" =~ ^[0-9]+$ ]] || minor=0
[[ "$patch" =~ ^[0-9]+$ ]] || patch=0

emit_commits() {
  if [ "${1:-}" = "--log" ]; then cat "$2"; else git log ${range} --format=%B%x00 2>/dev/null || true; fi
}

bump="none"; have=0
while IFS= read -r -d '' commit; do
  stripped="$(printf '%s' "$commit" | tr -d '[:space:]')"
  [ -z "$stripped" ] && continue
  have=1
  subject="$(printf '%s\n' "$commit" | head -n1)"
  if printf '%s' "$commit" | grep -qE 'BREAKING CHANGE' \
     || printf '%s' "$subject" | grep -qE '^[a-zA-Z]+(\([^)]*\))?!:'; then
    bump="major"; break
  elif printf '%s' "$subject" | grep -qE '^feat(\([^)]*\))?:'; then
    [ "$bump" = "none" ] && bump="minor"
  elif printf '%s' "$subject" | grep -qE '^(fix|perf)(\([^)]*\))?:'; then
    [ "$bump" = "none" ] && bump="patch"
  fi
done < <(emit_commits "$@")

if [ "$bump" = "none" ]; then
  if [ "$have" = "1" ]; then bump="patch"; else echo "NONE"; exit 0; fi
fi

case "$bump" in
  major) major=$((major+1)); minor=0; patch=0 ;;
  minor) minor=$((minor+1)); patch=0 ;;
  patch) patch=$((patch+1)) ;;
esac
echo "v${major}.${minor}.${patch}"
