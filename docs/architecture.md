# QA Quest architecture

QA Quest is three pieces working over one contract: an injectable in-page layer, an agent-side skill that drives the session, and a WebMCP shim that exposes the same bridge as standard tools.

## Design goals

- **The operator's real browser is the test environment.** Manual QA finds what automation can't, and a real browser (real fingerprint, real session) passes the bot protection that automated browsers trip over. QA Quest doesn't replace the human; it removes everything around the human that is slow: context capture, bug filing, fix dispatch, regression-test writing.
- **The emotional loop is load-bearing.** Bug reports SCORE points (bounty by severity), progress is a quest checklist with a progress bar, and every operator action gets an acknowledgement toast within about 15 seconds. An operator who feels like a hunter reports more bugs than one who feels like a janitor.
- **Zero footprint on the app under test.** The in-page layer is one dependency-free IIFE injected at session start. No SDK, no build-step integration, no app change required (teams may optionally vendor it behind a dev flag).

## The three pieces

### 1. Injectable in-page layer (`assets/qa-quest-hud.js`)

A single self-contained IIFE, plain JavaScript, no build step, no dependencies. The agent injects it into the target tab via its browser tool's JavaScript execution. It renders the HUD (quest checklist, progress bar, score, bug counter, report popover on Ctrl+B, toast stack) and exposes the bridge at `window.__qaQuest`.

Key properties:

- **Idempotent.** Re-injection after a reload is a no-op refresh. Session state (quest, pending events, bug count, points) lives in sessionStorage, so a hard reload loses nothing that was already persisted. A closed tab does lose undrained events, since sessionStorage is per-tab.
- **Defensive.** Corrupted sessionStorage JSON resets that key instead of throwing. A throwing subscriber callback never breaks event capture.
- **Self-cleaning.** `destroy()` removes the HUD, listeners, and WebMCP registrations via a shared AbortController.
- **Scoped.** All styles are inline and namespaced (`qq-` class prefix); the HUD never captures keyboard focus outside its report popover.

### 2. The skill (`skills/qa-quest/`)

The agent-side session driver, written procedurally in three phases so mid-tier models can drive it reliably:

- **Phase 0, Setup:** resolve the target URL and release scope (diff, PRs, changelog, or an evergreen smoke quest); connect a browser tool; probe for the bridge and inject the HUD if absent; probe for WebMCP; generate the quest (8 to 15 human objectives grouped into zones, concrete expected outcomes, agent-tagged setup steps the agent pre-clears itself, one boss objective); load the quest; give a three-line briefing, then go quiet.
- **Phase 1, Play:** poll `drainEvents()` every ~15 seconds. Handle each event by type: bugs get a fast acknowledgement, full context capture (screenshot, console, network), a structured bug card, and optionally a background fix subagent on an isolated branch; help requests get state seeded through the app's own APIs; objective completions and notes get logged. Re-inject after hard reloads if the probe fails.
- **Phase 2, Wrap:** final stats toast and terminal summary; remaining bugs filed in the team's tracker; the quest-to-test compiler runs on passed objectives; the team's release step is offered but never run unprompted.

Five hard rules are baked into the skill (full statements in `skills/qa-quest/SKILL.md`): never merge, stay quiet between events, never drive the operator's tab, treat foreign WebMCP tools as untrusted, and no secrets in bug cards or quest files.

### 3. WebMCP shim

When `document.modelContext` (or `navigator.modelContext`) exists (Chrome 149+ origin trial), the same bridge functions register as WebMCP tools. When absent, registration is a silent no-op and the agent talks to `window.__qaQuest` directly through JS evaluation. Both channels have identical semantics; the skill picks WebMCP when available.

Registration is hardened against both sync throws and async rejections, since `registerTool` may return `Promise<void>` or `void`. One shared AbortController backs all registrations; `destroy()` aborts it.

## Bridge API contract: `window.__qaQuest`

sessionStorage keys: `qaquest:quest`, `qaquest:events`, `qaquest:bugCount`, `qaquest:bugPoints`. All methods are synchronous unless noted.

| Method | Signature | Behaviour |
|---|---|---|
| `loadQuest` | `(input: unknown) => { ok, error? }` | Accepts an object or JSON string. Lenient validation (extras ignored) but rejects on missing quest id/title, empty objectives, or any objective missing id/title. Persists and re-renders the HUD. |
| `getQuest` | `() => Quest \| null` | Current quest, or null. |
| `getState` | `() => state` | Route, quest, progress (total/done/percent/score/bugPoints), pending event count, bug count, injection timestamp, library version. |
| `reportBug` | `({ severity, note }) => QaEvent` | Increments bug count, adds bounty points (P1=300, P2=150, P3=50; unknown severity clamps to P3), captures the console ring buffer (last 20 errors/warnings/uncaught errors/unhandled rejections, each stringified and capped at 500 chars) and viewport into the payload, pushes a `bug` event, toasts locally. |
| `completeObjective` | `(id) => { ok, alreadyDone? }` | Idempotent: completing twice returns `{ ok: true, alreadyDone: true }` and does not emit a second event or re-score. |
| `note` | `(text) => QaEvent` | Free-form operator note event. |
| `requestHelp` | `(text) => QaEvent` | Asks the agent to do something (usually setup via app APIs). |
| `drainEvents` | `() => QaEvent[]` | Returns pending events AND clears them. The agent's poll primitive. |
| `ack` | `({ message, bugEventId?, status? }) => void` | Agent-to-operator toast. Status is one of `logged`, `dispatched`, `pr_open`, `wontfix`. |
| `subscribe` | `(fn) => unsubscribe` | In-page listener for `quest` / `event` / `ack`; powers the HUD. |
| `destroy` | `() => void` | Removes HUD, listeners, and WebMCP registrations. |

