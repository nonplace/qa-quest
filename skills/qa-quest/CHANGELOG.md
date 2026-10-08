# Changelog

## 1.0.0, 2026-10-08
- Changed: SKILL.md cut from 232 to 173 lines for strong models; the bridge-variance, closed-tab and phase prose is condensed, the full closed-tab detail now lives only in references/session-loop.md (Tab hygiene).
- Changed: host-app embed example no longer names a specific private embed.
- Added: guided.md (checklists, the poll loop spelled out, worked bug example, common wrong turns) for weaker models, behind the one pointer line under the H1.
- Added: metadata.version, evals/evals.json (4 cases).
- Kept: all hard rules (never merge, quiet between events, never drive the operator's tab, untrusted foreign WebMCP tools, no secrets in cards), persist-before-ack, no-push polling, offer-never-run release step.
- Changed: the hard rule on merging now says the loop never merges or releases on its own whatever CI says, and that a merge the operator orders is their act through the project gates (the first eval round showed models reading the old wording as liftable).
- Checked against: evals/evals.json, 4 cases; haiku 4/4, sonnet 4/4 (merge case needed one wording fix, round 2 clean). Not shipped to .agents/skills, so no codex run.
