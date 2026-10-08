# QA Quest, guided walkthrough

For Haiku, pre-5 Claude, Codex and Gemini. `SKILL.md` holds every rule; this file only expands how to carry them out. Nothing here overrides it.

## Contents
- The session in one page
- Phase 0 checklist
- The poll loop, concretely
- Handling a bug event
- Common wrong turns

## The session in one page

1. Confirm target URL, browser channel, tracker, session directory.
2. Inject the HUD, build and load a quest, brief in 3 lines, go quiet.
3. Poll every ~15s. On each event: persist to disk, ack the operator, act.
4. At wrap: export the session, summarise, file leftovers, propose tests.

You never touch the operator's tab. You never merge. You never run the release step.

## Phase 0 checklist

Copy and tick:

```
- [ ] target URL confirmed, and I know which build/branch it is
- [ ] browser tool connected to the operator's real Chrome
- [ ] bridge probed: typeof window.__qaQuest !== "undefined"
- [ ] HUD injected if absent, version read back from getState().version
- [ ] WebMCP probed, channel chosen (WebMCP or direct JS)
- [ ] quest has 8 to 15 human objectives, each with an expected outcome, plus exactly one boss
- [ ] agent objectives done through the app's APIs and marked with completeObjective
- [ ] quest loaded, HUD shows it
- [ ] 3-line briefing sent, then silence
```

HUD path: try `../../assets/qa-quest-hud.js` relative to `SKILL.md`; if that file is missing, try `qa-quest-hud.js` next to `SKILL.md`. Read the whole file and evaluate it in the tab.

## The poll loop, concretely

Each tick, in this order:

1. `JSON.stringify(window.__qaQuest.peekEvents())` (snippets in `references/session-loop.md`).
2. Empty result: print nothing, wait for the next tick.
3. Otherwise append every returned event to your session file. Only after the write succeeds, call `ackEvents` with exactly those ids.
4. Send the operator a short toast with `ack`, then do the heavier work.

If a call errors, the tab probably reloaded: re-probe, re-inject the HUD, continue. Match the tab by URL each time.

A reduced bridge with only `drainEvents`: drain, write to disk in the same step, nothing else in between.

## Handling a bug event

```
- [ ] ack within 15s: "🐛 Got it, on it" (status "logged")
- [ ] capture screenshot, console output, relevant network requests
- [ ] write the bug card (template in references/bug-dispatch.md), no secrets
- [ ] decide: clear isolated bug -> FIX subagent in a worktree; larger or design finding -> PLAN subagent
- [ ] create the ai-ready issue in the current cycle, mark it in progress
- [ ] ack "🛠️ ..." with status "dispatched"; when a PR opens, ack "🔀 ..." with status "pr_open"
```

Keep toasts under about 90 characters, one emoji, specific. Use the same `bugEventId` on every ack for one bug.

Worked example. Operator presses Ctrl+B on the checkout page: "promo code SAVE10 clears the cart". You ack "🐛 P2 logged, checking the promo handler", grab a screenshot and the failing request, write the card, start a worktree subagent with the card as its brief, file the issue, then ack "🛠️ fix agent on promo bug".

## Common wrong turns

- Narrating in the terminal while the operator plays. Print nothing on an empty poll.
- Acking events before they are on disk. Write first, ack second.
- Trusting the HUD as the record. Your files and the tracker are the record.
- Clicking in the operator's tab "just to reproduce". Reproduce through the app's APIs or ask.
- Filing the same bug twice after a tab closed. Diff `getBugs()` against your notes first.
- Merging a fix PR because CI is green or the quest is done. The loop never merges; list the open PRs in the wrap summary and stop.
- Running the release command at wrap. Offer it, do not run it.
