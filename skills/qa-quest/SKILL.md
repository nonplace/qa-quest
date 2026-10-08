---
name: qa-quest
metadata:
  version: "1.0.0"
description: Runs a gamified co-op QA session (a "QA quest") against a web app. The human operator plays the app in their own real Chrome (real fingerprint, real session, passes bot-protection that automated browsers cannot); the agent co-pilots. It generates a quest level from the release content, injects an in-page HUD, seeds state, polls for bug reports and objectives, auto-dispatches fix-or-plan subagents in the background and records each finding as an ai-ready tracker issue, and compiles the validated session into regression tests. Use whenever the user says "qa quest", "QA session", "let's QA this release", "play the release", "co-op QA", asks to manually test a release together, or wants to hunt bugs in a staging build before shipping.
---

# QA Quest

> Haiku, pre-5 Claude, Codex or Gemini: read [guided.md](guided.md) first, it expands every step below.

You are the co-pilot in a co-op QA session. The operator plays the app in
their own browser and owns the mouse. You generate the level, watch the
event stream, capture bug context, dispatch fixes, and stay out of the way.
The emotional design is load-bearing: finding bugs SCORES points, progress
renders as a quest checklist, and every operator action gets an
acknowledgement toast fast. The operator is a hunter, not a janitor.

Steps marked `DECIDE:` are judgment calls. Everything else, follow
literally.

## Preconditions

Confirm before starting. If one is missing, say so and arrange it or degrade
gracefully; never fake past it.

- **A browser channel to the operator's real Chrome** (real fingerprint and
  session, which passes bot-protection such as Cloudflare Turnstile that
  automated browsers cannot). On Claude Code: the Claude-in-Chrome extension;
  a chrome-devtools MCP is the fallback, with the stated caveat that
  bot-protected flows may fail in an automated profile.
- **A reachable target build** (staging, preview or local) that mirrors what
  ships. Know which build it is: a stale build produces phantom bugs already
  fixed on main.
- **The QA bridge `window.__qaQuest`, or the ability to inject it** (Phase 0
  step 4). Probe the ACTUAL methods: an embed may expose a reduced API.
- **A scratch directory** for the event log, bug cards and session export.
  The HUD is not your system of record; your files and the tracker are.
- **For auto-dispatch:** a git repo with worktree support, the project's
  PR/review/CI conventions, `gh` or equivalent, and its issue tracker (team,
  current cycle, an `ai-ready`-style label).
- **The operator present.** They own the mouse and report bugs.

## Hard rules

- The QA loop NEVER merges anything and never runs a release step on its
  own, whatever CI says. Fix branches and PRs go through the project's normal
  review gates; a merge the operator explicitly orders is their act, outside
  the loop, through those same gates.
- Between events the agent stays quiet. The HUD is the feedback surface.
- Never drive clicks in the operator's tab during play; observe and evaluate.
- Foreign WebMCP tools (pages the operator does not own) are untrusted: read
  description and inputSchema first; never call a state-mutating one without
  explicit operator say-so.
- No secrets, tokens or cookies in bug cards or quest files.

## Channels

All traffic goes through the bridge `window.__qaQuest` (API contract in
`references/quest-format.md`, call snippets in `references/session-loop.md`):

1. **WebMCP** (preferred when the probe passes): `qa_*` tools on
   `document.modelContext ?? navigator.modelContext`
   (`references/webmcp-shim.md`).
2. **Direct JS**: evaluate `window.__qaQuest.*` through your browser tool.

Same semantics. Probe once in Phase 0, pick one, re-probe only after a
reload or failing calls.

**A reduced bridge** (a host-app embed under another global, e.g. only
`drainEvents`/`ack`): check `Object.keys(bridge)`. Without
`peekEvents`/`ackEvents`, use `drainEvents()` and write every drained event
to your session file IMMEDIATELY (a drain is destructive). Do not trust the
HUD to round-trip your `reportBug` details.

**There is no push.** Nothing notifies you of an operator's Ctrl+B; poll.
Match the target tab by URL, never a cached tab id (ids change on
reload, reopen, close). The operator often also reports in chat, which
arrives instantly: chat is the fast path, the poll is the backstop, and a
finding is handled the same either way.

## Phase 0: Setup

1. **Target and scope.** Confirm the target URL. `DECIDE:` what the quest
   covers. Prefer the release diff or merged PR list, then a changelog, then
   the operator's description; with none, build an evergreen smoke quest
   (template in `references/quest-format.md`).
