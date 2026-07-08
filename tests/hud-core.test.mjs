// Tests for the pure logic core of assets/qa-quest-hud.js.
// Zero dependencies: node:test + node:assert/strict only.
// Run with: node --test tests/
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const HUD_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "qa-quest-hud.js");
const core = require(HUD_PATH);

// Minimal sessionStorage-shaped stub backed by a Map.
function makeStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
    map
  };
}

function validQuest(overrides = {}) {
  return {
    id: "q1",
    title: "Release 1.2 smoke",
    createdAt: "2026-01-01T00:00:00.000Z",
    objectives: [
      { id: "o1", title: "Sign up as a new user", zone: "auth", points: 100 },
      { id: "o2", title: "Add an item to the cart", zone: "shop", points: 150 },
      { id: "o3", title: "Seed demo data", who: "agent", points: 50 }
    ],
    ...overrides
  };
}

function makeSession(storage = makeStorage(), extra = {}) {
  return core.createSession({
    storage,
    getRoute: () => "/checkout?step=2",
    getConsoleSnapshot: () => ["[error] boom"],
    getViewport: () => ({ width: 1280, height: 800, devicePixelRatio: 2 }),
    ...extra
  });
}

describe("module surface", () => {
  test("exports the core API and version", () => {
    assert.equal(core.VERSION, "0.1.0");
    assert.deepEqual(core.BOUNTY, { P1: 300, P2: 150, P3: 50 });
    assert.deepEqual(core.KEYS, {
      quest: "qaquest:quest",
      events: "qaquest:events",
      bugCount: "qaquest:bugCount",
      bugPoints: "qaquest:bugPoints"
    });
    for (const fn of ["parseQuest", "computeProgress", "createRing", "createSession", "normalizeSeverity", "bountyFor"]) {
      assert.equal(typeof core[fn], "function", `core.${fn} should be a function`);
    }
  });

  test("hud file passes node --check (valid syntax)", () => {
    execFileSync(process.execPath, ["--check", HUD_PATH]);
  });
});

describe("parseQuest", () => {
  test("accepts a valid quest object", () => {
    const res = core.parseQuest(validQuest(), "2026-01-02T00:00:00.000Z");
    assert.equal(res.ok, true);
    assert.equal(res.quest.id, "q1");
    assert.equal(res.quest.title, "Release 1.2 smoke");
    assert.equal(res.quest.objectives.length, 3);
  });

  test("accepts a JSON string", () => {
    const res = core.parseQuest(JSON.stringify(validQuest()), "2026-01-02T00:00:00.000Z");
    assert.equal(res.ok, true);
    assert.equal(res.quest.objectives[1].points, 150);
  });

  test("rejects invalid JSON strings", () => {
    const res = core.parseQuest("{not json", "2026-01-02T00:00:00.000Z");
    assert.equal(res.ok, false);
    assert.match(res.error, /JSON/);
  });

  test("rejects non-object inputs", () => {
    for (const bad of [null, 42, [], undefined, true]) {
      assert.equal(core.parseQuest(bad, "now").ok, false);
    }
  });

  test("rejects missing quest id / title", () => {
    assert.equal(core.parseQuest(validQuest({ id: undefined }), "now").ok, false);
    assert.equal(core.parseQuest(validQuest({ id: "  " }), "now").ok, false);
    assert.equal(core.parseQuest(validQuest({ title: "" }), "now").ok, false);
  });

  test("rejects missing / empty / non-array objectives", () => {
    assert.equal(core.parseQuest(validQuest({ objectives: [] }), "now").ok, false);
    assert.equal(core.parseQuest(validQuest({ objectives: undefined }), "now").ok, false);
    assert.equal(core.parseQuest(validQuest({ objectives: "nope" }), "now").ok, false);
  });

  test("rejects any objective missing id or title", () => {
    const noId = validQuest({ objectives: [{ title: "t" }] });
    const noTitle = validQuest({ objectives: [{ id: "o1" }] });
    assert.equal(core.parseQuest(noId, "now").ok, false);
    assert.equal(core.parseQuest(noTitle, "now").ok, false);
  });

  test("normalises zone, who, points, done", () => {
    const res = core.parseQuest(
      validQuest({
        objectives: [
          { id: "o1", title: "a", who: "robot", points: -5, done: "yes" },
          { id: "o2", title: "b", zone: "  ", points: "100" },
          { id: "o3", title: "c", who: "agent", points: 0 },
          { id: "o4", title: "d", points: Number.NaN }
        ]
      }),
      "now"
    );
    assert.equal(res.ok, true);
    const [o1, o2, o3, o4] = res.quest.objectives;
    assert.equal(o1.who, "human", "invalid who normalises to human");
    assert.equal(o1.points, 100, "negative points normalise to 100");
    assert.equal(o1.done, false, "truthy non-boolean done normalises to false");
    assert.equal(o2.zone, "general", "blank zone defaults to general");
    assert.equal(o2.points, 100, "string points normalise to 100");
    assert.equal(o3.who, "agent");
    assert.equal(o3.points, 100, "zero points normalise to 100");
    assert.equal(o4.points, 100, "NaN points normalise to 100");
  });

  test("defaults createdAt to the provided now when missing", () => {
    const res = core.parseQuest(validQuest({ createdAt: undefined }), "2026-03-04T05:06:07.000Z");
    assert.equal(res.quest.createdAt, "2026-03-04T05:06:07.000Z");
  });

  test("ignores extra fields on quest and objectives", () => {
    const res = core.parseQuest(
      validQuest({ secret: "drop-me", objectives: [{ id: "o1", title: "a", weird: true }] }),
      "now"
    );
    assert.equal(res.ok, true);
    assert.equal("secret" in res.quest, false);
    assert.equal("weird" in res.quest.objectives[0], false);
  });
});

