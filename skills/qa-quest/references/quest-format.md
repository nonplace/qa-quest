# Quest format

The quest is the level. It is a single JSON object loaded into the bridge
via `loadQuest` and rendered by the HUD as a checklist with a progress bar
and score. This file is the contract plus the level-design guidance.

## Contract

```ts
interface Quest {
  id: string; title: string; createdAt: string;
  objectives: Array<{
    id: string; title: string;
    zone?: string;                 // free-form grouping label; default "general"
    expected?: string;             // concrete outcome the operator can verify
    who: "human" | "agent";       // default "human"; invalid values normalise to "human"
    points: number;                // default 100; invalid/non-positive values become 100
    done: boolean; doneAt?: string;
  }>;
}
```

`loadQuest` accepts either the object or a JSON string of it. Validation
is lenient: unknown extra keys are ignored. It rejects (returns
`{ok:false, error}`) only when:

- the quest is missing `id` or `title`
- `objectives` is empty or missing
- any objective is missing `id` or `title`

On success the quest persists to sessionStorage (`qaquest:quest`) and the
HUD re-renders.

## Scoring

- Each objective is worth its `points` when completed (default 100).
- Bugs pay a bounty on top, independent of objectives:
  P1 = 300, P2 = 150, P3 = 50 (unknown severities clamp to P3).
- Score and bug points are tracked separately in
  `getState().progress` (`score` and `bugPoints`) so the wrap-up can
  report both "level cleared" and "bounty earned".

Bugs scoring points is the core loop. A session that finds five bugs and
finishes three objectives is a GREAT session, and the numbers should say
so.

## Level design guidance

Build the quest from the release scope (diff, PR list, changelog, or the
operator's description). Rules of thumb:

- **8 to 15 human objectives.** Fewer feels thin; more overwhelms a
  single sitting. Split bigger releases into multiple quests.
- **Zones group the map.** Use the app's own areas as zone labels
  ("storefront", "cart", "checkout", "account"). Order objectives so the
  operator moves through zones naturally instead of ping-ponging.
- **Concrete `expected` outcomes.** The operator must be able to judge
  pass/fail without asking you. "Order confirmation shows the discounted
  total and an order number" beats "checkout works".
- **Agent-tagged setup steps.** State the session needs (seeded account,
  a product in stock, a pending order) becomes `who: "agent"`
  objectives. You clear these yourself in Phase 0 through the app's own
  APIs, before the briefing, so the operator's checklist starts warm.
  The HUD marks them with a robot icon so the operator sees the co-op.
- **Exactly one boss objective.** The last, biggest, most integrative
  journey of the release, worth noticeably more points (300 to 500).
  Prefix its title with "BOSS:" so the HUD copy lands.
- **Point weights signal priority.** Default 100; bump risky or central
  objectives to 150 to 200. Don't fine-tune beyond that, the numbers are
  a nudge, not accounting.
- **Titles are player-facing.** Write them as actions ("Apply promo code
  WELCOME10 in the cart"), not test-case IDs.

## Evergreen smoke quest

When there is no release scope, run the standing smoke level: the
shortest walk that touches every business-critical surface. Adapt this
template (fictitious "Acme Shop" example) to the actual app:

```json
{
  "id": "smoke-2026-07-09",
  "title": "Acme Shop Smoke Run",
  "createdAt": "2026-07-09T09:00:00.000Z",
  "objectives": [
    { "id": "seed-account", "title": "Seed a fresh test account with one saved address",
      "zone": "setup", "who": "agent", "points": 100, "done": false },
    { "id": "seed-stock", "title": "Ensure ACME-MUG-01 is in stock on staging",
      "zone": "setup", "who": "agent", "points": 100, "done": false },
    { "id": "home-loads", "title": "Open the home page",
      "zone": "storefront", "expected": "Hero banner and nav render, no error toasts",
      "who": "human", "points": 100, "done": false },
    { "id": "search", "title": "Search for \"mug\" and open the first result",
      "zone": "storefront", "expected": "Results list shows ACME-MUG-01; product page shows price and stock",
      "who": "human", "points": 100, "done": false },
    { "id": "add-to-cart", "title": "Add 2 mugs to the cart",
      "zone": "cart", "expected": "Cart badge shows 2; cart page lists the line item with quantity 2",
      "who": "human", "points": 100, "done": false },
    { "id": "promo", "title": "Apply promo code WELCOME10 in the cart",
      "zone": "cart", "expected": "\"10% off applied\" confirmation; total drops accordingly",
      "who": "human", "points": 150, "done": false },
    { "id": "login", "title": "Sign in with the seeded test account",
      "zone": "account", "expected": "Lands on the account page; saved address is listed",
      "who": "human", "points": 100, "done": false },
    { "id": "profile-edit", "title": "Change the display name and save",
      "zone": "account", "expected": "Change persists after a reload",
      "who": "human", "points": 100, "done": false },
    { "id": "boss-checkout", "title": "BOSS: Complete checkout with the promo applied",
      "zone": "checkout", "expected": "Confirmation page shows the discounted total and an order number",
      "who": "human", "points": 400, "done": false }
  ]
}
```

Keep a copy of the generated quest JSON in your session notes. It is the
input to the quest-to-test compiler (`quest-to-tests.md`) and the record
of what this release was tested against.
