# Contributing to QA Quest

Thanks for wanting to help. This project is deliberately small and dependency-free; contributions that keep it that way are the easiest to land.

## Dev setup

There is none. Clone the repo; you need Node 22+ and nothing else. No `npm install`, no build step.

```bash
git clone https://github.com/jsways/qa-quest.git
cd qa-quest
```

## Running tests

```bash
node --check assets/qa-quest-hud.js   # syntax check the HUD library
node --test tests/                    # run the test suite (node:test, zero deps)
```

Both must pass; CI runs exactly these two commands.

## Pull request guidelines

- Keep PRs single-purpose. One logical change per PR reviews fast.
- `assets/qa-quest-hud.js` must stay a single self-contained IIFE with zero dependencies and no build step. If your change needs a dependency, open an issue first.
- Behaviour changes to the `window.__qaQuest` bridge contract need a matching update to `docs/architecture.md` and a test.
- Skill changes (`skills/qa-quest/`) should stay procedural and explicit; they are written so mid-tier models can follow them.
- Add or update a test for any bug fix; the test should fail without the fix.
- Update `CHANGELOG.md` under an `Unreleased` heading.

## Commit messages

Conventional commits (`fix:`, `feat:`, `docs:`, `test:`, `chore:`) are appreciated but not enforced.

## Reporting bugs

Open a GitHub issue with the HUD version (`window.__qaQuest.getState().version`), your browser + browser-tool combination, and reproduction steps. Console output helps; please strip anything sensitive first.
