# Rolodex (seed + runtime)

The rolodex is the skill's persistent memory: it stops the tool from re-surfacing
the same names and lets "great but not now" people get parked for later.

## Seeds vs. live memory

The files in this folder are **seeds**, not live memory. The installed skill is
read-only, so your working rolodex lives in your **current working directory**:

```
./casting-rolodex/
  do-not-resurface.md   # anyone already surfaced, contacted, cast, or passed on
  taste-log.md          # one line per run: what you loved, what you cut, and why
```

On the first run, if `./casting-rolodex/` does not exist, create it and copy the
seeds in:

```bash
mkdir -p ./casting-rolodex
cp do-not-resurface.seed.md ./casting-rolodex/do-not-resurface.md
cp taste-log.seed.md        ./casting-rolodex/taste-log.md
```

After that, every run reads and writes the files under `./casting-rolodex/`, and
those files compound over time. Keep them in the user's project (commit them, or
keep them wherever the user keeps their notes) — never write memory back into the
installed skill folder.

## Files

- [`do-not-resurface.seed.md`](do-not-resurface.seed.md): the exclusion list. The
  scan must never bring these people back, in the shortlist or the parking lot.
  Before a run, its live copy is pasted into the DO-NOT-RESURFACE block of
  [`../references/weekly-scan.md`](../references/weekly-scan.md).
- [`taste-log.seed.md`](taste-log.seed.md): one line per run on what you loved and
  what you cut, and why. When a pattern repeats, graduate it into the canonical
  `rubric.md` and the prompt's TUNING/compact rubric.

> This mirrors the canonical `rolodex/` in the
> [casting-director repository](https://github.com/evillollive/casting-director),
> where Tier 1 adds a machine `seen.json` and Tier 2 graduates memory to a real
> database. For the portable skill, the two markdown files above are all you need.
