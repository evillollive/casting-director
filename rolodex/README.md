# Rolodex

Persistent memory for the casting pipeline. This is what stops the tool from re-surfacing the same names and lets "great but not now" people get parked for later.

- [`do-not-resurface.md`](do-not-resurface.md): anyone already surfaced, contacted, cast, or passed on. The scan must never bring these back.
- [`taste-log.md`](taste-log.md): one line per week on what you loved and what you cut, and why. When a pattern repeats here, fold it into [`../rubric.md`](../rubric.md) or the Tier 0 prompt's TUNING section.

In Tier 0 these are markdown files you edit by hand. In Tier 1 the do-not-resurface list becomes the "seen" set the script dedupes against. In Tier 2 it graduates to a real database with per-candidate status, tags, and notes.
