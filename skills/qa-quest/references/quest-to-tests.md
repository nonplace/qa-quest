# Quest-to-test compiler

Feature 1 of QA Quest: after a session, the objectives the operator
validated by hand are compiled into deterministic regression tests, so
the next release does not re-spend human attention on journeys that
already passed. Default target is a Playwright spec; the pattern adapts
to any browser test framework the host project already uses.

## What compiles

- **Input**: the session's quest JSON (every passed human objective with
  its `expected` outcome), your session log (routes visited, data used),
  and any semantic seam tools the app exposes (`semantic-seam.md`).
- **Output**: one spec file per zone (or per boss journey), containing
  test skeletons that replay the validated journeys.
- **Not compiled**: failed objectives (those are bugs, not tests),
  agent-only setup objectives (they become `beforeEach` setup instead),
  and objectives whose expected outcome you cannot assert
  deterministically yet (leave a `test.fixme` skeleton with a TODO
  explaining what is missing).

## The layer rule

Every compiled test has three parts, and each part has a rule:

- **SETUP** may use the app's own APIs or semantic seam tools. Seeding a
  user through the signup form in every test run is slow and brittle;
  seed through the API the app already trusts.
- **ACT replays real UI interaction.** This is non-negotiable. The whole
  value of the compiled test is that a real user's interaction path
  still works: real navigation, real clicks, real typing, on the same
  elements the operator used. If the act step goes through an API, you
  are testing the API, not the journey.
- **ASSERT** may combine a UI-visible signal (what the operator actually
  verified) with a deep check through the app's APIs or seam (what the
  UI cannot show, like the persisted order total).

## Compiled tests are proposals

The compiler's output goes into the app repo as a normal pull request
through the team's normal review flow. Never merge it yourself, never
commit directly to the default branch, and say in the PR body which QA
session and quest the specs were compiled from. Test code is production
code; the team decides what lands.

## Worked example

Source objective, from the Acme Shop smoke quest (`quest-format.md`):

```json
{ "id": "boss-checkout", "title": "BOSS: Complete checkout with the promo applied",
  "zone": "checkout", "expected": "Confirmation page shows the discounted total and an order number",
  "who": "human", "points": 400, "done": true, "doneAt": "2026-07-09T10:12:04.000Z" }
```

Compiled Playwright spec:

```ts
import { test, expect, type Cookie } from "@playwright/test";

// Compiled from QA Quest "Acme Shop Smoke Run" (smoke-2026-07-09),
// objective boss-checkout, validated by hand on 2026-07-09.
// SETUP/ASSERT use the staging test API; ACT is real UI only.

const BASE = process.env.ACME_BASE_URL ?? "https://staging.acme.test";

test.describe("checkout with promo code", () => {
  let user: { id: string; sessionCookies: Cookie[] };

  test.beforeEach(async ({ request, context }) => {
    // SETUP: seed through the app's own APIs, never through the UI.
    const seeded = await request.post(`${BASE}/api/test/seed-user`, {
      data: { plan: "standard", address: true },
    });
    user = await seeded.json();
    await request.post(`${BASE}/api/test/seed-cart`, {
      data: { userId: user.id, items: [{ sku: "ACME-MUG-01", qty: 2 }] },
    });
    // Session via API-issued cookies; the login form has its own spec.
    await context.addCookies(user.sessionCookies);
  });

  test("applies WELCOME10 and completes the order", async ({ page, request }) => {
    // ACT: real UI interaction from here on, replaying the operator's path.
    await page.goto(`${BASE}/cart`);
    await page.getByLabel("Promo code").fill("WELCOME10");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("10% off applied")).toBeVisible();

    await page.getByRole("button", { name: "Checkout" }).click();
    await page.getByRole("button", { name: "Place order" }).click();

    // ASSERT (UI): exactly what the operator verified by eye.
    await expect(page).toHaveURL(/\/orders\/[a-z0-9-]+\/confirmation/);
    await expect(page.getByRole("heading", { name: "Thanks for your order" })).toBeVisible();
    await expect(page.getByTestId("order-total")).toHaveText("$35.82"); // 2 x $19.90, minus 10%

    // ASSERT (deep): the persisted truth, through the app's API / seam.
    const orderId = page.url().match(/orders\/([a-z0-9-]+)/)?.[1];
    const order = await (await request.get(`${BASE}/api/test/orders/${orderId}`)).json();
    expect(order.status).toBe("confirmed");
    expect(order.discountCode).toBe("WELCOME10");
    expect(order.totalMinor).toBe(3582);
  });
});
```

Notes on the example:

- The seed endpoints (`/api/test/seed-user`, `/api/test/seed-cart`,
  `/api/test/orders/:id`) are the app's own staging-only test API, the
  kind of surface `semantic-seam.md` argues for. If the app has none,
  compile the setup as UI steps with a TODO recommending a seam.
- Selectors prefer user-facing roles and labels (`getByRole`,
  `getByLabel`) over CSS paths; they drift less and read like the
  operator's own actions.
- The dollar assertion pins the exact expected outcome from the
  objective ("discounted total"), not a loose "some total is visible".
- One objective became one focused test. Resist merging several
  objectives into a mega-test; when it fails, nobody knows which journey
  broke.

## Compile procedure

1. Collect passed human objectives from the final quest state
   (`getState().quest`), grouped by zone.
2. For each, reconstruct the journey from your session log: start route,
   interactions, the `expected` outcome the operator confirmed.
3. Map setup needs to app APIs or seam tools; write `beforeEach`.
4. Write the ACT steps as UI replay with role/label selectors.
5. Write UI + deep asserts from `expected`.
6. Mark anything you cannot make deterministic as `test.fixme` with a
   TODO, rather than shipping a flaky assertion.
7. Put specs where the host project keeps its browser tests, follow its
   naming, run them locally if possible, and open the PR (a draft, via
   the normal review flow).

If a compiled test later fails on a future release, see
`self-healing.md` before anyone hand-edits selectors.
