# QA Quest

[![CI](https://github.com/nonplace/qa-quest/actions/workflows/ci.yml/badge.svg)](https://github.com/nonplace/qa-quest/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**QA Quest turns pre-release QA into a gamified co-op session between you and your coding agent.** You play your web app in your own real Chrome (real fingerprint, real session, so bot protection just works). Your agent co-pilots: it generates a quest from your release content, tracks objectives in an in-page HUD, captures full context for every bug in one keystroke, dispatches fix work in the background, and compiles the validated session into deterministic regression tests.

Finding bugs scores points. Progress renders as a quest checklist. You are the hunter, not the janitor.

## What a session feels like

1. You say: *"qa quest against https://staging.acme.test"*.
2. The agent reads your release content (diff, PRs, changelog), generates a quest with 8 to 15 objectives grouped into zones, pre-clears its own setup steps (seed accounts, test data), and injects a small HUD into your browser tab. You get a three-line briefing, then the agent goes quiet.
3. You play. The HUD sits bottom-right: a quest checklist with a progress bar, your score, and a bug counter. The next objective is highlighted. Completing objectives earns points.
4. You spot a bug. **Ctrl+B** opens a report popover: pick a severity chip (P1/P2/P3), type one line, hit Enter. Back to playing. Bug bounties score bigger than objectives: P1 pays 300 points.
5. Within about 15 seconds a toast appears: *"Bug logged, digging in."* The agent has grabbed a screenshot, console output, and network state, and written a full bug card. If the bug is fixable, a fix subagent starts working on a branch in the background while you keep playing. A later toast tells you a PR is open.
6. Level complete: final stats (objectives cleared, bugs found, total score), remaining bugs filed in your tracker, and the validated journeys compiled into regression test proposals for your normal review flow.

The QA loop never merges anything. Fixes go through your project's normal review gates.

## Features

- **Gamified co-op loop.** Quest levels generated from your actual release content, severity-based bug bounties, score, progress bar, acknowledgement toasts. The emotional design is load-bearing: QA should feel like a hunt.
- **Injectable zero-dependency HUD.** One self-contained plain-JS file (`assets/qa-quest-hud.js`), injected into the target tab by the agent at session start. No app changes, no build step, no dependencies. Idempotent on reload; state survives in sessionStorage.
- **WebMCP-native, with a shim.** The bridge is exposed both as `window.__qaQuest` (works everywhere a browser tool can evaluate JS) and as WebMCP tools via `document.modelContext` (Chrome 149+ origin trial, feature-detected, silent no-op when absent). Any WebMCP-aware agent surface can drive a session through the standard API.
- **Quest-to-regression-test compiler.** After the session, every objective you validated by hand becomes a deterministic test skeleton (Playwright by default, framework-adaptable). The act steps replay your real interaction; setup and assert may use your app's own APIs.
- **Semantic test seam guidance.** Docs for app teams on exposing read-only state probes as WebMCP tools next to QA Quest's, so compiled tests assert against app semantics instead of brittle selectors.
- **EXPERIMENTAL: self-healing selector triage.** When a compiled test later fails, an agent with a DOM snapshot classifies selector drift vs. behaviour change and proposes a one-line spec fix as a draft PR. Behaviour changes are never auto-"healed".

## Install

### Option 1: Claude Code plugin

```
/plugin marketplace add nonplace/qa-quest
/plugin install qa-quest@qa-quest
```

### Option 2: Manual

```bash
git clone https://github.com/nonplace/qa-quest.git
cp -r qa-quest/skills/qa-quest ~/.claude/skills/        # or <your-project>/.claude/skills/
```

Note: the skill reads `assets/qa-quest-hud.js` to inject it, so keep the `assets/` directory reachable next to the skill, or vendor `qa-quest-hud.js` into the copied skill directory.

## Requirements

- **Claude Code with a Chrome browser tool.** The Claude in Chrome extension is recommended because it drives your REAL browser: real cookies, real fingerprint, so bot protection and logged-in sessions just work. The chrome-devtools MCP server also works, but automated Chromium may fail on bot-protected targets.
- **Optional: WebMCP.** Enable `chrome://flags/#enable-webmcp-testing` on Chrome 149+ to let the HUD register its tools via `document.modelContext`. Without it, everything runs over direct JS evaluation with identical semantics.

## Quickstart

With the plugin installed and your browser tool connected, just say:

```
qa quest against https://staging.acme.test
```

The agent takes it from there: quest generation, HUD injection, briefing, and the play loop.

## How it works

```
 Operator's real Chrome tab                        Coding agent (Claude Code)
+--------------------------------+                +----------------------------------+
|  Your app (staging / dev)      |                |  skills/qa-quest session driver  |
|                                |   inject at    |                                  |
|  +--------------------------+  |   session      |  Phase 0: generate quest,        |
|  | qa-quest-hud.js          |<-+---start--------+  seed state, inject HUD          |
|  |  - HUD (quest, score)    |  |                |                                  |
|  |  - window.__qaQuest      |  |   poll ~15s    |  Phase 1: drainEvents() loop     |
|  |  - WebMCP tools (qa_*)   |<-+---JS eval or---+   bug -> ack -> capture context  |
|  |  - sessionStorage state  |  |   WebMCP       |   -> bug card -> fix subagent    |
|  +--------------------------+  |                |      (isolated branch, no merge) |
|                                |   ack toasts   |                                  |
|  Operator owns the mouse.      |<---------------+  Phase 2: stats, file bugs,      |
|  Ctrl+B reports a bug.         |                |  compile quest -> test proposals |
+--------------------------------+                +----------------------------------+
```

The agent never drives clicks in your tab during play. It observes, evaluates, and acknowledges; you own the mouse.

## Security notes

- **Real browser, by design.** The whole point is that QA runs in the operator's genuine browser session. That also means the agent's bridge runs in a tab that may hold real logged-in state: use it on dev and staging targets you own.
- **Foreign WebMCP tools are untrusted.** On pages you don't own, the agent reads a tool's description and input schema before calling it, and never calls state-mutating foreign tools without your explicit say-so.
- **No secrets in bug cards.** Bug cards and quest files carry routes, console output, and viewport data; never tokens, cookies, or credentials.
- **Dev/staging tooling only.** The HUD is injectable QA tooling. Never ship it injected to production users; if you vendor it into your app, keep it behind a dev-only flag.

## Roadmap

- Native WebMCP client support as agent surfaces grow first-class WebMCP clients (dropping the JS-eval polyfill path where possible).
- More test framework targets for the quest compiler (Cypress, WebdriverIO, node:test + CDP).
- Richer scoring: streaks, zone-clear bonuses, session leaderboards for teams.

## License

[MIT](LICENSE)
