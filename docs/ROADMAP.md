# QA Quest — Roadmap to 1.0.0

Goal: the perfect webapp QA suite. A co-op QA session should be **lossless**,
**low-latency**, **resumable**, and **self-documenting** — the operator hunts,
the agent captures, and nothing ever falls on the floor.

This backlog is evidence-gated: every item traces to a concrete observation
from a real run. The canonical motivating incident is **swayq run-1055**
(2026-07-08/09), where 5 of 10 reported bugs (one P1 + four P2, by point
checksum) were permanently lost. Status legend: 🔴 blocker for 1.0 · 🟠 should ·
🟢 nice-to-have · ✅ shipped.

### Shipped in 0.4.0 (2026-07-09) — the run-1055 hotfix

- ✅ **1.1** append-only durable archive (`qaquest:archive`, drain never deletes)
- ✅ **1.2** peek/ack cursor (`peekEvents` + `ackEvents`) for true at-least-once
- ✅ **1.4** loss-visible HUD ("🛡 Secured N", red divergence warning)
- ✅ plus `getArchive({sinceSeq})`, `exportSession()`, monotonic `seq`, a HUD
  export button, and six new WebMCP tools (`qa_peek_events`, `qa_ack_events`,
  `qa_get_archive`, `qa_export_session`, `qa_note`, `qa_request_help`).

### Shipped in 0.5.0 (2026-07-11) — closed-tab durability + HUD ergonomics

- ✅ **1.5** durable storage split: the archive + `seq` now live in
  `localStorage` (`durableStorage`), not the per-tab `sessionStorage` that
  quest/pending-events/counters still use. A closed tab no longer loses
  reported bugs — verified with a real two-tab Chrome smoke test.
- ✅ `getBugs({sinceSeq?})` — non-destructive, bug-filtered read of the
  durable archive; the new canonical "what bugs were found" accessor.
- ✅ `clearBugs()` — explicit durable-log reset for a fresh run, without
  touching quest state or score counters.
- ✅ HUD is pointer-draggable (mouse + touch), so it can be moved off content
  it would otherwise obstruct on narrow/mobile-simulated viewports. A
  move-threshold keeps the pill's expand/collapse click and the head's own
  buttons working unchanged.

Remaining for 1.0: 1.3 (durable sink / immediate transfer), 2.1 (HUD survives
SPA), 2.2 (operator marks objectives — partially present as clickable rows),
3.x (push transport). Everything below is the forward view.

---

## Theme 1 — Delivery guarantee (the run-1055 class). 🔴 highest priority

The bridge today is **at-most-once**: `reportBug` writes to `sessionStorage`
under one events key, and `drainEvents()` **deletes** that key on read. Three
independent failure modes converged in run-1055 and again today:

1. **Truncated inline drain.** Draining 8 events at once returned a tool
   response truncated after #5 — but the drain had *already* cleared
   sessionStorage, so #6-#10 were gone with no copy anywhere.
2. **Session-end loss.** A Claude session that drains and then ends without
   persisting to disk loses everything it drained. bugCount/bugPoints are
   cumulative counters that survive; the actual notes ride in the events key
   and do not.
3. **Closed tab.** sessionStorage is per-tab; closing the quest tab
   evaporates any undrained events.

The count/notes divergence is **silent** — today the operator saw
`swaqa:bugCount=10` with zero recoverable notes and no signal that anything
was wrong.

### 1.1 At-least-once delivery via an append-only archive 🔴
Every `reportBug` (and ideally every event) also appends to an **archive key
that drain never deletes** (e.g. `qaquest:archive`). Drain removes items from
the *pending* queue only; the archive is the durable record. Recovery at any
time (including session end) reads the archive. This is the single highest-value
fix — it makes "reported" mean "persisted" independent of agent polling.
- Agent-side stopgap already usable today with no HUD change: the drain call
  can `sessionStorage.setItem("qaquest:archive", prev.concat(drained))` in the
  same eval before returning, so a truncated inline return is always recoverable
  from the archive key.

### 1.2 Ack-cursor removal (true at-least-once) 🔴
Drain returns pending events but does **not** delete them; the agent sends an
`ack` carrying the delivered event IDs, and only then are those IDs removed
from the pending queue. Converts delete-on-read into delivered-then-remove.
Pairs with 1.1 (archive is the belt; ack-cursor is the suspenders).

### 1.3 Immediate external transfer (optional durable sink) 🟠
On report, optionally `navigator.sendBeacon` / `fetch` the event to a
configurable durable sink (webhook URL via a data-attribute or config), so
"reported == transferred off the tab" the instant the operator hits submit,
before any poll. Must stay optional + portable (no assumed server); when unset,
the archive (1.1) is the durable layer.

### 1.4 Loss-visible HUD counters 🟠
Surface `N reported / M delivered-to-agent / K archived` in the HUD so any
divergence (the run-1055 `count=10, events=0`) is loud, not silent. A red
"undelivered" badge when pending > 0 and no drain has happened recently.

