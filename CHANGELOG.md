# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-09

### Added

- Initial release.
- `assets/qa-quest-hud.js`: self-contained, zero-dependency injectable in-page HUD and bridge (`window.__qaQuest`) with quest checklist, progress bar, severity-scored bug reporting (Ctrl+B), acknowledgement toasts, sessionStorage persistence, and idempotent re-injection.
- WebMCP shim: the bridge registered as `qa_*` tools via `document.modelContext` (Chrome 149+ origin trial), feature-detected with a silent no-op fallback.
- `skills/qa-quest/`: the Claude Code skill driving the three-phase session loop (setup, play, wrap) with seven reference files covering quest format, session loop, bug dispatch, the WebMCP shim, the quest-to-test compiler, the semantic test seam, and experimental self-healing selector triage.
- `tests/`: node:test suite for the HUD bridge, zero dependencies.
- Claude Code plugin packaging (`.claude-plugin/plugin.json` + `marketplace.json`) so the repo installs via `/plugin marketplace add jsways/qa-quest`.
- CI workflow (Node 22: syntax check + node --test), MIT license, contributing guide, and architecture documentation.

[0.1.0]: https://github.com/jsways/qa-quest/releases/tag/v0.1.0
