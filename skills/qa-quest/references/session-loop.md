# Session loop

The Phase 1 operating manual: how to poll, how to acknowledge, how to
stay quiet, and how not to lose events.

## Cadence discipline

- Poll roughly every **15 seconds** while the session is live. Faster
  wastes calls; slower breaks the "every action gets an ack within ~15
  seconds" promise.
- **No narration between events.** An empty poll produces zero output
  from you. The operator is in flow; the HUD is the feedback surface.
  Terminal chatter during play is a bug in YOUR behaviour.
- **Use the durable peek/ack path, not destructive drain.** Call
  `peekEvents()` (non-destructive), persist the returned events to your
  session log / scratch file, then `ackEvents([...ids])` to remove ONLY
  the ones you have on disk. An event leaves the pending queue only after
  it is durably yours, so a crash between peek and ack simply re-delivers.
- **Durability is guaranteed regardless.** Every event is also appended
  to an append-only archive that nothing ever removes. If you ever call
  the legacy destructive `drainEvents()` and its inline return is
  truncated or dropped, recover the full record with
  `getArchive({sinceSeq})`. `exportSession()` returns the whole session
  as one artifact — call it at wrap (and any time you want a checkpoint).
  This is the fix for the run-1055 loss (5 of 10 bugs gone to a truncated
  destructive drain); "reported" now means "secured on the archive."
- Handle events in order. Acks first (they are cheap and keep the
  operator moving), heavier work (context capture, subagent dispatch)
  after.

## Call snippets, direct channel (`window.__qaQuest`)

Evaluate these in the target tab through your browser tool's JavaScript
execution. Each returns a JSON string you can parse.

```js
// Probe: is the bridge injected?
typeof window.__qaQuest !== "undefined" ? window.__qaQuest.getState().version : "ABSENT"

// Full state (route, quest, progress, pending event count)
JSON.stringify(window.__qaQuest.getState())

// Load a quest (object or JSON string both accepted)
JSON.stringify(window.__qaQuest.loadQuest({"id":"smoke-2026-07-09","title":"Acme Shop Smoke Run","createdAt":"2026-07-09T09:00:00.000Z","objectives":[{"id":"home-loads","title":"Open the home page","who":"human","points":100,"done":false}]}))

// Poll (PREFERRED, non-destructive): read pending events without clearing
JSON.stringify(window.__qaQuest.peekEvents())

// Ack: remove ONLY the events you have persisted from the pending queue
JSON.stringify(window.__qaQuest.ackEvents(["<id1>", "<id2>"]))

// Recover / audit: the append-only archive (nothing is ever removed)
JSON.stringify(window.__qaQuest.getArchive())            // full record
JSON.stringify(window.__qaQuest.getArchive({ sinceSeq: 7 }))  // page forward

// Checkpoint / wrap: one self-contained dump (quest + counters + archive)
JSON.stringify(window.__qaQuest.exportSession())

// Legacy poll (DESTRUCTIVE): clears the pending queue. Data is still safe in
// the archive, but prefer peek+ack. Persist the result immediately if used.
JSON.stringify(window.__qaQuest.drainEvents())

// Mark an agent objective done (idempotent)
JSON.stringify(window.__qaQuest.completeObjective("seed-account"))

// Ack toast to the operator
window.__qaQuest.ack({ message: "🐛 P2 logged. Digging into the promo handler.", bugEventId: "<event id>", status: "logged" })
```

## Call snippets, WebMCP channel

Same semantics through the `qa_*` tools. Full probe/discover/call
patterns live in `webmcp-shim.md`; the shape is always
find-by-name-then-execute with a fresh handle:

```js
// Poll via WebMCP
(async () => { const mc = document.modelContext ?? navigator.modelContext; const t = (await mc.getTools()).find(x => x.name === "qa_drain_events"); return await mc.executeTool(t, "{}"); })()

// Ack via WebMCP
(async () => { const mc = document.modelContext ?? navigator.modelContext; const t = (await mc.getTools()).find(x => x.name === "qa_ack"); return await mc.executeTool(t, JSON.stringify({ message: "🛠️ Fix agent dispatched on the promo bug.", bugEventId: "<event id>", status: "dispatched" })); })()
```

If your agent surface speaks WebMCP natively (its own tool discovery and
invocation), skip the JS wrappers and call the `qa_*` tools directly.

## Ack conventions

Acks are toasts. They are the operator's dopamine channel; keep them
short, emoji-prefixed, and specific.

- **First ack within 15 seconds** of a bug event. Even a bare
  "🐛 Got it, on it" beats a perfect message 40 seconds later.
- One emoji prefix per message, by meaning:
  - 🐛 bug received / logged
  - 🛠️ fix subagent dispatched
  - 🔀 fix PR open
  - 🙅 wontfix (always include the one-line reason)
  - 🤖 agent objective cleared / setup done
  - 🆘 help request handled
  - 📝 note received (only ack notes that ask something)
  - 🏆 milestone or wrap-up stats
- Status values track the bug lifecycle: `"logged"` → `"dispatched"` →
  `"pr_open"`, or `"wontfix"`. Send a new ack on each transition,
  carrying the same `bugEventId`.
- Keep messages under ~90 characters. Toasts auto-dismiss in about 6
  seconds; nobody reads a paragraph in a toast.

## Tab hygiene

State (quest, pending events, counters) lives in **sessionStorage**,
which is **per-tab**. Consequences:

- **Reload (same tab): safe.** State survives. The HUD script itself is
  gone after a hard reload, so re-inject `assets/qa-quest-hud.js`
  (idempotent, no-op refresh) when a probe fails, then keep polling.
- **Closed tab: undrained events are lost.** If the operator closes the
  quest tab, everything not yet drained is unrecoverable. Say exactly
  what was lost ("the tab closed with 2 pending events; anything you
  reported in the last ~15 seconds needs re-reporting"), re-inject in
  the new tab, and re-load the quest JSON from your session notes.
- **New tab / second tab: a blank world.** A second tab has no quest and
  no HUD until you inject and load there. Keep the session to one tab
  unless the flow genuinely requires more; if it does, treat each tab as
  its own bridge and poll both.
- After any recovery, verify with `getState()` that the quest, progress,
  and bug count match your session log before going quiet again.
