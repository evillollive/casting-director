# Install the casting-director skill

This folder (`skill/casting-director/`) is a self-contained agent skill. It
carries everything a run needs — the runtime prompt, the rubric, the sources, a
seed rolodex, and the offline evaluator — so you can drop it into a local agent
or into Copilot and run casting scans anywhere, without the rest of this repo.

It is the portable **Tier 0** of the larger
[casting-director project](https://github.com/evillollive/casting-director). The
scheduled Tier 1 pipeline and the hosted Tier 2 app stay in the repository; this
bundle is the install-anywhere front door to the same taste engine.

## Quick start (TL;DR)

```bash
# 1. Get just this folder (see "Get the bundle" below), then install it:
cp -R skill/casting-director .claude/skills/casting-director   # local agent
# or: cp -R skill/casting-director .github/skills/casting-director   # Copilot

# 2. From your working directory, ask your agent:
#    "Run a casting-director scan."
# On the first run it creates ./casting-rolodex/ from the seeds, works the
# sources with live web access, and hands back a ranked shortlist.

# 3. (optional) Lint any run's output offline, no install required:
python3 .claude/skills/casting-director/scripts/casting_eval.py run.md \
  --dnr ./casting-rolodex/do-not-resurface.md
```

That's the whole thing. No account, no API key, no database, none of the Tier 1
or Tier 2 machinery. The rest of this page is the detail.

## Get the bundle (as a standalone thing)

You don't need to clone the whole project. Any of these gets you just the skill:

- **Download the folder.** Grab `skill/casting-director/` from the
  [repository](https://github.com/evillollive/casting-director) (for example with
  a sparse checkout or a "download directory" tool) and keep it wherever you like.
- **Unpack a shared zip.** If someone handed you `casting-director-skill.zip`
  (see "Package it for sharing" below), just unzip it.
- **Sparse-clone only this path:**

  ```bash
  git clone --depth 1 --filter=blob:none --sparse \
    https://github.com/evillollive/casting-director.git
  cd casting-director && git sparse-checkout set skill/casting-director
  ```

The folder is fully self-contained: it has no imports or path references back
into the parent repository.

## What "installing" means

An agent skill is just a folder with a `SKILL.md` (YAML frontmatter + guidance)
and its bundled resources. Both Claude-style skills and Copilot discover a skill
by placing that folder in a skills directory they scan. So installation is a
copy.

## Install for a local agent (Claude-style `.claude/skills`)

Per-project (recommended — the rolodex stays next to the work):

```bash
mkdir -p .claude/skills
cp -R /path/to/skill/casting-director .claude/skills/casting-director
```

Or for every project on your machine:

```bash
mkdir -p ~/.claude/skills
cp -R /path/to/skill/casting-director ~/.claude/skills/casting-director
```

## Install for Copilot

Copy the same folder into the skills directory your Copilot surface scans
(project-scoped `.github/skills/` or your user skills directory), then reload
skills:

```bash
mkdir -p .github/skills
cp -R /path/to/skill/casting-director .github/skills/casting-director
```

The frontmatter `name` and `description` in [`SKILL.md`](SKILL.md) are what the
agent matches against, so no other wiring is required.

## Package it for sharing

To hand someone a single file, zip the bundle from inside it:

```bash
cd skill/casting-director
zip -r ../casting-director-skill.zip .
```

The recipient unzips it into any of the skills directories above.

## First run

The installed skill is read-only. Your live memory lives in
**`./casting-rolodex/`** in whatever directory you run from — see
[`rolodex/README.md`](rolodex/README.md). On the first run the agent creates that
directory from the bundled seeds; after that it reads and writes your rolodex
there so nobody gets re-surfaced.

To lint a run's output offline (stdlib-only, no install):

```bash
python3 scripts/casting_eval.py <your-run.md> --dnr ./casting-rolodex/do-not-resurface.md
```

## Using it: one run, start to finish

Once installed, a run looks like this (the agent does most of it for you; this is
what it's doing):

1. **Trigger it.** Ask your agent for "a casting-director scan," "this week's
   shortlist," or "who's worth filming." The skill's frontmatter description is
   what makes the agent pick it up.
2. **Memory is seeded.** If `./casting-rolodex/` doesn't exist yet, the agent
   creates it from the bundled seeds, so the do-not-resurface list and taste log
   start clean and live in your working directory (commit them or keep them with
   your notes).
3. **The run assembles.** The agent loads
   [`references/weekly-scan.md`](references/weekly-scan.md), pastes your current
   `./casting-rolodex/do-not-resurface.md` into its DO-NOT-RESURFACE block,
   updates the TUNING block with your beat / hard-nos / more-of, and folds in the
   recent lines from `./casting-rolodex/taste-log.md`.
4. **It works the sources.** With live web access it scans the feeds for roughly
   the last 7 days, scores each candidate against the rubric, applies the gates
   (Protagonist >= 3 and Visible hook >= 3), and drafts briefs.
5. **It self-checks.** It runs `scripts/casting_eval.py` on its own output and
   fixes every ERROR before showing you anything, so you never see a shortlist
   that fails the gates, resurfaces a parked name, or leaks private contact info.
6. **You get a shortlist.** A ranked set of casting briefs plus a small parking
   lot, in the exact Tier 0 format.
7. **Memory compounds.** Afterward the agent appends a taste-log line and adds
   anyone surfaced, contacted, cast, or passed to your do-not-resurface list, so
   next week's run already knows your eye and won't repeat itself.

No web access means no run: the skill will stop and say so rather than invent
candidates. That's deliberate.

## Keeping the bundle current

Everything under `references/`, `rolodex/*.seed.md`, and `scripts/` is a
byte-for-byte mirror of the canonical files in the repository. Don't edit those
copies directly. Edit the canonical file, then run:

```bash
python3 tools/sync_skill_bundle.py
```

`tests/test_skill_bundle_sync.py` (and a CI step) fail if the bundle drifts, so a
forgotten sync is caught automatically. The bundle-only files — `SKILL.md`,
`INSTALL.md`, and `rolodex/README.md` — have no upstream and are edited here.
