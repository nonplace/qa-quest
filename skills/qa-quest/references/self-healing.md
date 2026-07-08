# Self-healing selector triage (EXPERIMENTAL)

> **Status: EXPERIMENTAL.** This workflow proposes changes to test code
> from an automated classification. Run it only with the draft-PR
> guardrails below intact, and expect to tune the classification for
> your app. Nothing here ever merges on its own.

Feature 3 of QA Quest: when a compiled regression test
(`quest-to-tests.md`) fails on a later release, an agent with the
failure artifacts classifies the failure as **selector drift** or
**behaviour change**, and only in the drift case proposes a fix.

## The two failure classes

- **Selector drift**: the journey still works; the test's way of finding
  an element does not. A button was renamed from "Place order" to
  "Complete purchase", a `data-testid` moved, a heading level changed.
  The user is fine; the spec is stale.
- **Behaviour change**: the journey itself is different. The promo no
  longer applies, the confirmation page shows a different total, the
  flow gained a step. Whether it is a regression or an intentional
  product change, a machine must not decide that, and a test must not be
  edited to accept it silently.

The entire feature is the discipline of telling these apart before
anyone touches the spec.

## Inputs the triage agent needs

- The failing test file and the exact failing line/locator.
- The failure message and trace (Playwright's error context and, when
  available, the trace file).
- A **DOM snapshot** of the page at the failure point (Playwright
  attaches one to the error context; otherwise capture
  `page.content()` or an accessibility snapshot on failure).
- The spec's intent, from the compiled-from comment (quest id and
  objective) that `quest-to-tests.md` puts at the top of every spec.

## Classification procedure

1. **Find the intended element in the snapshot.** Search the DOM
   snapshot for the element the failing locator meant: same role with
   near-identical accessible name, same test id under a new parent, same
   visible text with changed casing or punctuation.
2. **Drift signature**: a single, unambiguous candidate exists whose
   purpose is clearly the same (a button in the same form, a heading in
   the same region), and the surrounding journey state matches the
   test's expectations up to that point. Verdict: selector drift.
3. **Behaviour signature**: the element is genuinely absent, the page is
   a different page, an assertion on VALUES failed (a total, a status, a
   count), the flow order changed, or there are multiple plausible
   candidates. Verdict: behaviour change.
4. **When torn, choose behaviour change.** A false "drift" verdict
   silently rewrites a test around a real regression; a false
   "behaviour" verdict merely asks a human to look. The costs are not
   symmetric.

## What each verdict produces

**Selector drift** → a **one-line spec fix as a draft PR**:

- Change exactly one line: the drifted locator, nothing else. No
  assertion changes, no timeout bumps, no drive-by cleanups. If fixing
  the failure honestly needs more than one line, it is not a drift fix;
  reclassify as behaviour change.
- Open a **draft** pull request through the project's normal review
  flow, titled so the class is obvious (for example
  `test: heal drifted locator in checkout promo spec`).
- The PR body carries the evidence: the failing locator, the matched
  element from the snapshot, and why the classification is drift.
- Run the healed test before opening the PR; a heal that does not make
  the test pass is a misclassification.

Example, the Acme Shop checkout spec after a copy change:

```diff
-    await page.getByRole("button", { name: "Place order" }).click();
+    await page.getByRole("button", { name: "Complete purchase" }).click();
```

**Behaviour change** → **never auto-"healed"**:

- Do not touch the spec. A test failing on changed behaviour is the
  system working.
- File it for humans: a bug card if it looks like a regression, or a
  note to the team that an intentional change needs its spec updated
  (and possibly a fresh QA quest objective for the new flow).
- The report states what the test expected, what the snapshot shows, and
  why this is not drift.

## Guardrails (the reason this is shippable at all)

- Draft PRs only; a human merges or closes every heal.
- One line per heal, one heal per PR. Reviewers can judge a one-line
  locator swap in seconds; batches hide mistakes.
- Assertions are never weakened, waits are never lengthened, and
  `test.skip`/`test.fixme` are never introduced by this workflow.
- If the same spec needs healing repeatedly, stop healing and tell the
  team: the app needs stabler selectors (roles, labels, test ids) or a
  semantic seam assert (`semantic-seam.md`), not a faster patch loop.