describe("severity + bounty", () => {
  test("known severities keep their bounty", () => {
    assert.equal(core.bountyFor("P1"), 300);
    assert.equal(core.bountyFor("P2"), 150);
    assert.equal(core.bountyFor("P3"), 50);
  });

  test("unknown severities clamp to P3", () => {
    for (const bad of ["P0", "p1", "critical", "", null, undefined, 1]) {
      assert.equal(core.normalizeSeverity(bad), "P3");
      assert.equal(core.bountyFor(bad), 50);
    }
  });
});

describe("computeProgress", () => {
  test("empty quest yields zeroes", () => {
    assert.deepEqual(core.computeProgress(null, 0), {
      total: 0,
      done: 0,
      percent: 0,
      score: 0,
      bugPoints: 0
    });
  });

  test("percent math rounds and score sums done points plus bug bounty", () => {
    const quest = {
      objectives: [
        { done: true, points: 100 },
        { done: false, points: 150 },
        { done: false, points: 50 }
      ]
    };
    const p = core.computeProgress(quest, 300);
    assert.equal(p.total, 3);
    assert.equal(p.done, 1);
    assert.equal(p.percent, 33);
    assert.equal(p.bugPoints, 300);
    assert.equal(p.score, 400);
  });

  test("invalid bugPoints are treated as zero", () => {
    const p = core.computeProgress(null, Number.NaN);
    assert.equal(p.bugPoints, 0);
    assert.equal(p.score, 0);
  });
});

describe("console ring buffer", () => {
  test("caps entries at 20, dropping oldest", () => {
    const ring = core.createRing();
    for (let i = 0; i < 25; i++) ring.push(`entry-${i}`);
    const snap = ring.snapshot();
    assert.equal(snap.length, 20);
    assert.equal(snap[0], "entry-5");
    assert.equal(snap[19], "entry-24");
  });

  test("caps each entry at 500 chars and stringifies non-strings", () => {
    const ring = core.createRing();
    ring.push("x".repeat(900));
    ring.push(12345);
    const snap = ring.snapshot();
    assert.equal(snap[0].length, 500);
    assert.equal(snap[1], "12345");
  });

  test("snapshot is a copy, not a live reference", () => {
    const ring = core.createRing();
    ring.push("a");
    const snap = ring.snapshot();
    snap.push("tampered");
    assert.equal(ring.size(), 1);
  });
});

describe("storage helpers", () => {
  test("readJSON returns fallback and removes key on corrupted JSON", () => {
    const storage = makeStorage();
    storage.setItem("k", "{broken");
    assert.deepEqual(core.readJSON(storage, "k", { fresh: true }), { fresh: true });
    assert.equal(storage.getItem("k"), null, "corrupted key self-resets");
  });

  test("readJSON returns fallback for missing keys", () => {
    assert.equal(core.readJSON(makeStorage(), "missing", null), null);
  });
});

