# Semantic test seam

Feature 2 of QA Quest: guidance for app teams on exposing **read-only
state probes** so that agents and compiled tests can set up and assert
against the app's real state instead of scraping the DOM for it. This is
a pattern document; the app team owns the implementation.

## Why the DOM is a bad oracle

UI-only assertions accumulate two failure classes that have nothing to
do with the behaviour under test:

- **Selector drift.** A class rename, a component library upgrade, a
  copy tweak ("Place order" becomes "Complete purchase") breaks the test
  while the journey still works. The test screams; the app is fine.
- **Hydration and timing races.** Modern apps render, hydrate, and
  re-render. An assertion that reads text mid-hydration, or a wait that
  keys off network-idle while background chatter keeps the network busy,
  passes or fails on scheduling luck. Flakes erode trust until greens
  stop meaning anything.

A semantic seam sidesteps both for the parts of a test that never needed
the DOM: state setup and deep-state assertions. "Does the persisted
order have `discountCode: WELCOME10` and `totalMinor: 3582`?" is a
question for the app, not for a `<span>`.

## The caveat that keeps tests honest: act must stay real

The seam is for SETUP and ASSERT only. The **ACT step of a compiled test
replays real UI interaction, always** (see the layer rule in
`quest-to-tests.md`). A test that acts through APIs proves the API
works; it says nothing about whether a human can still click their way
through the journey, which is the exact thing a QA session validated and
the exact regression the compiled test exists to catch. If the seam ever
tempts you to "just call the endpoint" in the act step, you have deleted
the test's reason to exist.

## The v0.1 pattern: register your own WebMCP tools next to QA Quest's

QA Quest does not provide a plugin API for app-specific tools in v0.1
(a `window.__qaQuest.registerAppTool` hook was considered and cut).
Instead, the pattern is direct and needs nothing from QA Quest: the app
registers its **own** WebMCP tools on the same model-context API, side
by side with the `qa_*` set.

```js
// In the app's staging/dev bundle, behind the team's own flag.
const mc = document.modelContext ?? navigator.modelContext;
if (mc && window.ACME_TEST_SEAM_ENABLED) {
  mc.registerTool({
    name: "acme_get_cart",
    description: "Read-only: current cart lines, promo, and totals for the signed-in session.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async execute() {
      const cart = await window.acmeStore.getCartSnapshot();
      return JSON.stringify(cart);
    },
  });

  mc.registerTool({
    name: "acme_get_order",
    description: "Read-only: persisted order by id (status, discountCode, totalMinor).",
    inputSchema: {
      type: "object",
      properties: { orderId: { type: "string" } },
      required: ["orderId"],
    },
    async execute(input) {
      const { orderId } = JSON.parse(input);
      return JSON.stringify(await window.acmeStore.getOrder(orderId));
    },
  });
}
```

Agents discover and call these exactly like the `qa_*` tools
(`webmcp-shim.md`); compiled tests reach the same state through the
app's HTTP test API when running headlessly in CI. Seam tools and a
staging test API are two doors to the same room; ship whichever fits
your stack, or both.

## Design rules for seam tools

- **Read-only, strictly.** Seam tools observe; they never mutate. State
  setup belongs to a separate, explicitly-named staging test API
  (`/api/test/...`) that is trivially greppable and never ships to
  production.
- **Prefix with your app name** (`acme_*`), never `qa_*`. The prefix is
  the trust boundary: agents treat unknown prefixes as foreign tools and
  read the schema before calling.
- **Honest descriptions and tight schemas.** The description is what an
  agent reads to decide whether calling you is safe. Say "read-only" in
  it, mean it, and use `additionalProperties: false`.
- **No secrets in output.** Seam responses end up in test artifacts,
  logs, and bug cards. Return domain state (statuses, totals, ids),
  never tokens, credentials, or other users' data.
- **Gate it.** Behind a build flag, an environment check, or both. The
  seam is a staging/dev capability; production exposure is a security
  finding, not a convenience.
- **Version thoughtfully.** Compiled tests will depend on these shapes.
  Additive changes are cheap; renames and removals break the regression
  suite you built this whole system to feed.