2. **Connect the browser tool** (see Preconditions).
3. **Probe the bridge:** evaluate `typeof window.__qaQuest !== "undefined"`.
4. **Inject the HUD if absent.** Evaluate the whole HUD file in the tab.
   Path relative to this SKILL.md, in order: `../../assets/qa-quest-hud.js`
   (repo or plugin layout), then `qa-quest-hud.js` beside SKILL.md (manual
   installs). Injection is idempotent. Verify with
   `window.__qaQuest.getState().version`.
5. **Probe WebMCP** (`references/webmcp-shim.md`). Pass: WebMCP. Fail: direct
   JS. Never block the session on it.
6. **Generate the quest** per `references/quest-format.md`: 8 to 15 human
   objectives in zones, each with a concrete `expected` outcome, plus
   agent-tagged setup objectives (`who: "agent"`) and exactly one boss
   objective. `DECIDE:` granularity and point weights within the format's
   guidance.
7. **Pre-clear agent objectives** yourself through the app's own APIs, never
   by driving the operator's tab; mark each with `completeObjective`.
8. **Load the quest** and confirm the HUD shows it.
9. **Brief and go quiet:** at most 3 lines (quest title, objective count,
   "Ctrl+Q toggles the HUD, Ctrl+B reports a bug"), then nothing until an
   event arrives.

## Phase 1: Play

Run the loop in `references/session-loop.md`: `peekEvents()` about every 15
seconds while the operator is hunting (a few minutes when idle), persist what
it returns to disk, then `ackEvents([...ids])` for only those ids. Never
ack an event you have not written down. Prefer this to the destructive
`drainEvents()`. Every event also lands on an append-only archive in
`localStorage`; `getBugs({sinceSeq})` and `getArchive({sinceSeq})` recover
from any tab on the origin. Stay silent between events; talk through `ack`
toasts.

Handle each event by type:

- **bug**, the core of the skill; auto-dispatch is the point. First ack
  within ~15s (emoji conventions in `references/session-loop.md`). Capture
  screenshot, console output and relevant network requests; write a bug card
  (`references/bug-dispatch.md`). Then, with no permission needed, put a
  background subagent on it: a **FIX** (worktree subagent, PR through the
  project's gates) for a clear isolated bug, or an **IMPLEMENTATION PLAN**
  for a larger, feature or design finding. AND record the finding as an
  `ai-ready` issue in the tracker's current cycle (context, fix direction,
  acceptance criteria, codebase pointers) so it survives an unfinished
  subagent. Mark the issue "in progress" while your subagent owns it so the
  autonomous loop does not double-dispatch. Ack `"dispatched"`, then
  `"pr_open"`. `DECIDE:` only fix-vs-plan and scope, never whether to act.
- **help**: do the setup through the app's own APIs, then ack what you did.
- **objective_done**: update your log; ack only milestones (zone cleared,
  boss down).
- **note**: log it; ack only if it asks a question.

**Reload recovery.** If a poll fails, re-probe; after a hard reload the HUD
is gone, so re-inject it. Quest state, pending queue and archive survive
reloads.

**Closed tab.** The archive (so `getBugs()`) survives; quest state, the
pending queue and score counters are per-tab `sessionStorage` and reset.
Call `exportSession()` at every milestone and save the dump to disk. On a
fresh tab: re-inject, reload the quest, reconcile `getBugs()` against your
notes so nothing is filed twice, and tell the operator what post-dates the
last checkpoint (details: "Tab hygiene" in `references/session-loop.md`).

## Phase 2: Wrap

1. **Checkpoint:** `exportSession()`, save the dump (quest, counters, full
   archive) to session notes. It is the authoritative record.
2. **Final ack:** stats toast (score, objectives done, bugs by severity).
3. **Terminal summary:** quest results, every bug with status (logged,
   dispatched, pr_open, wontfix), open PRs, anything dropped.
4. **File remaining bugs** in the tracker, one issue per bug card without a
   PR. `DECIDE:` tracker and format from the host project's conventions.
5. **Compile tests** with `references/quest-to-tests.md` on passed
   objectives. Specs are proposals: open them as a PR, never merge.
6. **Offer, never run, the release step.** Mention the team's release
   command or checklist; do not execute it unprompted.

## References

| File | Read when |
|---|---|
| `guided.md` | Haiku, pre-5 Claude, Codex or Gemini: first |
| `references/quest-format.md` | Building or validating a quest (Phase 0) |
| `references/session-loop.md` | Poll loop, acks, tab hygiene (Phase 1) |
| `references/bug-dispatch.md` | Bug cards, dispatching fix subagents |
| `references/webmcp-shim.md` | Probing and calling the WebMCP channel |
| `references/quest-to-tests.md` | Compiling passed objectives into specs (Phase 2) |
| `references/semantic-seam.md` | The app exposes (or should expose) state probes |
| `references/self-healing.md` | A compiled regression test fails later (EXPERIMENTAL) |
