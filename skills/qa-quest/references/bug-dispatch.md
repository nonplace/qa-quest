# Bug dispatch

What happens after a bug event: triage, the bug card, and (optionally)
handing the fix to a background subagent. The prime directive applies
throughout: **the QA loop never merges anything.** Fix branches and PRs
go through the project's normal review gates, always.

## Severity triage

The operator picks a severity when reporting (P1/P2/P3, default P2).
Trust it as the starting point, but you see the console and network
context they may not; adjust with a one-line note in the bug card when
the evidence disagrees.

| Severity | Meaning | Bounty | Typical response |
|---|---|---|---|
| P1 | Blocks a core journey, data loss, security smell, crash | 300 | Ack, capture, dispatch a fix subagent now |
| P2 | Feature wrong or degraded, workaround exists | 150 | Ack, capture, dispatch if the fix looks contained |
| P3 | Cosmetic, copy, polish, minor layout | 50 | Ack, capture, usually file for later instead of dispatching |

Security-smelling findings (auth bypass, leaked data in a response,
injection) are P1 regardless of visual impact, and the bug card goes to
a human first; do not paste sensitive response bodies into the card.

## Bug card template

Write one card per bug event, immediately after the first ack, from the
event payload plus your own capture (screenshot, console, network).
Store cards in your session log; they become tracker issues at wrap.

```markdown
## 🐛 [P2] Promo code apply returns a 500 on whitespace input

- **Event**: evt-a1b2c3 at 2026-07-09T09:41:22Z
- **Route**: /cart
- **Severity**: P2 (bounty 150)
- **Operator note**: "typed spaces into the promo field, hit apply, got an error toast"

### Reproduction
1. Add any item to the cart on https://staging.acme.test
2. In the promo code field, enter "   " (spaces only)
3. Click Apply

**Expected**: validation message ("enter a promo code")
**Actual**: error toast; POST /api/cart/promo returns 500

### Evidence
- Screenshot: <path or attachment>
- Console (from event payload): `TypeError: code.trim is not a function` at promo.js:48
- Network: POST /api/cart/promo → 500, response body `{"error":"internal"}`

### Suspected area
- Promo validation skips the empty-after-trim case; likely in the cart
  promo handler.

### Status
logged → dispatched → pr_open | wontfix   (current: logged)
```

Rules for the card:

- Reproduction steps must be replayable by someone who was not in the
  session.
- Evidence is quoted, not paraphrased. Trim console entries to the
  relevant lines.
- **Never** include secrets, tokens, cookies, session IDs, or personal
  data. Redact request headers and auth-bearing payloads before pasting.
- Keep the status line current; it mirrors the ack statuses the operator
  sees as toasts.

## Dispatching a fix subagent

Dispatch is optional and yours to judge. Good candidates: P1s, and P2s
where the card already points at a contained cause. Poor candidates:
anything smelling of design intent, cross-cutting refactors, or bugs you
could not localise. When in doubt, file the card and move on; the
session's job is finding bugs, not fixing all of them live.

If your agent surface has no background subagent facility (or no access
to the code), skip dispatch entirely: keep every card at `logged`,
continue polling, and hand the cards over at wrap. The session loses
nothing but live fixes.

Dispatch in the **background** so the polling loop never stalls. Adapt
the prompt below to the host project (its branch naming, test commands,
and PR conventions), and always pass the full bug card, never a
paraphrase.

### Fix subagent prompt template

```text
You are a background fix agent for one bug found during a QA session.
Work ONLY on this bug. Full bug card follows at the end; treat its
reproduction steps as the acceptance test.

Non-negotiable working rules:

1. ISOLATED WORKTREE. Create a fresh git worktree on a new branch off
   the latest default branch (git fetch first). Run `pwd` to confirm you
   are inside the worktree before any edit, and reference files by
   repo-relative paths. Never commit on the dispatcher's checkout.
2. ROOT CAUSE OVER PATCH. Reproduce the bug first. Then explain, in one
   paragraph in your final report, WHY it happens. Fix the cause, not
   the symptom. If the honest fix is a design change, say so instead of
   papering over it.
3. CHEAPEST REGRESSION TEST FIRST. Before the fix, add the cheapest
   test that fails on the current code because of this bug (unit test
   over integration test over browser test). Make it pass with the fix.
   No fix ships without its test.
4. HARD STOP CONDITIONS. STOP and report back WITHOUT writing further
   code if the fix requires: a database schema change or migration, OR
   touching more than 5 files, OR changing a public API contract, OR
   anything auth/payment/security-critical. These need a human decision,
   not a background agent.
5. NEVER MERGE. Run the project's test suite and linter, push the
   branch, open a DRAFT pull request titled per the project's
   conventions, and link the bug card in the PR body. Your job ends at
   the open draft PR. Do not enable auto-merge, do not mark ready for
   review, do not merge.

Report back with: worktree path, branch, root-cause paragraph, test
added, PR URL (or the stop condition you hit and what you found).

--- BUG CARD ---
<paste the full bug card here>
```

### After dispatch

- Ack the operator with status `"dispatched"` as soon as the subagent is
  running.
- When the subagent reports a PR, ack with `"pr_open"` and the PR link
  in the terminal wrap notes (not in the toast; toasts stay short).
- If the subagent hits a stop condition, downgrade gracefully: keep the
  card at `logged`, note the finding, and include it in the wrap
  summary as needing a human-led fix.
- A `wontfix` verdict is always accompanied by a reason in both the ack
  and the card.
