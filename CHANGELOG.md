# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

*Origins: QA Quest was extracted on 2026-07-08/09 from a production implementation developed privately. The public history intentionally starts at 0.1.0; earlier iterations lived in a private codebase and are not replayed here.*

## [0.5.0] - 2026-07-11

### Added

- **Closed-tab durability.** The append-only archive and its `seq` counter now live in `localStorage` (`durableStorage`, falls back to the passed-in storage if unavailable) instead of the per-tab `sessionStorage` that quest/pending-events/counters still use. 0.4.0 closed the truncated/lost-drain half of the run-1055 data-loss class; this closes the other half the roadmap flagged as open (1.5): closing the quest tab no longer loses reported bugs, because the durable log now survives it. Verified with a real Chrome smoke test (two tabs, same origin): bugs reported in tab A are readable from a fresh tab B via the shared `localStorage`, while session-scoped state (quest, bugCount) correctly does not cross tabs.
- **`getBugs({sinceSeq?})`** — a non-destructive accessor returning the durable archive filtered to bug reports only. This is now the canonical "what bugs were found" read: unlike `drainEvents()`/`peekEvents()`, it can never lose data to a truncated inline return, because it never removes anything.
- **`clearBugs()`** — explicit reset of the durable archive for starting a fresh run. Deliberately narrow: quest state and score counters (`bugCount`/`bugPoints`) are untouched, so clearing the log never silently changes the HUD's visible score.
- **Draggable HUD.** The pill and the panel's head are now pointer-draggable (mouse and touch), so the fixed bottom-right HUD can be moved off content it would otherwise obstruct, e.g. under a simulated mobile viewport. A short move-threshold distinguishes a drag from a click, so the pill's expand/collapse toggle and the head's own buttons (export, collapse) are unaffected. Position is clamped to the viewport and reclamped on resize.
- Two new WebMCP tools: `qa_get_bugs` ({sinceSeq?}), `qa_clear_bugs`.

### Changed

- `qa_drain_events`'s description now also points to `qa_get_bugs` for the bug-only durable read.

## [0.4.0] - 2026-07-09

### Added

- **Delivery guarantee (at-least-once).** Every event is appended to a new durable, append-only `qaquest:archive` key the instant it is created; nothing ever removes an entry (only a 2000-event cap trims the oldest). `drainEvents()` can still clear the pending queue, but data loss on a truncated/dropped drain or a session that ends without persisting is now impossible while the tab lives. Closes the run-1055 class where 5 of 10 reported bugs were lost to a destructive, truncated drain.
- **Peek/ack cursor.** `peekEvents()` (non-destructive) + `ackEvents(ids)` (remove only confirmed-received ids) give true at-least-once delivery — an event leaves the pending queue only after the agent confirms it.
- **`getArchive({sinceSeq?})`** — read the durable record, optionally paging forward by monotonic `seq`. **`exportSession()`** — a single self-contained dump (quest + counters + full archive) for recovery/handoff.
- **Monotonic `seq`** on every event (`qaquest:seq`) for stable ordering and cursoring.
- **Loss-visible HUD.** A "🛡 Secured N" stat proves `securedBugs === bugCount`; on any divergence it turns red ("⚠ N/M"), so silent data loss becomes loud.
- **Session export button** (⤓) in the HUD — downloads the session JSON (clipboard fallback), a portable artifact for QA pros / devs independent of any agent.
- **Expanded WebMCP surface**: `qa_peek_events`, `qa_ack_events`, `qa_get_archive`, `qa_export_session`, `qa_note`, `qa_request_help` join the existing tools; richer descriptions steering agents to the durable path.
- `docs/ROADMAP.md` — the living improvement backlog toward 1.0.0.

### Changed

- `getState()` now reports `securedEvents`, `securedBugs`, and `lastSeq`.
- `qa_drain_events` description now flags it as destructive and points to the archive / peek-ack path.

## [0.3.0] - 2026-07-09

### Added

- README: "Your first quest in 5 minutes" walkthrough for first-time and non-technical users, with what-you-will-see notes at every step.
- README: DevTools one-liner to verify whether WebMCP is active, and what it means when it is not.
- README: "Works with other agents" section documenting the agent-agnostic surface (plain-JS bridge, markdown skill) and its honest test status.
- Architecture: two new design rationale entries ("Why a skill and not hooks?", "Why is this agent-agnostic?").

### Changed

- Documentation tightened across the repo; redundant restatements removed.
- Code comments in `assets/qa-quest-hud.js` reduced to why-only; behaviour unchanged.

## [0.2.0] - 2026-07-09

### Changed

- Project home moved to [github.com/nonplace/qa-quest](https://github.com/nonplace/qa-quest). All links, badges, and install commands updated accordingly (`/plugin marketplace add nonplace/qa-quest`).

## [0.1.0] - 2026-07-09

### Added

- Initial release.
- `assets/qa-quest-hud.js`: self-contained, zero-dependency injectable in-page HUD and bridge (`window.__qaQuest`) with quest checklist, progress bar, severity-scored bug reporting (Ctrl+B), acknowledgement toasts, sessionStorage persistence, and idempotent re-injection.
- WebMCP shim: the bridge registered as `qa_*` tools via `document.modelContext` (Chrome 149+ origin trial), feature-detected with a silent no-op fallback.
- `skills/qa-quest/`: the Claude Code skill driving the three-phase session loop (setup, play, wrap) with seven reference files covering quest format, session loop, bug dispatch, the WebMCP shim, the quest-to-test compiler, the semantic test seam, and experimental self-healing selector triage.
- `tests/`: node:test suite for the HUD bridge, zero dependencies.
- Claude Code plugin packaging (`.claude-plugin/plugin.json` + `marketplace.json`) so the repo installs via `/plugin marketplace add nonplace/qa-quest`.
- CI workflow (Node 22: syntax check + node --test), MIT license, contributing guide, and architecture documentation.

[0.5.0]: https://github.com/nonplace/qa-quest/releases/tag/v0.5.0
[0.4.0]: https://github.com/nonplace/qa-quest/releases/tag/v0.4.0
[0.3.0]: https://github.com/nonplace/qa-quest/releases/tag/v0.3.0
[0.2.0]: https://github.com/nonplace/qa-quest/releases/tag/v0.2.0
[0.1.0]: https://github.com/nonplace/qa-quest/releases/tag/v0.1.0