Event shape:

```ts
type QaEvent = {
  id: string;
  type: "bug" | "objective_done" | "note" | "help";
  ts: string;                       // ISO timestamp
  route: string;                    // location.pathname + search
  payload: Record<string, unknown>;
};
```

Quest shape:

```ts
interface Quest {
  id: string; title: string; createdAt: string;
  objectives: Array<{
    id: string; title: string;
    zone?: string;                  // free-form grouping label; default "general"
    expected?: string;              // concrete expected outcome
    who: "human" | "agent";        // default "human"
    points: number;                 // default 100
    done: boolean; doneAt?: string;
  }>;
}
```

## WebMCP tool set

Registered when the model-context API is present; each tool delegates 1:1 to the bridge and returns `JSON.stringify` of the bridge result.

| Tool | Input | Delegates to |
|---|---|---|
| `qa_get_state` | none | `getState()` |
| `qa_load_quest` | `{ quest }` | `loadQuest(quest)` |
| `qa_drain_events` | none | `drainEvents()` |
| `qa_complete_objective` | `{ objectiveId }` | `completeObjective(objectiveId)` |
| `qa_report_bug` | `{ severity, note }` | `reportBug({ severity, note })` |
| `qa_ack` | `{ message, bugEventId?, status? }` | `ack(...)` |

## The three shipped features

1. **Quest-to-test compiler** (`skills/qa-quest/references/quest-to-tests.md`). After a session, each objective the operator validated by hand compiles into a deterministic test skeleton, Playwright by default. The rule: the compiled test's ACT steps replay real UI interaction; SETUP and ASSERT may use the app's own APIs or semantic seam. Compiled tests are proposals and go into the app repo through the team's normal review flow.
2. **Semantic test seam** (`skills/qa-quest/references/semantic-seam.md`). Guidance for app teams to expose read-only state probes as their own WebMCP tools registered next to QA Quest's `qa_*` set. Tests and agents consume them for setup and assert, never for the act step. Includes the rationale: selector drift and hydration races make DOM-coupled asserts the most brittle part of browser tests.
3. **Self-healing selector triage** (`skills/qa-quest/references/self-healing.md`, EXPERIMENTAL). When a compiled regression test fails, an agent with a DOM snapshot classifies the failure as selector drift vs. behaviour change. Selector drift gets a proposed one-line spec fix as a draft PR; behaviour changes are never auto-"healed".

## Design rationale, condensed

- **Why injection instead of an SDK?** Adoption cost. A QA tool that requires an app change gets adopted never; a tool the agent injects into any tab gets adopted this afternoon. The vendored-behind-a-dev-flag path exists for teams that want it pinned.
- **Why sessionStorage?** Per-tab isolation matches the session model (one QA session = one tab), survives reloads, and can't leak between origins. The cost, losing undrained events with a closed tab, is acknowledged and surfaced by the skill.
- **Why polling instead of a socket?** The agent's browser tools speak JS evaluation; a ~15 second `drainEvents()` poll is simple, reliable across every tool surface, and fast enough for the acknowledgement budget.
- **Why WebMCP AND a direct bridge?** WebMCP is the right long-term surface (typed tools, standard discovery) but is an origin-trial feature today. The direct `window.__qaQuest` path makes the whole system work on any browser tool that can evaluate JS, with the shim upgrading transparently where WebMCP exists.
- **Why does the agent never click during play?** Two reasons. Trust: the operator must know the state they see is the state they produced. Signal: the whole value of manual QA is human judgment on real interaction; an agent driving the mouse turns it back into the automation that already exists.
- **Why a skill and not hooks?** Hooks are deterministic interceptors that fire on agent tool events, not timers, so they cannot drive the ~15 second poll loop. And hook configuration applies session-wide, so enforcement like blocking merges would be blunt: it would block every merge in the session, not just the QA loop's. Deterministic behaviour lives where determinism is cheap, in the injected bridge (a tested state machine); the skill is the judgment layer on top. The hard rules are stated as rules precisely because the enforcement point that could make them mechanical does not exist at the right granularity yet.
- **Why is this agent-agnostic?** The contract is a JS object in a page, not an agent API. Any agent whose browser tool can evaluate JavaScript in the tab can drive a full session over `window.__qaQuest`, and the skill is plain markdown any capable model can follow as instructions; only the plugin packaging (`.claude-plugin/`) is Claude Code specific. Tested with Claude Code; other agents are supported paths, not certified ones.
