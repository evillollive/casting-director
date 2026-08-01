# The casting rubric (expanded reference)

This is the part only you can author, and it's what separates this skill from an RSS reader. The compact, runnable version of this rubric lives in [`prompts/tier0-weekly-scan.md`](prompts/tier0-weekly-scan.md), which is the artifact you actually run each week. This file is the deeper companion: the rationale, the scoring guide, the false-positive patterns, and a worked example. When a pattern keeps showing up in the taste log, it graduates into this file, and the compact rubric in the prompt gets a matching one-line update.

A castable GitHub story usually has the six dimensions below. Score each shortlisted candidate **1 to 5** on each, then make an overall judgment.

## Dimensions

1. **Protagonist**: Is there a clear person or tiny team? A face, not a logo. An individual or a small team, not a faceless org or a pure dependency library.
2. **Visible hook**: Is there something to show on camera? This is broader than flashy UI. It can be a demo, a visual result, a physical build, a process, an environment, a transformation, a human problem solved, or something delightfully weird. The only hard fail is an invisible dependency with nothing to point a camera at.
3. **Why now**: Is there a reason to tell it this week? A launch is the obvious peg and the least interesting one, and a rubric that only recognises launches will only ever find launch culture. Also count: a first release after years of quiet work, a rewrite that finally landed, a milestone that means something, adoption by a hospital or a city or a school, a sponsor threshold crossed, a maintainer handing a project on or burning out in public, a project surviving an outage or a takedown. If the hook is timeless rather than timely, that's fine, but label it evergreen so you know it isn't riding a news peg. A date months old is a reason, but not a reason this week; a date in the future has not happened yet.
4. **Voice**: Evidence they can talk. A real README, a thread, a blog post, a talk, a devlog, a stream. Video is the strongest evidence and worth actively hunting for, because it is the only thing that shows you the person on camera before you cast them. Score whether they have something to say, not how polished their English is. Written fluency is a language test, not a screen test, and treating it as the proxy quietly filters out everyone building outside English.
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
- If **3 or more entries come from one source, one category, or one region**, name the cluster explicitly (which source, how many) and either justify it or swap one out. "Good spread this week" is not a check, it's a claim; the check is counting.
- Count the feed you found the person on, not the repo they link. Almost every candidate links a code host, so counting repo domains would call any list varied.
- On a quiet week, return fewer entries and say so, and promote the strongest name from the parking lot rather than filling slots. A padded list costs more than a short one.
- Flag monotony rather than forcing artificial diversity. A great week that happens to lean one way is fine if you can see it and say so.

## Consent and care

The output is a list of real people who did not ask to be on it. Surfacing someone is a pitch lead, not their consent to be filmed, and the brief should be something they could read without feeling surveilled.

- **Public information only**, and a contact path that is public and non-invasive: a profile, a personal site, a public handle, a contact form. Never a phone number, a home address, a work or employer email, or a route through a family member.
- **Minors get named as minors.** School projects, teen builders and school-club jam entries are legitimately castable, and they are also a different decision: a shoot needs a guardian. Put it in the Sensitivity line so it is known before outreach, not discovered after.
- **Some people should not be surfaced at all**, however good the story: those who are deliberately pseudonymous, activists or reporters under pressure, security researchers who stay anonymous on purpose, anyone whose employer or immigration status makes exposure risky, and anyone who has publicly asked for no press. Park them with a "not for surfacing" note if the work deserves remembering.
- **Memorial projects** belong to the family, not to a casting list. Flag, don't pitch.
- The do-not-resurface list is an exclusion, not a ranking penalty. Someone on it doesn't belong in the parking lot either.

## Common false positives

Most of a casting director's value is catching the thing that looks castable but isn't.

- A corporate launch dressed up as an individual story. There's a "founder," but it's really a funded company with a comms team.
- A VC-backed startup posing as a scrappy indie. The garage aesthetic hides a Series A.
- A repo with lots of stars but no human protagonist. Great project, no face, nothing to film.
- AI-generated slop or a throwaway demo. Stars and screenshots, but no real user, craft, or person behind it.
- A story that's already everywhere this week. If every newsletter has it, you're late, not early.
- A reheated story. An aggregator resurfaced something that shipped a year ago and the feed made it look new. Check the original date, not the post date.
- A fork or a thin wrapper presented as the work. The demo is impressive because of code someone else wrote. Check the dependency, and consider casting the person who wrote it instead.
- A ghostwritten README. Polished launch copy, no thread, no talk, no trace of the person anywhere else. Voice on the page but not in the world.
- An astroturfed launch. A burst of same-hour upvotes, identical comments, no organic argument. Real Show HN threads argue.
- A "solo founder" who is really an agency, or a team of five with one public face. The protagonist is a marketing decision, not a fact.
- Someone already booked or in production elsewhere. Being first to a story is part of the job.

## Exclusions

- Big-company or corporate launches with no individual at the center.
- Pure libraries, SDKs, or infra with no human story or nothing to show.
- Anyone already widely covered.
- Anyone on the do-not-resurface list in [`rolodex/do-not-resurface.md`](rolodex/do-not-resurface.md), including in the parking lot.
- Anyone covered by "Consent and care" above who should not be surfaced.
- Anything matching the current "Hard nos" in the prompt's TUNING section. (When a hard no stabilizes, move it up here so it becomes permanent.)

## What the linter enforces

[`tools/casting_eval.py`](tools/casting_eval.py) (and its browser port) checks the mechanical half of this file on a real run: the gates, the required fields, a dated or evergreen "why now", recency when you pass a run date, duplicate candidates, do-not-resurface matches in the shortlist and the parking lot, source clustering, and the consent surface (minors, invasive contact paths). It cannot check taste. Everything above that a linter can't reach is the part that is actually yours.

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
- **Sensitivity (if any):** None. Adult, public profile, contact via her own site.
- **Score:** 4/5 (P5 / Hook5 / Now4 / Voice4 / Arc4 / Reach3). Strong protagonist and an instantly filmable hook; the only soft spot is reach.
- **Source link(s):** (the Show HN post and the repo)
