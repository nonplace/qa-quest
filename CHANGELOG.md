# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

*Origins: QA Quest was extracted on 2026-07-08/09 from a production implementation developed privately. The public history intentionally starts at 0.1.0; earlier iterations lived in a private codebase and are not replayed here.*

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

[0.3.0]: https://github.com/nonplace/qa-quest/releases/tag/v0.3.0
[0.2.0]: https://github.com/nonplace/qa-quest/releases/tag/v0.2.0
[0.1.0]: https://github.com/nonplace/qa-quest/releases/tag/v0.1.0