### 1.5 Cross-tab durability ✅ shipped in 0.5.0
The archive + `seq` now live in `localStorage` instead of `sessionStorage`, so
a closed/lost tab no longer loses reported bugs; `getBugs()`/`getArchive()`
read the same durable record from any tab on the origin. Quest state, the
pending queue, and score counters remain per-tab by design (sessionStorage),
matching the "one QA session = one tab" model — a second tab sees the durable
bug log but starts its own quest/score, so there is no multi-tab
double-counting to guard against. A `BroadcastChannel`-based live sync of
quest/progress across tabs is still open if a genuine multi-tab session
becomes a real use case.

---

## Theme 2 — HUD reliability & ergonomics. 🟠

### 2.1 HUD survives SPA navigation and re-renders 🔴
Today's run: the operator "cannot see them in the UI" — the HUD overlay
vanished mid-session (SPA route change / framework re-render / z-index / the
app tearing down injected nodes). The HUD must be resilient: mount into an
isolated root (shadow DOM), re-attach via a `MutationObserver` if removed, and
survive client-side navigations without a re-inject. A QA HUD that disappears
is a QA HUD you stop trusting.

### 2.2 Operator can mark objectives done from the HUD 🟠
Run-1055 finished with **every human objective still `done:false`** — the
operator played through but the bridge's done-state never moved because only
the agent can call `completeObjective`. Add a one-tap "clear objective"
affordance (checkbox per objective) so gameplay state tracks reality. Feeds the
Phase 2 quest-to-tests compiler (only passed objectives compile).

### 2.3 In-modal severity picker + richer capture ✅ (picker shipped earlier; capture still open 🟢)
The bug-report popover already has an explicit P1/P2/P3 chip picker (not
free-text) and auto-bundles the console ring + viewport + route into the
event payload. Still open: a screenshot handle in the same payload, so the
agent's capture step is pure confirmation instead of a separate screenshot
round-trip.

### 2.4 Objective-aware bug tagging 🟢
When a bug is reported while an objective is "active," tag the event with that
objective id so bugs cluster by quest zone in the wrap-up.

### 2.5 Draggable / repositionable HUD ✅ shipped in 0.5.0
The pill and panel head are pointer-draggable (mouse + touch) so the fixed
bottom-right HUD can be moved off content it would otherwise obstruct on
narrow or mobile-simulated viewports. A move-threshold distinguishes a drag
from a click so existing click behaviour (expand/collapse, export, report)
is unaffected.

---

## Theme 3 — Transport & real-time. 🟢→🟠

### 3.1 Poll latency → push 🟠
15s poll is the current transfer cadence; combined with destructive drain it is
the loss window. Tight polling + archive (Theme 1) is the stopgap. The 1.0 goal
is push: WebMCP streaming when the origin trial matures, or an SSE/WebSocket
side-channel when a sink (1.3) is configured.

### 3.2 WebMCP-native, retire the JS shim 🟢
When agent surfaces speak WebMCP natively (first-class tool discovery +
invocation against the page), delete the `window.__qaQuest`-via-`evaluate`
wrappers. Track Chrome origin-trial maturity; the shim's own retirement
condition is already documented.

---

## Theme 4 — Quest authoring & outputs. 🟢

### 4.1 Semi-automated quest generation from release scope 🟠
Generate the quest draft from the PR list / diff / changelog automatically
(zones from touched areas, objectives from changed surfaces, one boss from the
most integrative journey), agent refines. Reduces Phase 0 to a review, not an
authoring, step.

### 4.2 Quest-to-tests polish + self-healing 🟢
Harden the passed-objective → spec compiler (currently proposal-quality) and
mature the experimental self-healing path (a compiled regression test that
later fails proposes its own repair). These are the durable payoff of a run.

### 4.3 Run analytics 🟢
Persist per-run stats (bugs by severity, find-rate, objective pass-rate,
time-to-first-bug) across runs so QA effectiveness is measurable over a release
train.

---

## Theme 5 — Multi-actor & scale. 🟢

### 5.1 Multi-tab / multi-role quests
Some journeys need two actors (brand ⇄ creator, buyer ⇄ seller). Model each tab
as its own bridge with a shared quest and a merged event stream.

### 5.2 Foreign-WebMCP safety hardening
The untrusted-foreign-tool rule is documented; add runtime guards (schema
inspection, explicit-consent prompts) so a page's own WebMCP tools can never be
invoked by the QA agent without operator say-so.

---

## Sequencing for 1.0.0

1. **Theme 1.1 + 1.2** (archive + ack-cursor) — closes the run-1055 data-loss
   class. Non-negotiable for 1.0.
2. **Theme 2.1** (HUD survives SPA) — a QA HUD that disappears is unusable.
3. **Theme 1.4 + 2.2** (loss-visible counters + operator-done) — makes state
   honest and gameplay real.
4. **Theme 1.3 / 3.1** (durable sink + push) — removes the poll window entirely.
5. Everything else is post-1.0 polish.

---

*Maintained as the living backlog for QA Quest. Add items with a one-line
evidence trace to the run that surfaced them. Roughness at the edges is
expected at 0.x; this file is how we grind it smooth by 1.0.0.*
