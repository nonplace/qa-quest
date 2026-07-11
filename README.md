# QA Quest

[![CI](https://github.com/nonplace/qa-quest/actions/workflows/ci.yml/badge.svg)](https://github.com/nonplace/qa-quest/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**QA Quest turns pre-release QA into a gamified co-op session between you and your coding agent.** You play your web app in your own real Chrome (real fingerprint, real login session, so bot protection that blocks automated browsers rarely gets in your way). Your agent co-pilots: it generates a quest from your release content, tracks objectives in an in-page HUD, captures full context for every bug in one keystroke, dispatches fix work in the background, and compiles the validated session into regression tests.

Finding bugs scores points. Progress renders as a quest checklist. You are the hunter, not the janitor.

Why it works this way: [docs/architecture.md](docs/architecture.md).

## Your first quest in 5 minutes

You need Claude Code and Chrome. No JSON editing, no config files.

1. **Install the plugin.** In Claude Code, run:

   ```
   /plugin marketplace add nonplace/qa-quest
   /plugin install qa-quest@qa-quest
   ```

   You will see Claude Code confirm the marketplace, then the plugin install.

2. **Connect your browser.** Install the Claude in Chrome extension (search "Claude" on the Chrome Web Store) and sign in. This is what lets the agent see your real browser; it is recommended over an automated browser because your real Chrome carries your real cookies and fingerprint, so logged-in flows keep working and bot protection is far less likely to trip.

3. **Open your app** in a Chrome tab. Use a staging or dev copy you own, never production.

4. **Say the trigger phrase** in Claude Code:

   ```
   qa quest against https://staging.your-app.test
   ```

   The agent reads what changed in your release (the diff, merged PRs, or changelog; if it has none of these, it asks you or builds a smoke quest), does what setup it can through your app's own APIs (test accounts, seed data), and posts a briefing of at most three lines: the quest title, the objective count, and the keyboard shortcuts. Then it goes quiet. From here on, the game happens in your browser tab, not in the terminal.

5. **Look bottom-right in your app's tab.** A small pill reads `🎮 0% · 🐛 0`. Click it (or press **Ctrl+Q**) to expand the HUD: a checklist of objectives grouped into zones, a progress bar, and your score. The next objective is marked with ▶.

6. **Play.** Work through the objectives like a level. Click an objective to check it off once you have verified its expected outcome. Completing objectives earns points; the last one is a boss worth extra.

7. **Found a bug? Press Ctrl+B.** A small form opens: pick a severity chip (P1 blocks a core journey, P2 is wrong but has a workaround, P3 is cosmetic), type one line, hit Enter. You are back to playing in five seconds. Bugs pay bounties bigger than objectives: a P1 is worth 300 points.

8. **Watch for the toast.** Within about 15 seconds a small notification appears above the HUD: the agent confirms the bug is logged and has already captured a screenshot, console output, and network state. If the bug looks fixable and the agent has access to the code, a fix agent starts on a branch in the background while you keep playing; later toasts tell you when a PR is open.

When the level is done, the agent posts final stats, files the remaining bugs in your tracker (or hands you the bug cards if it has no tracker access), and turns the journeys you validated into regression test proposals. Nothing merges without your normal review process.

## Features

- **Gamified co-op loop.** Quest levels generated from your actual release content, severity-based bug bounties, score, progress bar, acknowledgement toasts. The emotional design is load-bearing: QA should feel like a hunt.
- **Injectable zero-dependency HUD.** One self-contained plain-JS file (`assets/qa-quest-hud.js`), injected into the target tab by the agent at session start. No app changes, no build step. Idempotent on reload; draggable and collapsible so it never has to sit on top of the thing you're testing.
- **Bugs survive a closed tab.** Reported bugs are appended to a durable, append-only log in `localStorage` the instant they're captured, separate from the live event queue the agent polls. Even a lost poll, a truncated read, or closing the quest tab entirely can't lose a reported bug; `getBugs()` (or its WebMCP twin `qa_get_bugs`) reads the durable record from any tab on the origin.
- **WebMCP-native, with a shim.** The bridge is exposed both as `window.__qaQuest` (works everywhere a browser tool can evaluate JS) and as WebMCP tools via `document.modelContext` (Chrome 149+ origin trial, feature-detected, silent no-op when absent).
- **Quest-to-regression-test compiler.** Every objective you validated by hand becomes a deterministic test skeleton (Playwright by default). The act steps replay your real interaction; setup and assert may use your app's own APIs.
- **Semantic test seam guidance.** Docs for app teams on exposing read-only state probes as WebMCP tools next to QA Quest's, so compiled tests assert against app semantics instead of brittle selectors.
- **EXPERIMENTAL: self-healing selector triage.** When a compiled test later fails, an agent with a DOM snapshot classifies selector drift vs. behaviour change and proposes a one-line spec fix as a draft PR. Behaviour changes are never auto-"healed".

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
|  |  - session + durable state|  |   WebMCP      |   -> bug card -> fix subagent    |
|  +--------------------------+  |                |      (isolated branch, no merge) |
|                                |   ack toasts   |                                  |
|  Operator owns the mouse.      |<---------------+  Phase 2: stats, file bugs,      |
|  Ctrl+B reports a bug.         |                |  compile quest -> test proposals |
+--------------------------------+                +----------------------------------+
```

The agent never drives clicks in your tab during play. It observes, evaluates, and acknowledges; you own the mouse.

## Manual install (without the plugin)

```bash
git clone https://github.com/nonplace/qa-quest.git
cp -r qa-quest/skills/qa-quest ~/.claude/skills/        # or <your-project>/.claude/skills/
cp qa-quest/assets/qa-quest-hud.js ~/.claude/skills/qa-quest/
```

The second copy matters: the skill injects `qa-quest-hud.js` and looks for it next to its own SKILL.md when the repo's `assets/` directory is not there (the plugin install keeps the repo layout, so it never needs this).

The chrome-devtools MCP server works as the browser tool too, but automated Chromium may fail on bot-protected targets.

## Optional: WebMCP

By default the agent talks to the HUD by evaluating JavaScript in the tab, which works with any browser tool. On Chrome 149+ you can additionally enable WebMCP (an emerging standard that lets a page offer typed tools directly to agents): turn on `chrome://flags/#enable-webmcp-testing` and restart Chrome.

To check whether WebMCP is active, open DevTools on the page after the HUD appears and run this in the console:

```js
(await document.modelContext.getTools()).map(t => t.name)
```

You should see 14 names starting with `qa_`. If this errors instead, nothing is broken; the session just uses the direct channel, with identical behaviour.

## Works with other agents

Only the plugin packaging (`.claude-plugin/`) is Claude Code specific:

- The in-page bridge is driven by plain JavaScript evaluation. Any agent with a browser tool that can evaluate JS in a tab (for example Codex CLI with a browser MCP, or any MCP client wired to chrome-devtools) can run a full session.
- `skills/qa-quest/SKILL.md` is plain markdown describing the whole session protocol. Hand it to any capable agent as instructions.
- Background fix dispatch is optional by design: an agent without subagents (or without code access) files the bug cards instead and the session works the same.

Honest status: tested with Claude Code. Other agents are supported paths, not certified ones; if you run one, an issue reporting what worked (or didn't) is a welcome contribution.

## Security notes

- **Real browser, by design.** The agent's bridge runs in a tab that may hold real logged-in state: use it on dev and staging targets you own.
- **Foreign WebMCP tools are untrusted.** On pages you don't own, the agent reads a tool's description and input schema before calling it, and never calls state-mutating foreign tools without your explicit say-so.
- **No secrets in bug cards.** Bug cards and quest files carry routes, console output, and viewport data; never tokens, cookies, or credentials.
- **Dev/staging tooling only.** Never ship the HUD injected to production users; if you vendor it into your app, keep it behind a dev-only flag.

## Roadmap

- Native WebMCP client support as agent surfaces grow first-class WebMCP clients (dropping the JS-eval polyfill path where possible).
- More test framework targets for the quest compiler (Cypress, WebdriverIO, node:test + CDP).
- Richer scoring: streaks, zone-clear bonuses, session leaderboards for teams.

## License

[MIT](LICENSE)
