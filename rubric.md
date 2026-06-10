# The casting rubric (expanded reference)

This is the part only you can author, and it's what separates this skill from an RSS reader. The compact, runnable version of this rubric lives in [`prompts/tier0-weekly-scan.md`](prompts/tier0-weekly-scan.md), which is the artifact you actually run each week. This file is the deeper companion: the rationale, the scoring guide, the false-positive patterns, and a worked example. When a pattern keeps showing up in the taste log, it graduates into this file, and the compact rubric in the prompt gets a matching one-line update.

A castable GitHub story usually has the six dimensions below. Score each shortlisted candidate **1 to 5** on each, then make an overall judgment.

## Dimensions

1. **Protagonist**: Is there a clear person or tiny team? A face, not a logo. An individual or a small team, not a faceless org or a pure dependency library.
2. **Visible hook**: Is there something to show on camera? This is broader than flashy UI. It can be a demo, a visual result, a physical build, a process, an environment, a transformation, a human problem solved, or something delightfully weird. The only hard fail is an invisible dependency with nothing to point a camera at.
3. **Why now**: Is there a reason to tell it this week? Just launched, just went viral, shipped after years of work, hit a real milestone. If the hook is timeless rather than timely, that's fine, but label it evergreen so you know it isn't riding a news peg.
4. **Voice**: Evidence they can talk. A real README, a thread, a blog post, a talk. This is your proxy for on-camera presence, since you usually can't audition before you reach out.
5. **Arc**: Stakes, an underdog angle, an obstacle overcome. Story, not a spec sheet.
6. **Reach**: Is there a plausible, non-invasive contact path built from public info? A GitHub profile, a personal site, a public handle. This scores the candidate only. Whether the whole shortlist is varied is a separate, list-level concern (see "Shortlist assembly" below), not something you can score on one person.

## Scoring guide

- **5**: Unmistakable. You'd fight to make this one.
- **4**: Strong. A clear yes with one soft spot.
- **3**: Plausible. Could work with the right angle. Park it if the week is crowded.
- **2**: Weak on this dimension. Needs something else to carry it.
- **1**: Absent.

## Gates and the overall call

- **Shortlist gate:** Protagonist and Visible hook must both be **3 or higher** for a candidate to make the shortlist. If either is below 3, don't shortlist. Park it only if there's a compelling reason to revisit later.
- Apply the gate when you assemble the shortlist, not when you first spot a candidate. A human story often isn't obvious until the second click, so don't discard a promising lead before you've actually looked.
- Past the gate, the overall score is a judgment call, not an average. A 5 on protagonist and hook with a 2 on "why now" is a strong parking-lot maybe, not an automatic shortlist.

## Shortlist assembly (list-level, not per-candidate)

Variety is a property of the set, so handle it when you assemble the list, not in the per-candidate scores.

- Aim for spread across source, project type, geography, and background, so the shortlist doesn't read like six versions of the same person.
- If the list clusters (3 or more from one source, one category, or one region), flag it and either justify the cluster or swap one out.
- Flag monotony rather than forcing artificial diversity. A great week that happens to lean one way is fine if you can see it and say so.

## Common false positives

Most of a casting director's value is catching the thing that looks castable but isn't.

- A corporate launch dressed up as an individual story. There's a "founder," but it's really a funded company with a comms team.
- A VC-backed startup posing as a scrappy indie. The garage aesthetic hides a Series A.
- A repo with lots of stars but no human protagonist. Great project, no face, nothing to film.
- AI-generated slop or a throwaway demo. Stars and screenshots, but no real user, craft, or person behind it.
- A story that's already everywhere this week. If every newsletter has it, you're late, not early.

## Exclusions

- Big-company or corporate launches with no individual at the center.
- Pure libraries, SDKs, or infra with no human story or nothing to show.
- Anyone already widely covered.
- Anyone on the do-not-resurface list in [`rolodex/do-not-resurface.md`](rolodex/do-not-resurface.md).
- Anything matching the current "Hard nos" in the prompt's TUNING section. (When a hard no stabilizes, move it up here so it becomes permanent.)

## Worked example (illustrative, not a real person)

A reference for the depth and plainness to aim for. Don't anchor on the subject matter; anchor on the level of specificity and the absence of hype.

- **Name / handle:** Priya N. (@example-handle)
- **Project (one line):** A browser extension that turns any recipe page into a hands-free, voice-driven cooking mode.
- **The hook (why it films):** You can watch her cook a full meal without touching a screen, the extension reading steps aloud and listening for "next." It demos in 20 seconds.
- **Why now (with date, or "evergreen"):** Shipped v1.0 and hit the Show HN front page on 2026-06-07.
- **Voice (link to their writing/talk):** A detailed Show HN comment thread where she walks through why existing recipe sites are hostile to actual cooking. Clear, funny, opinionated.
- **Arc / stakes:** Built it after burning a dish reading her phone with greasy hands. Quit a job to work on it for a year.
- **Reach (contact path):** GitHub profile links a personal site with an email.
- **Caveat (if any):** Location unverified; confirm before pitching a remote shoot.
- **Score:** 4/5 (P5 / Hook5 / Now4 / Voice4 / Arc4 / Reach3). Strong protagonist and an instantly filmable hook; the only soft spot is reach.
- **Source link(s):** (the Show HN post and the repo)
