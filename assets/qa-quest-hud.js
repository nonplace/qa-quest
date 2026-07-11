/*!
 * qa-quest-hud v0.5.0
 * QA Quest in-page layer: agent bridge (window.__qaQuest), gamified HUD,
 * console ring buffer, and WebMCP tool registration. One file, plain JS,
 * zero dependencies, no build step. Inject into any page or vendor it
 * behind a dev flag.
 * License: MIT (c) 2026 Janusch Haering
 */
(function () {
  "use strict";

  var VERSION = "0.5.0";

  // -------------------------------------------------------------------------
  // core: pure logic, no DOM. Exposed via module.exports for Node tests and
  // kept inert in browsers (module is undefined there).
  // -------------------------------------------------------------------------

  var KEYS = {
    quest: "qaquest:quest",
    events: "qaquest:events",
    // Append-only durable log. Every event lands here the instant it is
    // created and NOTHING (not drainEvents, not ackEvents) ever removes an
    // entry — only the bounded-cap trim in pushEvent drops the oldest. This
    // is the at-least-once backstop: "reported" == "secured", independent of
    // whether the agent's poll/drain ever succeeds. See docs/ROADMAP.md 1.1.
    // Lives in `durableStorage` (localStorage in the browser layer below),
    // NOT the per-tab `storage` (sessionStorage) that quest/events/counters
    // use — that split is what survives a closed tab, not just a reload.
    // See docs/ROADMAP.md 1.5.
    archive: "qaquest:archive",
    // Monotonic sequence counter. Lives in `durableStorage` alongside the
    // archive so seq numbers stay meaningful (and gap-free relative to the
    // archive) across a closed-tab recovery.
    seq: "qaquest:seq",
    bugCount: "qaquest:bugCount",
    bugPoints: "qaquest:bugPoints",
    // Cosmetic HUD drag position. Deliberately kept in the per-tab `storage`,
    // not the durable archive store: losing a dragged position on tab close
    // is a non-event (the HUD just reverts to its default corner).
    hudPos: "qaquest:hudPos"
  };

  var BOUNTY = { P1: 300, P2: 150, P3: 50 };
  var RING_MAX_ENTRIES = 20;
  var RING_MAX_CHARS = 500;
  var DEFAULT_OBJECTIVE_POINTS = 100;
  // Upper bound on the durable archive so a very long session cannot grow
  // sessionStorage without limit. QA sessions produce tens of events; 2000 is
  // far above any real run, and the oldest entries drop first if ever reached.
  var ARCHIVE_MAX = 2000;

  function isNonEmptyString(v) {
    return typeof v === "string" && v.trim().length > 0;
  }

  function coerceLabel(v) {
    if (isNonEmptyString(v)) return v;
    if (typeof v === "number" && isFinite(v)) return String(v);
    return null;
  }

  function normalizeSeverity(s) {
    return s === "P1" || s === "P2" || s === "P3" ? s : "P3";
  }

  function bountyFor(severity) {
    return BOUNTY[normalizeSeverity(severity)];
  }

  // Lenient quest parser. Accepts an object or a JSON string. Extra fields
  // are dropped; per-objective fields are normalised per the contract.
  // Rejects (ok:false) on: invalid JSON, missing quest id/title, missing or
  // empty objectives array, any objective missing id/title.
  function parseQuest(input, nowIso) {
    var raw = input;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch (e) {
        return { ok: false, error: "Quest is not valid JSON." };
      }
    }
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: "Quest must be an object." };
    }
    var id = coerceLabel(raw.id);
    if (id === null) return { ok: false, error: "Quest is missing an id." };
    var title = coerceLabel(raw.title);
    if (title === null) return { ok: false, error: "Quest is missing a title." };
    if (!Array.isArray(raw.objectives) || raw.objectives.length === 0) {
      return { ok: false, error: "Quest needs at least one objective." };
    }

    var objectives = [];
    for (var i = 0; i < raw.objectives.length; i++) {
      var o = raw.objectives[i];
      var n = i + 1;
      if (o === null || typeof o !== "object" || Array.isArray(o)) {
        return { ok: false, error: "Objective " + n + " must be an object." };
      }
      var oid = coerceLabel(o.id);
      if (oid === null) return { ok: false, error: "Objective " + n + " is missing an id." };
      var otitle = coerceLabel(o.title);
      if (otitle === null) return { ok: false, error: "Objective " + n + " is missing a title." };

      var points =
        typeof o.points === "number" && isFinite(o.points) && o.points > 0
          ? o.points
          : DEFAULT_OBJECTIVE_POINTS;
      var normalized = {
        id: oid,
        title: otitle,
        zone: isNonEmptyString(o.zone) ? o.zone : "general",
        who: o.who === "agent" ? "agent" : "human",
        points: points,
        done: o.done === true
      };
      if (isNonEmptyString(o.expected)) normalized.expected = o.expected;
      if (normalized.done && isNonEmptyString(o.doneAt)) normalized.doneAt = o.doneAt;
      objectives.push(normalized);
    }

    return {
      ok: true,
      quest: {
        id: id,
        title: title,
        createdAt: isNonEmptyString(raw.createdAt) ? raw.createdAt : nowIso,
        objectives: objectives
      }
    };
  }

  // progress = objective completion; score = earned objective points plus
  // bug bounty points (finding bugs scores, by design).
  function computeProgress(quest, bugPoints) {
    var bp = typeof bugPoints === "number" && isFinite(bugPoints) && bugPoints >= 0 ? bugPoints : 0;
    var total = 0;
    var done = 0;
    var objectivePoints = 0;
    if (quest && Array.isArray(quest.objectives)) {
      total = quest.objectives.length;
      for (var i = 0; i < quest.objectives.length; i++) {
        var o = quest.objectives[i];
        if (o && o.done) {
          done++;
          objectivePoints += typeof o.points === "number" && isFinite(o.points) ? o.points : 0;
        }
      }
    }
    var percent = total > 0 ? Math.round((done / total) * 100) : 0;
    return {
      total: total,
      done: done,
      percent: percent,
      score: objectivePoints + bp,
      bugPoints: bp
    };
  }

  function createRing(maxEntries, maxChars) {
    var capEntries = typeof maxEntries === "number" && maxEntries > 0 ? maxEntries : RING_MAX_ENTRIES;
    var capChars = typeof maxChars === "number" && maxChars > 0 ? maxChars : RING_MAX_CHARS;
    var entries = [];
    return {
      push: function (text) {
        var s = typeof text === "string" ? text : String(text);
        if (s.length > capChars) s = s.slice(0, capChars);
        entries.push(s);
        while (entries.length > capEntries) entries.shift();
      },
      snapshot: function () {
        return entries.slice();
      },
      size: function () {
        return entries.length;
      }
    };
  }

  // Corrupted-JSON self-reset: a value that fails to parse removes the key
  // and returns the fallback instead of throwing.
  function readJSON(storage, key, fallback) {
    var raw;
    try {
      raw = storage.getItem(key);
    } catch (e) {
      return fallback;
    }
    if (raw === null || raw === undefined) return fallback;
    try {
      return JSON.parse(raw);
    } catch (e2) {
      try {
        storage.removeItem(key);
      } catch (e3) {
        /* storage unavailable; nothing else to do */
      }
      return fallback;
    }
  }

  function writeJSON(storage, key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* quota or storage unavailable; state degrades to in-page only */
    }
  }

  function defaultMakeId() {
    return "qq-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  // The DOM-free session state machine behind window.__qaQuest. The browser
  // layer wraps it with HUD rendering, toasts, console capture and WebMCP.
  function createSession(opts) {
    opts = opts || {};
    var storage = opts.storage;
    // Where the durable archive/seq live. Defaults to `storage` when the
    // caller doesn't pass one (older callers, and every existing test, keep
    // working unchanged with a single storage backend). The browser layer
    // below passes `window.localStorage` here so the bug archive survives a
    // closed tab, which sessionStorage cannot.
    var durableStorage = opts.durableStorage || storage;
    var now =
      opts.now ||
      function () {
        return new Date().toISOString();
      };
    var getRoute =
      opts.getRoute ||
      function () {
        return "";
      };
    var getViewport =
      opts.getViewport ||
      function () {
        return null;
      };
    var getConsoleSnapshot =
      opts.getConsoleSnapshot ||
      function () {
        return [];
      };
    var makeId = opts.makeId || defaultMakeId;

    var injectedAt = now();
    var subscribers = [];

    // A throwing subscriber never breaks event capture or its siblings.
    function notify(kind, detail) {
      var list = subscribers.slice();
      for (var i = 0; i < list.length; i++) {
        try {
          list[i](kind, detail);
        } catch (e) {
          /* subscriber errors are isolated by contract */
        }
      }
    }

    function readQuest() {
      var stored = readJSON(storage, KEYS.quest, null);
      if (stored === null) return null;
      // Re-normalise on read so a hand-edited or stale-shaped value can
      // never crash consumers; unusable shapes self-reset like corrupt JSON.
      var parsed = parseQuest(stored, now());
      if (!parsed.ok) {
        try {
          storage.removeItem(KEYS.quest);
        } catch (e) {
          /* ignore */
        }
        return null;
      }
      return parsed.quest;
    }

    function saveQuest(quest) {
      writeJSON(storage, KEYS.quest, quest);
    }

    function readEvents() {
      var events = readJSON(storage, KEYS.events, []);
      if (!Array.isArray(events)) {
        try {
          storage.removeItem(KEYS.events);
        } catch (e) {
          /* ignore */
        }
        return [];
      }
      return events;
    }

    function readCount(key, storageRef) {
      var ref = storageRef || storage;
      var v = readJSON(ref, key, 0);
      if (typeof v !== "number" || !isFinite(v) || v < 0) {
        try {
          ref.removeItem(key);
        } catch (e) {
          /* ignore */
        }
        return 0;
      }
      return v;
    }

    function readArchive() {
      var archive = readJSON(durableStorage, KEYS.archive, []);
      if (!Array.isArray(archive)) {
        try {
          durableStorage.removeItem(KEYS.archive);
        } catch (e) {
          /* ignore */
        }
        return [];
      }
      return archive;
    }

    function pushEvent(type, payload) {
      var event = {
        id: makeId(),
        seq: readCount(KEYS.seq, durableStorage) + 1,
        type: type,
        ts: now(),
        route: getRoute(),
        payload: payload || {}
      };
      writeJSON(durableStorage, KEYS.seq, event.seq);
      // Durable archive FIRST: if anything below fails, the event is already
      // secured. The archive is append-only and bounded (oldest trimmed).
      var archive = readArchive();
      archive.push(event);
      if (archive.length > ARCHIVE_MAX) archive = archive.slice(archive.length - ARCHIVE_MAX);
      writeJSON(durableStorage, KEYS.archive, archive);
      // Pending queue: the poll surface the agent drains/acks. Losing this
      // (truncated drain, closed tab) can no longer lose data — the archive holds it.
      var events = readEvents();
      events.push(event);
      writeJSON(storage, KEYS.events, events);
      notify("event", event);
      return event;
    }

    return {
      loadQuest: function (input) {
        var result = parseQuest(input, now());
        if (!result.ok) return { ok: false, error: result.error };
        saveQuest(result.quest);
        notify("quest", result.quest);
        return { ok: true };
      },

      getQuest: readQuest,

      getState: function () {
        var quest = readQuest();
        var archive = readArchive();
        var archivedBugs = 0;
        for (var i = 0; i < archive.length; i++) if (archive[i].type === "bug") archivedBugs++;
        return {
          route: getRoute(),
          quest: quest,
          progress: computeProgress(quest, readCount(KEYS.bugPoints)),
          pendingEvents: readEvents().length,
          // Durability signal: total events secured in the append-only archive,
          // and secured bug count. `securedBugs` must always equal `bugCount`;
          // any divergence is a data-loss bug the HUD surfaces loudly.
          securedEvents: archive.length,
          securedBugs: archivedBugs,
          lastSeq: readCount(KEYS.seq, durableStorage),
          bugCount: readCount(KEYS.bugCount),
          injectedAt: injectedAt,
          version: VERSION
        };
      },

      reportBug: function (report) {
        report = report || {};
        var severity = normalizeSeverity(report.severity);
        var points = BOUNTY[severity];
        writeJSON(storage, KEYS.bugCount, readCount(KEYS.bugCount) + 1);
        writeJSON(storage, KEYS.bugPoints, readCount(KEYS.bugPoints) + points);
        return pushEvent("bug", {
          severity: severity,
          note: typeof report.note === "string" ? report.note : "",
          points: points,
          console: getConsoleSnapshot(),
          viewport: getViewport()
        });
      },

      // Idempotent: a second completion returns alreadyDone and emits no
      // second event and no re-score.
      completeObjective: function (id) {
        var wanted = typeof id === "string" ? id : String(id);
        var quest = readQuest();
        if (!quest) return { ok: false };
        var target = null;
        for (var i = 0; i < quest.objectives.length; i++) {
          if (quest.objectives[i].id === wanted) {
            target = quest.objectives[i];
            break;
          }
        }
        if (!target) return { ok: false };
        if (target.done) return { ok: true, alreadyDone: true };
        target.done = true;
        target.doneAt = now();
        saveQuest(quest);
        pushEvent("objective_done", {
          objectiveId: target.id,
          title: target.title,
          points: target.points
        });
        notify("quest", quest);
        return { ok: true };
      },

      note: function (text) {
        return pushEvent("note", { text: typeof text === "string" ? text : String(text) });
      },

      requestHelp: function (text) {
        return pushEvent("help", { text: typeof text === "string" ? text : String(text) });
      },

      // Destructive read of the pending queue (back-compat). Durability now
      // comes from the archive, so a truncated/dropped drain can no longer
      // lose data — recover with getArchive()/exportSession(). Prefer the
      // peekEvents()+ackEvents() cursor for true at-least-once delivery.
      drainEvents: function () {
        var events = readEvents();
        writeJSON(storage, KEYS.events, []);
        return events;
      },

      // Non-destructive read of the pending queue. Nothing is removed; pair
      // with ackEvents() once the agent has durably persisted them.
      peekEvents: function () {
        return readEvents();
      },

      // Cursor removal: drop only the events whose id is in `ids` from the
      // pending queue. The archive is untouched. This is the at-least-once
      // path — an event is removed from pending ONLY after the agent confirms
      // receipt, so a crash between peek and ack simply re-delivers.
      ackEvents: function (ids) {
        var wanted = {};
        if (Array.isArray(ids)) {
          for (var i = 0; i < ids.length; i++) wanted[String(ids[i])] = true;
        }
        var events = readEvents();
        var remaining = [];
        var removed = 0;
        for (var j = 0; j < events.length; j++) {
          if (events[j] && wanted[String(events[j].id)]) removed++;
          else remaining.push(events[j]);
        }
        writeJSON(storage, KEYS.events, remaining);
        return { ok: true, removed: removed, remaining: remaining.length };
      },

      // The durable, append-only record of every event this session captured.
      // Optional `opts.sinceSeq` returns only events with seq strictly greater,
      // so an agent can page forward without re-scanning. Never mutates state.
      getArchive: function (opts) {
        var archive = readArchive();
        var sinceSeq = opts && typeof opts.sinceSeq === "number" ? opts.sinceSeq : null;
        if (sinceSeq === null) return archive;
        var out = [];
        for (var i = 0; i < archive.length; i++) {
          if (typeof archive[i].seq === "number" && archive[i].seq > sinceSeq) out.push(archive[i]);
        }
        return out;
      },

      // Non-destructive: the durable archive filtered to bug reports only.
      // THIS is the canonical source of truth for "what bugs were found" —
      // drainEvents()/peekEvents() are a live notification channel that can
      // be lost (a truncated inline read, a crash between poll and persist),
      // while getBugs() reads the append-only record instead, so a
      // lost/truncated drain can never lose a bug. Same `sinceSeq` paging
      // contract as getArchive(). Never mutates state.
      getBugs: function (opts) {
        var archive = readArchive();
        var sinceSeq = opts && typeof opts.sinceSeq === "number" ? opts.sinceSeq : null;
        var out = [];
        for (var i = 0; i < archive.length; i++) {
          var e = archive[i];
          if (!e || e.type !== "bug") continue;
          if (sinceSeq !== null && !(typeof e.seq === "number" && e.seq > sinceSeq)) continue;
          out.push(e);
        }
        return out;
      },

      // Explicit reset of the durable archive, for starting a fresh run.
      // Deliberately narrow: the archive interleaves every event type under
      // one monotonic seq, so "clear bugs" clears the whole durable log, not
      // a filtered subset (there is no way to remove just the bug entries
      // without breaking seq-based paging for the rest). Quest state and
      // score counters (bugCount/bugPoints) are untouched on purpose, so
      // clearing the log never silently changes the HUD's visible score.
      clearBugs: function () {
        writeJSON(durableStorage, KEYS.archive, []);
        return { ok: true };
      },

      // A single self-contained dump of the whole session: quest, progress,
      // counters, and the full durable archive. This is the recovery + handoff
      // artifact — save it to disk and no session-end loss is possible.
      exportSession: function () {
        var quest = readQuest();
        return {
          version: VERSION,
          injectedAt: injectedAt,
          exportedAt: now(),
          route: getRoute(),
          quest: quest,
          progress: computeProgress(quest, readCount(KEYS.bugPoints)),
          bugCount: readCount(KEYS.bugCount),
          bugPoints: readCount(KEYS.bugPoints),
          lastSeq: readCount(KEYS.seq),
          archive: readArchive()
        };
      },

      ack: function (a) {
        notify("ack", a || {});
      },

      subscribe: function (fn) {
        if (typeof fn !== "function") {
          return function () {};
        }
        subscribers.push(fn);
        return function () {
          var i = subscribers.indexOf(fn);
          if (i >= 0) subscribers.splice(i, 1);
        };
      },

      destroy: function () {
        subscribers.length = 0;
      }
    };
  }

  var core = {
    VERSION: VERSION,
    KEYS: KEYS,
    BOUNTY: BOUNTY,
    RING_MAX_ENTRIES: RING_MAX_ENTRIES,
    RING_MAX_CHARS: RING_MAX_CHARS,
    DEFAULT_OBJECTIVE_POINTS: DEFAULT_OBJECTIVE_POINTS,
    normalizeSeverity: normalizeSeverity,
    bountyFor: bountyFor,
    parseQuest: parseQuest,
    computeProgress: computeProgress,
    createRing: createRing,
    readJSON: readJSON,
    writeJSON: writeJSON,
    createSession: createSession
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = core;
  }

  // -------------------------------------------------------------------------
  // Browser layer: HUD, toasts, console capture, keyboard, WebMCP.
  // Everything below is a no-op outside a real page.
  // -------------------------------------------------------------------------

  if (typeof window === "undefined" || typeof document === "undefined") return;

  // Idempotent injection: same version refreshes the render; a different
  // version tears the old instance down and rebuilds.
  var existing = window.__qaQuest;
  if (existing) {
    var existingVersion = null;
    try {
      existingVersion = existing.getState().version;
    } catch (e) {
      /* broken instance; rebuild */
    }
    if (
      existingVersion === VERSION &&
      existing.__qq &&
      typeof existing.__qq.render === "function"
    ) {
      try {
        existing.__qq.render();
      } catch (e) {
        /* stale DOM refs; fall through to rebuild */
      }
      return;
    }
    try {
      existing.destroy();
    } catch (e) {
      /* proceed with fresh install regardless */
    }
  }

  // All user-visible copy lives here for easy fork translation.
  var STRINGS = {
    hudTitleFallback: "QA Quest",
    pillLabel: "QA Quest HUD. Click or press Ctrl+Q to expand. Drag to move.",
    collapse: "Collapse",
    noQuest: "No quest loaded yet. The agent will send one shortly.",
    scoreLabel: "Score",
    bugsLabel: "Bugs",
    securedLabel: "Secured",
    objectivesLabel: "Objectives",
    exportTitle: "Export session (JSON)",
    toastExported: "Session exported: {count} events secured",
    toastExportCopied: "Session JSON copied to clipboard",
    reportBugButton: "Report bug (Ctrl+B)",
    popoverTitle: "Report a bug",
    severityLabel: "Severity",
    notePlaceholder: "What happened? What did you expect?",
    submitBug: "Submit",
    cancel: "Cancel",
    toastQuestLoaded: "Quest loaded: {title}",
    toastBugReported: "{severity} bug logged. +{points} pts",
    toastObjectiveDone: "Objective complete! +{points} pts",
    toastQuestComplete: "All objectives complete. Quest cleared!",
    toastNoteSent: "Note sent to the agent",
    toastHelpRequested: "Help requested. The agent is on it.",
    ackFallback: "Update from the agent",
    statusLabels: {
      logged: "logged",
      dispatched: "fix dispatched",
      pr_open: "PR open",
      wontfix: "wontfix"
    }
  };

  function format(template, values) {
    return template.replace(/\{(\w+)\}/g, function (m, key) {
      return values && key in values ? String(values[key]) : m;
    });
  }

  var controller = new AbortController();
  var signal = controller.signal;

  // Console capture wraps error/warn non-destructively; the page's own
  // logging keeps working and destroy() restores the originals.
  var ring = createRing(RING_MAX_ENTRIES, RING_MAX_CHARS);
  var originalConsoleError = console.error;
  var originalConsoleWarn = console.warn;

  function stringifyConsoleArg(arg) {
    if (typeof arg === "string") return arg;
    if (arg instanceof Error) return arg.name + ": " + arg.message;
    try {
      var s = JSON.stringify(arg);
      return s === undefined ? String(arg) : s;
    } catch (e) {
      return String(arg);
    }
  }

  function captureConsole(level, args) {
    try {
      var parts = [];
      for (var i = 0; i < args.length; i++) parts.push(stringifyConsoleArg(args[i]));
      ring.push("[" + level + "] " + parts.join(" "));
    } catch (e) {
      /* capture must never break the page's own logging */
    }
  }

  console.error = function () {
    captureConsole("error", arguments);
    return originalConsoleError.apply(console, arguments);
  };
  console.warn = function () {
    captureConsole("warn", arguments);
    return originalConsoleWarn.apply(console, arguments);
  };

  window.addEventListener(
    "error",
    function (e) {
      var where = e && e.filename ? " (" + e.filename + ":" + e.lineno + ")" : "";
      ring.push("[uncaught] " + ((e && e.message) || "unknown error") + where);
    },
    { signal: signal }
  );
  window.addEventListener(
    "unhandledrejection",
    function (e) {
      ring.push("[unhandledrejection] " + stringifyConsoleArg(e ? e.reason : undefined));
    },
    { signal: signal }
  );

  // Durable storage for the bug/event archive: localStorage survives a
  // closed tab (sessionStorage does not), which is the whole point of the
  // archive — see docs/ROADMAP.md 1.5. Falls back to sessionStorage if
  // localStorage throws on access (some browser privacy modes do), so the
  // HUD keeps working, just without the closed-tab guarantee.
  var durableStorage;
  try {
    durableStorage = window.localStorage;
  } catch (e) {
    durableStorage = window.sessionStorage;
  }

  var session = createSession({
    storage: window.sessionStorage,
    durableStorage: durableStorage,
    getRoute: function () {
      return location.pathname + location.search;
    },
    getViewport: function () {
      return {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1
      };
    },
    getConsoleSnapshot: function () {
      return ring.snapshot();
    }
  });

  var STYLE_ID = "qq-style";
  var Z = 2147483000;
  var styleEl = document.createElement("style");
  styleEl.id = STYLE_ID;
  styleEl.textContent =
    ".qq-root{position:fixed;bottom:16px;right:16px;z-index:" + Z + ";display:flex;flex-direction:column;align-items:flex-end;gap:10px;max-width:min(340px,calc(100vw - 32px));box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.45;color:#e8eaf0;text-align:left;}" +
    ".qq-root *,.qq-root *::before,.qq-root *::after{box-sizing:border-box;}" +
    ".qq-card{background:rgba(17,19,24,0.93);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.09);border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,0.45);}" +
    ".qq-pill{display:inline-flex;align-items:center;gap:8px;padding:9px 16px;border-radius:999px;border:1px solid rgba(255,255,255,0.12);background:rgba(17,19,24,0.93);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#e8eaf0;font:inherit;font-weight:600;letter-spacing:0.2px;cursor:grab;box-shadow:0 8px 24px rgba(0,0,0,0.4);white-space:nowrap;touch-action:none;}" +
    ".qq-pill:hover{border-color:rgba(245,166,35,0.65);}" +
    ".qq-pill:active{cursor:grabbing;}" +
    ".qq-head{cursor:move;touch-action:none;}" +
    ".qq-head .qq-x{cursor:pointer;touch-action:auto;}" +
    ".qq-root.qq-dragging{opacity:0.92;}" +
    ".qq-dragging,.qq-dragging *{cursor:grabbing !important;}" +
    ".qq-panel{width:320px;max-width:100%;padding:14px 14px 12px;display:flex;flex-direction:column;gap:10px;}" +
    ".qq-head{display:flex;align-items:center;justify-content:space-between;gap:8px;}" +
    ".qq-title{font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}" +
    ".qq-x{flex:0 0 auto;background:none;border:none;color:#9aa1af;cursor:pointer;font:inherit;font-size:15px;line-height:1;padding:3px 7px;border-radius:6px;}" +
    ".qq-x:hover{color:#fff;background:rgba(255,255,255,0.08);}" +
    ".qq-progress{height:6px;border-radius:999px;background:rgba(255,255,255,0.1);overflow:hidden;}" +
    ".qq-bar{height:100%;width:0;background:linear-gradient(90deg,#f5a623,#fbc02d);border-radius:999px;transition:width 0.35s ease;}" +
    ".qq-stats{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#9aa1af;font-size:12px;}" +
    ".qq-stats b{color:#f5a623;font-weight:700;}" +
    ".qq-stats .qq-loss{color:#f87171;font-weight:700;}" +
    ".qq-stats .qq-loss b{color:#f87171;}" +
    ".qq-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px;max-height:260px;overflow-y:auto;overflow-x:hidden;}" +
    ".qq-empty{color:#8b93a3;padding:6px 2px;}" +
    ".qq-row{display:flex;align-items:flex-start;gap:8px;width:100%;padding:5px 8px;border-radius:8px;background:none;border:none;color:inherit;font:inherit;text-align:left;}" +
    "button.qq-row{cursor:pointer;}" +
    "button.qq-row:hover{background:rgba(255,255,255,0.07);}" +
    ".qq-marker{flex:0 0 18px;text-align:center;}" +
    ".qq-item-title{min-width:0;overflow-wrap:anywhere;}" +
    ".qq-zone{flex:0 0 auto;margin-left:auto;font-size:10px;color:#8b93a3;border:1px solid rgba(255,255,255,0.12);border-radius:999px;padding:0 6px;line-height:1.6;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}" +
    ".qq-done .qq-item-title{text-decoration:line-through;color:#7b8494;}" +
    ".qq-done .qq-marker{color:#4ade80;}" +
    ".qq-next{background:rgba(245,166,35,0.12);}" +
    ".qq-next .qq-marker{color:#f5a623;}" +
    ".qq-agent-obj{opacity:0.75;}" +
    ".qq-report{background:#f5a623;color:#1a1305;border:none;border-radius:10px;padding:9px 12px;font:inherit;font-weight:700;cursor:pointer;}" +
    ".qq-report:hover{filter:brightness(1.08);}" +
    ".qq-pop{width:300px;max-width:100%;padding:12px;display:flex;flex-direction:column;gap:10px;}" +
    ".qq-pop-title{font-weight:700;font-size:13px;}" +
    ".qq-chips{display:flex;gap:6px;}" +
    ".qq-chip{flex:1;padding:6px 0;border-radius:8px;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.04);color:#cfd4de;font:inherit;font-weight:700;cursor:pointer;}" +
    ".qq-chip-on{border-color:#f5a623;background:rgba(245,166,35,0.18);color:#f5a623;}" +
    ".qq-note{min-height:64px;max-height:160px;resize:vertical;border-radius:8px;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.05);color:#e8eaf0;padding:8px;font:inherit;width:100%;}" +
    ".qq-note:focus{outline:2px solid rgba(245,166,35,0.55);outline-offset:0;}" +
    ".qq-pop-actions{display:flex;gap:8px;justify-content:flex-end;}" +
    ".qq-btn-secondary{background:none;border:1px solid rgba(255,255,255,0.14);color:#cfd4de;border-radius:8px;padding:6px 10px;font:inherit;cursor:pointer;}" +
    ".qq-btn-secondary:hover{background:rgba(255,255,255,0.07);}" +
    ".qq-toasts{display:flex;flex-direction:column;align-items:flex-end;gap:6px;}" +
    ".qq-toast{padding:8px 12px;border-radius:10px;max-width:300px;background:rgba(17,19,24,0.95);border:1px solid rgba(255,255,255,0.09);border-left:3px solid #f5a623;box-shadow:0 10px 28px rgba(0,0,0,0.45);overflow-wrap:anywhere;animation:qq-toast-in 0.25s ease;}" +
    ".qq-toast-dispatched{border-left-color:#38bdf8;}" +
    ".qq-toast-pr_open{border-left-color:#4ade80;}" +
    ".qq-toast-wontfix{border-left-color:#f87171;}" +
    ".qq-toast-out{opacity:0;transform:translateY(4px);transition:opacity 0.3s ease,transform 0.3s ease;}" +
    "@keyframes qq-toast-in{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}" +
    ".qq-hidden{display:none !important;}";
  document.head.appendChild(styleEl);

  // All DOM is createElement + textContent; quest titles and notes are
  // untrusted and must never reach innerHTML.

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(className, text) {
    var b = el("button", className, text);
    b.type = "button";
    return b;
  }

  var root = el("div", "qq-root");
  var toastStack = el("div", "qq-toasts");

  var panel = el("div", "qq-card qq-panel qq-hidden");
  var head = el("div", "qq-head");
  head.title = "Drag to move";
  var titleEl = el("span", "qq-title", STRINGS.hudTitleFallback);
  var exportBtn = button("qq-x", "⤓");
  exportBtn.setAttribute("aria-label", STRINGS.exportTitle);
  exportBtn.title = STRINGS.exportTitle;
  var closeBtn = button("qq-x", "▾");
  closeBtn.setAttribute("aria-label", STRINGS.collapse);
  head.appendChild(titleEl);
  head.appendChild(exportBtn);
  head.appendChild(closeBtn);
  var progressTrack = el("div", "qq-progress");
  var progressBar = el("div", "qq-bar");
  progressTrack.appendChild(progressBar);
  var stats = el("div", "qq-stats");
  var scoreEl = el("span");
  var objectivesEl = el("span");
  var bugsEl = el("span");
  var securedEl = el("span");
  stats.appendChild(scoreEl);
  stats.appendChild(objectivesEl);
  stats.appendChild(bugsEl);
  stats.appendChild(securedEl);
  var list = el("ul", "qq-list");
  var reportBtn = button("qq-report", STRINGS.reportBugButton);
  panel.appendChild(head);
  panel.appendChild(progressTrack);
  panel.appendChild(stats);
  panel.appendChild(list);
  panel.appendChild(reportBtn);

  var popover = el("div", "qq-card qq-pop qq-hidden");
  var popTitle = el("div", "qq-pop-title", STRINGS.popoverTitle);
  var chips = el("div", "qq-chips");
  chips.setAttribute("role", "group");
  chips.setAttribute("aria-label", STRINGS.severityLabel);
  var selectedSeverity = "P2";
  var chipButtons = {};
  ["P1", "P2", "P3"].forEach(function (sev) {
    var chip = button("qq-chip", sev);
    chip.addEventListener(
      "click",
      function () {
        selectSeverity(sev);
      },
      { signal: signal }
    );
    chipButtons[sev] = chip;
    chips.appendChild(chip);
  });
  var noteArea = el("textarea", "qq-note");
  noteArea.placeholder = STRINGS.notePlaceholder;
  noteArea.rows = 3;
  var popActions = el("div", "qq-pop-actions");
  var cancelBtn = button("qq-btn-secondary", STRINGS.cancel);
  var submitBtn = button("qq-report", STRINGS.submitBug);
  popActions.appendChild(cancelBtn);
  popActions.appendChild(submitBtn);
  popover.appendChild(popTitle);
  popover.appendChild(chips);
  popover.appendChild(noteArea);
  popover.appendChild(popActions);

  var pill = button("qq-pill", "");
  pill.setAttribute("aria-label", STRINGS.pillLabel);
  pill.title = STRINGS.pillLabel;

  root.appendChild(toastStack);
  root.appendChild(panel);
  root.appendChild(popover);
  root.appendChild(pill);
  document.body.appendChild(root);

  function selectSeverity(sev) {
    selectedSeverity = normalizeSeverity(sev);
    ["P1", "P2", "P3"].forEach(function (s) {
      chipButtons[s].classList.toggle("qq-chip-on", s === selectedSeverity);
    });
  }

  function toast(message, status) {
    var t = el("div", "qq-toast", message);
    if (status && /^[a-z_]+$/.test(status)) t.classList.add("qq-toast-" + status);
    toastStack.appendChild(t);
    while (toastStack.children.length > 4) toastStack.removeChild(toastStack.firstChild);
    setTimeout(function () {
      t.classList.add("qq-toast-out");
      setTimeout(function () {
        if (t.parentNode) t.parentNode.removeChild(t);
      }, 320);
    }, 6000);
  }

  function render() {
    var state = session.getState();
    var p = state.progress;

    pill.textContent = "🎮 " + p.percent + "% · 🐛 " + state.bugCount;
    titleEl.textContent = state.quest ? state.quest.title : STRINGS.hudTitleFallback;
    progressBar.style.width = p.percent + "%";

    scoreEl.textContent = "";
    scoreEl.appendChild(document.createTextNode(STRINGS.scoreLabel + " "));
    scoreEl.appendChild(el("b", null, String(p.score)));
    objectivesEl.textContent = STRINGS.objectivesLabel + " " + p.done + "/" + p.total;
    bugsEl.textContent = STRINGS.bugsLabel + " " + state.bugCount;

    // Durability signal. securedBugs must equal bugCount; if they ever diverge
    // (the run-1055 silent data-loss class), say so loudly instead of hiding it.
    var secured = typeof state.securedBugs === "number" ? state.securedBugs : 0;
    var lost = state.bugCount - secured;
    securedEl.textContent = "";
    securedEl.classList.toggle("qq-loss", lost > 0);
    securedEl.appendChild(document.createTextNode((lost > 0 ? "⚠ " : "🛡 ") + STRINGS.securedLabel + " "));
    securedEl.appendChild(el("b", null, lost > 0 ? secured + "/" + state.bugCount : String(secured)));

    list.textContent = "";
    if (!state.quest) {
      list.appendChild(el("li", "qq-empty", STRINGS.noQuest));
      return;
    }

    var nextHumanId = null;
    for (var i = 0; i < state.quest.objectives.length; i++) {
      var candidate = state.quest.objectives[i];
      if (!candidate.done && candidate.who === "human") {
        nextHumanId = candidate.id;
        break;
      }
    }

    state.quest.objectives.forEach(function (o) {
      var li = el("li");
      // Open human objectives are clickable so the operator can check them
      // off without leaving the page; everything else is a static row.
      var clickable = !o.done && o.who === "human";
      var row = clickable ? button("qq-row") : el("div", "qq-row");
      var marker = el("span", "qq-marker");
      var label = el("span", "qq-item-title", o.title);
      var zone = el("span", "qq-zone", o.zone);
      zone.title = o.zone;

      if (o.done) {
        row.classList.add("qq-done");
        marker.textContent = "✓";
      } else if (o.who === "agent") {
        row.classList.add("qq-agent-obj");
        marker.textContent = "🤖";
      } else if (o.id === nextHumanId) {
        row.classList.add("qq-next");
        marker.textContent = "▶";
      } else {
        marker.textContent = "·";
      }
      if (o.expected) row.title = o.expected;
      if (clickable) {
        row.addEventListener(
          "click",
          function () {
            bridge.completeObjective(o.id);
          },
          { signal: signal }
        );
      }

      row.appendChild(marker);
      row.appendChild(label);
      row.appendChild(zone);
      li.appendChild(row);
      list.appendChild(li);
    });
  }

  // ---------------------------------------------------------------------
  // Drag-to-reposition. The HUD is fixed bottom-right by default, which can
  // pin it directly over the surface under test on narrow/mobile-simulated
  // viewports. Pointer events unify mouse and touch; a short-move threshold
  // distinguishes a drag from a click so the pill's expand/collapse toggle
  // and the panel head's own buttons (export, collapse) keep working.
  // ---------------------------------------------------------------------
  var DRAG_THRESHOLD = 6;
  var dragState = null;
  var suppressNextClick = false;

  function clampToViewport(left, top) {
    var rect = root.getBoundingClientRect();
    var maxLeft = Math.max(4, window.innerWidth - rect.width - 4);
    var maxTop = Math.max(4, window.innerHeight - rect.height - 4);
    return {
      left: Math.min(Math.max(4, left), maxLeft),
      top: Math.min(Math.max(4, top), maxTop)
    };
  }

  function applyRootPosition(left, top) {
    var pos = clampToViewport(left, top);
    root.style.left = pos.left + "px";
    root.style.top = pos.top + "px";
    root.style.right = "auto";
    root.style.bottom = "auto";
    return pos;
  }

  function onDragPointerDown(e) {
    // Only the primary button/touch point starts a drag; right-click and
    // secondary touches are ignored. A pointerdown that lands on one of the
    // head's own buttons (export/collapse) never starts a drag, so those
    // keep their normal click behaviour.
    if (typeof e.button === "number" && e.button !== 0) return;
    if (e.target && typeof e.target.closest === "function" && e.target.closest("button.qq-x")) return;
    var rect = root.getBoundingClientRect();
    dragState = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      moved: false
    };
    root.classList.add("qq-dragging");
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (err) {
      /* pointer capture is best-effort; document listeners still track the drag */
    }
  }

  function onDragPointerMove(e) {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    var dx = e.clientX - dragState.startX;
    var dy = e.clientY - dragState.startY;
    if (!dragState.moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
    dragState.moved = true;
    applyRootPosition(dragState.startLeft + dx, dragState.startTop + dy);
  }

  function onDragPointerUp(e) {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    root.classList.remove("qq-dragging");
    if (dragState.moved) {
      // A drag just ended: suppress the click the browser fires right after
      // pointerup, so dragging the pill never also toggles the panel.
      suppressNextClick = true;
      writeJSON(window.sessionStorage, KEYS.hudPos, {
        left: parseFloat(root.style.left) || 0,
        top: parseFloat(root.style.top) || 0
      });
    }
    dragState = null;
  }

  [pill, head].forEach(function (handle) {
    handle.addEventListener("pointerdown", onDragPointerDown, { signal: signal });
  });
  document.addEventListener("pointermove", onDragPointerMove, { signal: signal });
  document.addEventListener("pointerup", onDragPointerUp, { signal: signal });
  document.addEventListener("pointercancel", onDragPointerUp, { signal: signal });
  window.addEventListener(
    "resize",
    function () {
      if (root.style.left && root.style.top) {
        applyRootPosition(parseFloat(root.style.left), parseFloat(root.style.top));
      }
    },
    { signal: signal }
  );

  // Restore a dragged position from earlier in this tab (position is
  // cosmetic UI state; kept in sessionStorage, never the durable archive).
  (function restoreSavedPosition() {
    var saved = readJSON(window.sessionStorage, KEYS.hudPos, null);
    if (saved && typeof saved.left === "number" && typeof saved.top === "number") {
      applyRootPosition(saved.left, saved.top);
    }
  })();

  var expanded = false;

  function setExpanded(next) {
    expanded = !!next;
    panel.classList.toggle("qq-hidden", !expanded);
    if (!expanded) closePopover();
    if (expanded) render();
  }

  function openPopover() {
    selectSeverity("P2");
    noteArea.value = "";
    popover.classList.remove("qq-hidden");
    noteArea.focus();
  }

  function closePopover() {
    popover.classList.add("qq-hidden");
  }

  function submitBugFromPopover() {
    bridge.reportBug({ severity: selectedSeverity, note: noteArea.value.trim() });
    closePopover();
  }

  // Download the whole session (quest + durable archive) as a JSON file so a
  // QA pro / dev has a portable artifact independent of any agent. Falls back
  // to clipboard when a programmatic download is blocked.
  function exportSessionToFile() {
    var dump = session.exportSession();
    var json = JSON.stringify(dump, null, 2);
    var name =
      "qa-quest-" + ((dump.quest && dump.quest.id) || "session") + "-" + Date.now() + ".json";
    var count = Array.isArray(dump.archive) ? dump.archive.length : 0;
    try {
      var blob = new Blob([json], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = el("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 0);
      toast(format(STRINGS.toastExported, { count: count }));
    } catch (e) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(json);
          toast(STRINGS.toastExportCopied);
        }
      } catch (e2) {
        /* nothing more we can do; the agent can still call exportSession() */
      }
    }
  }

  pill.addEventListener(
    "click",
    function () {
      if (suppressNextClick) {
        suppressNextClick = false;
        return;
      }
      setExpanded(!expanded);
    },
    { signal: signal }
  );
  closeBtn.addEventListener(
    "click",
    function () {
      setExpanded(false);
    },
    { signal: signal }
  );
  exportBtn.addEventListener("click", exportSessionToFile, { signal: signal });
  reportBtn.addEventListener("click", openPopover, { signal: signal });
  cancelBtn.addEventListener("click", closePopover, { signal: signal });
  submitBtn.addEventListener("click", submitBugFromPopover, { signal: signal });
  noteArea.addEventListener(
    "keydown",
    function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submitBugFromPopover();
      } else if (e.key === "Escape") {
        closePopover();
      }
    },
    { signal: signal }
  );

  document.addEventListener(
    "keydown",
    function (e) {
      if (!e.ctrlKey || e.metaKey || e.altKey) return;
      var key = (e.key || "").toLowerCase();
      if (key === "q") {
        e.preventDefault();
        setExpanded(!expanded);
      } else if (key === "b") {
        e.preventDefault();
        if (!expanded) setExpanded(true);
        openPopover();
      }
    },
    { signal: signal }
  );

  function objectivePointsById(id) {
    var quest = session.getQuest();
    if (!quest) return null;
    for (var i = 0; i < quest.objectives.length; i++) {
      if (quest.objectives[i].id === id) return quest.objectives[i].points;
    }
    return null;
  }

  var bridge = {
    loadQuest: function (input) {
      var result = session.loadQuest(input);
      if (result.ok) {
        render();
        var quest = session.getQuest();
        toast(format(STRINGS.toastQuestLoaded, { title: quest ? quest.title : "" }));
      }
      return result;
    },
    getQuest: function () {
      return session.getQuest();
    },
    getState: function () {
      return session.getState();
    },
    reportBug: function (r) {
      var event = session.reportBug(r);
      render();
      toast(
        format(STRINGS.toastBugReported, {
          severity: event.payload.severity,
          points: event.payload.points
        })
      );
      return event;
    },
    completeObjective: function (id) {
      var result = session.completeObjective(id);
      if (result.ok && !result.alreadyDone) {
        render();
        var points = objectivePointsById(typeof id === "string" ? id : String(id));
        toast(format(STRINGS.toastObjectiveDone, { points: points === null ? 0 : points }));
        var progress = session.getState().progress;
        if (progress.total > 0 && progress.done === progress.total) {
          toast(STRINGS.toastQuestComplete);
        }
      }
      return result;
    },
    note: function (text) {
      var event = session.note(text);
      toast(STRINGS.toastNoteSent);
      return event;
    },
    requestHelp: function (text) {
      var event = session.requestHelp(text);
      toast(STRINGS.toastHelpRequested);
      return event;
    },
    drainEvents: function () {
      return session.drainEvents();
    },
    peekEvents: function () {
      return session.peekEvents();
    },
    ackEvents: function (ids) {
      return session.ackEvents(ids);
    },
    getArchive: function (opts) {
      return session.getArchive(opts);
    },
    getBugs: function (opts) {
      return session.getBugs(opts);
    },
    clearBugs: function () {
      var result = session.clearBugs();
      render();
      return result;
    },
    exportSession: function () {
      return session.exportSession();
    },
    ack: function (a) {
      a = a || {};
      session.ack(a);
      var message = typeof a.message === "string" && a.message ? a.message : STRINGS.ackFallback;
      var statusLabel = a.status && STRINGS.statusLabels[a.status];
      toast(statusLabel ? message + " [" + statusLabel + "]" : message, a.status);
    },
    subscribe: function (fn) {
      return session.subscribe(fn);
    },
    destroy: function () {
      controller.abort();
      console.error = originalConsoleError;
      console.warn = originalConsoleWarn;
      session.destroy();
      if (root.parentNode) root.parentNode.removeChild(root);
      if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
      if (window.__qaQuest === bridge) {
        try {
          delete window.__qaQuest;
        } catch (e) {
          window.__qaQuest = undefined;
        }
      }
    }
  };

  // Internal handle for idempotent re-injection; non-enumerable so the
  // contract surface stays exactly the documented methods.
  try {
    Object.defineProperty(bridge, "__qq", {
      value: { render: render, version: VERSION },
      enumerable: false
    });
  } catch (e) {
    /* defineProperty unavailable is fine; re-injection falls back to rebuild */
  }

  window.__qaQuest = bridge;

  // WebMCP registration: feature-detected, silent no-op when the API is absent.
  (function registerWebMcp() {
    var mc = null;
    try {
      mc =
        (typeof document !== "undefined" ? document.modelContext : null) ??
        (typeof navigator !== "undefined" ? navigator.modelContext : null);
    } catch (e) {
      return;
    }
    if (!mc || typeof mc.registerTool !== "function") return;

    var tools = [
      {
        name: "qa_get_state",
        description:
          "Get the current QA Quest state: route, quest, progress, pending event count, bug count.",
        inputSchema: { type: "object", properties: {} },
        handler: function () {
          return bridge.getState();
        }
      },
      {
        name: "qa_load_quest",
        description: "Load a QA quest into the HUD. Accepts a quest object or JSON string.",
        inputSchema: {
          type: "object",
          properties: {
            quest: { description: "Quest object or JSON string per the QA Quest contract." }
          },
          required: ["quest"]
        },
        handler: function (args) {
          return bridge.loadQuest(args ? args.quest : undefined);
        }
      },
      {
        name: "qa_drain_events",
        description:
          "Destructive: return all pending QA events (bugs, notes, completions, help) and clear the pending queue. Data is NOT lost if this is dropped/truncated — every event is also in the durable archive (qa_get_archive, or qa_get_bugs for bug reports only). For guaranteed delivery prefer qa_peek_events + qa_ack_events.",
        inputSchema: { type: "object", properties: {} },
        handler: function () {
          return bridge.drainEvents();
        }
      },
      {
        name: "qa_peek_events",
        description:
          "Non-destructive: return pending QA events without clearing them. Pair with qa_ack_events once you have durably persisted them (at-least-once delivery).",
        inputSchema: { type: "object", properties: {} },
        handler: function () {
          return bridge.peekEvents();
        }
      },
      {
        name: "qa_ack_events",
        description:
          "Cursor removal: drop only the events whose id is in eventIds from the pending queue. The durable archive is untouched. Call this AFTER persisting the events returned by qa_peek_events.",
        inputSchema: {
          type: "object",
          properties: {
            eventIds: { type: "array", items: { type: "string" } }
          },
          required: ["eventIds"]
        },
        handler: function (args) {
          return bridge.ackEvents(args ? args.eventIds : []);
        }
      },
      {
        name: "qa_get_archive",
        description:
          "Return the durable, append-only record of every event this session captured (nothing is ever removed). Optional sinceSeq returns only events with a higher sequence number, for paging forward. Use this to recover from a truncated drain or a lost poll.",
        inputSchema: {
          type: "object",
          properties: {
            sinceSeq: { type: "number", description: "Return only events with seq greater than this." }
          }
        },
        handler: function (args) {
          return bridge.getArchive(args && typeof args.sinceSeq === "number" ? { sinceSeq: args.sinceSeq } : undefined);
        }
      },
      {
        name: "qa_get_bugs",
        description:
          "Non-destructive: return the durable, append-only record filtered to bug reports only (nothing is ever removed by this call). This is the canonical source of truth for bugs found this session — prefer it over qa_drain_events/qa_peek_events when you just need the bug list, since a lost or truncated drain can never lose a bug here. Optional sinceSeq pages forward.",
        inputSchema: {
          type: "object",
          properties: {
            sinceSeq: { type: "number", description: "Return only bugs with seq greater than this." }
          }
        },
        handler: function (args) {
          return bridge.getBugs(args && typeof args.sinceSeq === "number" ? { sinceSeq: args.sinceSeq } : undefined);
        }
      },
      {
        name: "qa_clear_bugs",
        description:
          "Explicitly clear the durable event/bug archive to start a fresh run. Does NOT touch quest state or score counters (bugCount/bugPoints), so the HUD's visible score is unaffected.",
        inputSchema: { type: "object", properties: {} },
        handler: function () {
          return bridge.clearBugs();
        }
      },
      {
        name: "qa_export_session",
        description:
          "Return a single self-contained dump of the whole session (quest, progress, counters, and the full durable archive). Save this to disk as the recovery + handoff artifact; with it, no session-end data loss is possible.",
        inputSchema: { type: "object", properties: {} },
        handler: function () {
          return bridge.exportSession();
        }
      },
      {
        name: "qa_note",
        description: "Record a free-form note event from the operator or agent into the session stream.",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"]
        },
        handler: function (args) {
          return bridge.note(args ? args.text : "");
        }
      },
      {
        name: "qa_request_help",
        description: "Emit a help event: the operator is stuck or needs the agent to set up state.",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"]
        },
        handler: function (args) {
          return bridge.requestHelp(args ? args.text : "");
        }
      },
      {
        name: "qa_complete_objective",
        description: "Mark a quest objective as done by id. Idempotent.",
        inputSchema: {
          type: "object",
          properties: { objectiveId: { type: "string" } },
          required: ["objectiveId"]
        },
        handler: function (args) {
          return bridge.completeObjective(args ? args.objectiveId : undefined);
        }
      },
      {
        name: "qa_report_bug",
        description: "Report a bug with severity P1, P2 or P3 and a note. Scores bounty points.",
        inputSchema: {
          type: "object",
          properties: {
            severity: { type: "string", enum: ["P1", "P2", "P3"] },
            note: { type: "string" }
          },
          required: ["severity", "note"]
        },
        handler: function (args) {
          args = args || {};
          return bridge.reportBug({ severity: args.severity, note: args.note });
        }
      },
      {
        name: "qa_ack",
        description: "Show an acknowledgement toast to the operator in the HUD.",
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string" },
            bugEventId: { type: "string" },
            status: { type: "string", enum: ["logged", "dispatched", "pr_open", "wontfix"] }
          },
          required: ["message"]
        },
        handler: function (args) {
          bridge.ack(args || {});
          return { ok: true };
        }
      }
    ];

    tools.forEach(function (tool) {
      // registerTool may throw synchronously or return a rejecting promise;
      // guard both so a partial WebMCP implementation can never break the HUD.
      try {
        var registration = mc.registerTool({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          execute: function (args) {
            var result;
            try {
              result = tool.handler(args);
            } catch (e) {
              result = { ok: false, error: String((e && e.message) || e) };
            }
            return JSON.stringify(result === undefined ? null : result);
          }
        });
        Promise.resolve(registration).catch(function () {});
      } catch (e) {
        /* tool registration failure is non-fatal by design */
      }
    });

    signal.addEventListener("abort", function () {
      tools.forEach(function (tool) {
        try {
          if (typeof mc.unregisterTool === "function") {
            Promise.resolve(mc.unregisterTool(tool.name)).catch(function () {});
          }
        } catch (e) {
          /* ignore */
        }
      });
    });
  })();

  render();
})();
