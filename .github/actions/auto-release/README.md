# Auto Release (composite action)

Automatically compute the next [semantic version](https://semver.org/) from
[Conventional Commits](https://www.conventionalcommits.org/) since the last tag,
and (optionally) create the git tag and a GitHub Release. Zero manual version
bumps, just merge `feat:` / `fix:` commits and a release is cut for you.

## Bump rules

Evaluated over every commit since the most recent tag:

| Commit | Bump |
|---|---|
| `feat!:` / `feat(scope)!:`, or a `BREAKING CHANGE:` footer | major |
| `feat:` | minor |
| `fix:` / `perf:` / anything else (chore, docs, refactor, …) | patch |

If there are no new commits since the last tag, the version output is `NONE`
and nothing is created. The first release (no tags yet) is based off `v0.0.0`.

## Inputs

| Input | Default | Description |
|---|---|---|
| `create-release` | `true` | Create the tag + GitHub Release. `false` = only compute the version. |
| `generate-notes` | `true` | Auto-generate release notes from commits/PRs. |
| `github-token` | `${{ github.token }}` | Token used to push the tag and create the release. |

## Outputs

| Output | Description |
|---|---|
| `version` | Computed version (e.g. `v1.4.0`), or `NONE`. |
| `released` | `true` if a tag/release was created, else `false`. |

## Usage in another repo

Add a workflow (the whole thing is one step). The job needs `contents: write`
to push the tag and create the release, and checkout must use `fetch-depth: 0`
so tags/commit history are available.

```yaml
name: Release
on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - id: release
        uses: evillollive/create-call-sheet/.github/actions/auto-release@v1
      # Optional: use the version downstream, e.g. to stamp a build
      - run: echo "Shipped ${{ steps.release.outputs.version }}"
```

Pin to a tag (`@v1`), a branch (`@main`), or a commit SHA.

### Compute-only (no release)

```yaml
      - id: version
        uses: evillollive/create-call-sheet/.github/actions/auto-release@v1
        with:
          create-release: "false"
```

## Notes

- Pushing the tag does **not** re-trigger `on: push: branches`, so there's no
  loop.
- For a Pages deploy that shows the fresh version, run a deploy job **after**
  this one and derive the string with `git describe --tags` (see this repo's
  [`release.yml`](../../workflows/release.yml) for a full example).
