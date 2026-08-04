# Rolodex

Persistent memory for the casting pipeline. This is what stops the tool from re-surfacing the same names and lets "great but not now" people get parked for later.

- [`do-not-resurface.md`](do-not-resurface.md): anyone already surfaced, contacted, cast, or passed on. The scan must never bring these back.
- [`seen.json`](seen.json): Tier 1 machine memory. Shortlisted and hard-excluded candidates are permanent; parking-lot candidates become eligible again after eight weeks. The scheduled workflow commits changes after a successful evaluated run.
- [`taste-log.md`](taste-log.md): one line per week on what you loved and what you cut, and why. When a pattern repeats here, fold it into [`../rubric.md`](../rubric.md) or the Tier 0 prompt's TUNING section.

In Tier 0 the markdown files are edited by hand. In Tier 1 the do-not-resurface list remains the explicit editorial exclusion list while `seen.json` records machine decisions and parking cooldowns. In Tier 2 both graduate to a real database with per-candidate status, tags, and notes.