describe("session: loadQuest / getQuest / getState", () => {
  test("loadQuest persists and getQuest returns the normalised quest", () => {
    const storage = makeStorage();
    const session = makeSession(storage);
    assert.deepEqual(session.loadQuest(validQuest()), { ok: true });
    const quest = session.getQuest();
    assert.equal(quest.id, "q1");
    assert.equal(quest.objectives[2].who, "agent");
    assert.equal(storage.getItem("qaquest:quest") !== null, true);
  });

  test("rejected loadQuest does not overwrite the existing quest", () => {
    const session = makeSession();
    session.loadQuest(validQuest());
    const res = session.loadQuest({ title: "no id", objectives: [] });
    assert.equal(res.ok, false);
    assert.equal(typeof res.error, "string");
    assert.equal(session.getQuest().id, "q1");
  });

  test("getState matches the contract shape", () => {
    const session = makeSession();
    session.loadQuest(validQuest());
    const state = session.getState();
    assert.equal(state.route, "/checkout?step=2");
    assert.equal(state.version, "0.1.0");
    assert.equal(state.bugCount, 0);
    assert.equal(state.pendingEvents, 0);
    assert.equal(Number.isNaN(Date.parse(state.injectedAt)), false, "injectedAt is a parseable ISO date");
    assert.deepEqual(state.progress, { total: 3, done: 0, percent: 0, score: 0, bugPoints: 0 });
  });

  test("state survives across session instances via storage (reload semantics)", () => {
    const storage = makeStorage();
    const first = makeSession(storage);
    first.loadQuest(validQuest());
    first.reportBug({ severity: "P1", note: "broken checkout" });
    first.completeObjective("o1");

    const second = makeSession(storage);
    const state = second.getState();
    assert.equal(state.bugCount, 1);
    assert.equal(state.progress.done, 1);
    assert.equal(state.pendingEvents, 2, "undrained events survive re-injection");
  });
});

describe("session: reportBug", () => {
  test("increments bugCount, scores bounty, captures console + viewport", () => {
    const storage = makeStorage();
    const session = makeSession(storage);
    const event = session.reportBug({ severity: "P1", note: "cart total is wrong" });

    assert.equal(event.type, "bug");
    assert.equal(event.route, "/checkout?step=2");
    assert.equal(event.payload.severity, "P1");
    assert.equal(event.payload.points, 300);
    assert.equal(event.payload.note, "cart total is wrong");
    assert.deepEqual(event.payload.console, ["[error] boom"]);
    assert.deepEqual(event.payload.viewport, { width: 1280, height: 800, devicePixelRatio: 2 });

    const state = session.getState();
    assert.equal(state.bugCount, 1);
    assert.equal(state.progress.bugPoints, 300);
    assert.equal(state.progress.score, 300);
  });

  test("unknown severity clamps to P3 and scores 50", () => {
    const session = makeSession();
    const event = session.reportBug({ severity: "catastrophic", note: "" });
    assert.equal(event.payload.severity, "P3");
    assert.equal(event.payload.points, 50);
    assert.equal(session.getState().progress.bugPoints, 50);
  });

  test("bug bounties accumulate", () => {
    const session = makeSession();
    session.reportBug({ severity: "P1", note: "a" });
    session.reportBug({ severity: "P2", note: "b" });
    session.reportBug({ severity: "P3", note: "c" });
    const state = session.getState();
    assert.equal(state.bugCount, 3);
    assert.equal(state.progress.bugPoints, 500);
  });
});

describe("session: completeObjective", () => {
  test("first completion succeeds, emits one event, and scores", () => {
    const session = makeSession();
    session.loadQuest(validQuest());
    assert.deepEqual(session.completeObjective("o2"), { ok: true });

    const quest = session.getQuest();
    const o2 = quest.objectives.find((o) => o.id === "o2");
    assert.equal(o2.done, true);
    assert.equal(typeof o2.doneAt, "string");

    const events = session.drainEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "objective_done");
    assert.equal(events[0].payload.objectiveId, "o2");
    assert.equal(events[0].payload.points, 150);
    assert.equal(session.getState().progress.score, 150);
  });

  test("second completion is idempotent: alreadyDone, no event, no re-score", () => {
    const session = makeSession();
    session.loadQuest(validQuest());
    session.completeObjective("o2");
    session.drainEvents();

    assert.deepEqual(session.completeObjective("o2"), { ok: true, alreadyDone: true });
    assert.deepEqual(session.drainEvents(), []);
    assert.equal(session.getState().progress.score, 150);
    assert.equal(session.getState().progress.done, 1);
  });

  test("unknown objective or missing quest returns ok:false", () => {
    const empty = makeSession();
    assert.deepEqual(empty.completeObjective("o1"), { ok: false });

    const session = makeSession();
    session.loadQuest(validQuest());
    assert.deepEqual(session.completeObjective("nope"), { ok: false });
  });
});

describe("session: note / requestHelp / drainEvents", () => {
  test("note and requestHelp push typed events", () => {
    const session = makeSession();
    const n = session.note("odd spacing on the footer");
    const h = session.requestHelp("seed me a paid order");
    assert.equal(n.type, "note");
    assert.equal(n.payload.text, "odd spacing on the footer");
    assert.equal(h.type, "help");
    assert.equal(h.payload.text, "seed me a paid order");
  });

  test("drainEvents returns pending events in order and clears them", () => {
    const session = makeSession();
    session.note("one");
    session.reportBug({ severity: "P3", note: "two" });
    session.note("three");

    const events = session.drainEvents();
    assert.deepEqual(
      events.map((e) => e.type),
      ["note", "bug", "note"]
    );
    for (const e of events) {
      assert.equal(typeof e.id, "string");
      assert.equal(typeof e.ts, "string");
      assert.equal(typeof e.route, "string");
    }
    assert.deepEqual(session.drainEvents(), [], "second drain is empty");
    assert.equal(session.getState().pendingEvents, 0);
  });
});

describe("session: corrupted storage self-reset", () => {
  test("corrupted quest JSON resets to null instead of throwing", () => {
    const storage = makeStorage();
    storage.setItem("qaquest:quest", "{corrupt!!");
    const session = makeSession(storage);
    assert.equal(session.getQuest(), null);
    assert.equal(storage.getItem("qaquest:quest"), null);
  });

  test("quest with an unusable shape also self-resets", () => {
    const storage = makeStorage();
    storage.setItem("qaquest:quest", JSON.stringify({ nope: true }));
    const session = makeSession(storage);
    assert.equal(session.getQuest(), null);
  });

  test("corrupted events JSON drains as empty and recovers", () => {
    const storage = makeStorage();
    storage.setItem("qaquest:events", "[broken");
    const session = makeSession(storage);
    assert.deepEqual(session.drainEvents(), []);
    session.note("works again");
    assert.equal(session.drainEvents().length, 1);
  });

  test("non-array events value resets to empty", () => {
    const storage = makeStorage();
    storage.setItem("qaquest:events", JSON.stringify({ hijacked: true }));
    const session = makeSession(storage);
    assert.deepEqual(session.drainEvents(), []);
  });

  test("corrupted counters reset to zero", () => {
    const storage = makeStorage();
    storage.setItem("qaquest:bugCount", "many");
    storage.setItem("qaquest:bugPoints", JSON.stringify(-10));
    const session = makeSession(storage);
    const state = session.getState();
    assert.equal(state.bugCount, 0);
    assert.equal(state.progress.bugPoints, 0);
  });
});

describe("session: subscribe", () => {
  test("subscribers receive quest, event and ack notifications", () => {
    const session = makeSession();
    const seen = [];
    session.subscribe((kind, detail) => seen.push([kind, detail]));

    session.loadQuest(validQuest());
    session.note("hello");
    session.ack({ message: "on it", status: "dispatched" });

    assert.deepEqual(
      seen.map(([kind]) => kind),
      ["quest", "event", "ack"]
    );
    assert.equal(seen[1][1].type, "note");
    assert.equal(seen[2][1].status, "dispatched");
  });

  test("a throwing subscriber never breaks event capture or siblings", () => {
    const session = makeSession();
    const seen = [];
    session.subscribe(() => {
      throw new Error("bad subscriber");
    });
    session.subscribe((kind) => seen.push(kind));

    const event = session.reportBug({ severity: "P2", note: "still captured" });
    assert.equal(event.type, "bug");
    assert.deepEqual(seen, ["event"]);
    assert.equal(session.getState().bugCount, 1);
    assert.equal(session.drainEvents().length, 1);
  });

  test("unsubscribe stops notifications; non-function subscribe is a safe no-op", () => {
    const session = makeSession();
    const seen = [];
    const unsubscribe = session.subscribe((kind) => seen.push(kind));
    unsubscribe();
    session.note("silent");
    assert.deepEqual(seen, []);

    const noop = session.subscribe("not-a-function");
    assert.equal(typeof noop, "function");
    noop();
  });

  test("destroy clears subscribers", () => {
    const session = makeSession();
    const seen = [];
    session.subscribe((kind) => seen.push(kind));
    session.destroy();
    session.note("after destroy");
    assert.deepEqual(seen, []);
  });
});
