/**
 * Pure-engine checks: formatting, streaks, analytics, 👍/👎 recommendations,
 * sample-data generation and room simulation. No DOM involved.
 *
 *   node tests/engine.test.mjs            (uses the bundle built by run.mjs)
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const libDir = process.env.REGAIN_LIB_DIR;
if (!libDir) {
  console.error("REGAIN_LIB_DIR is not set — run this suite through `npm test`.");
  process.exit(1);
}

const {
  computeStreak,
  dailyBuckets,
  fmtClock,
  fmtShort,
  lastNDays,
  subjectBreakdown,
  distractionFreePercent,
  trend,
  todayKey,
  isDistractingCategory,
  driftThresholdSec,
  driftNudgeText,
} = require(`${libDir}/utils.js`);
const { recommendSession } = require(`${libDir}/recommend.js`);

const DISTRACTING = {
  social: isDistractingCategory("social"),
  video: isDistractingCategory("video"),
  games: isDistractingCategory("games"),
  news: isDistractingCategory("news"),
  study: isDistractingCategory("study"),
  other: isDistractingCategory("other"),
  undefined: isDistractingCategory(undefined),
  null: isDistractingCategory(null),
};
const { seedDemoHistory } = require(`${libDir}/demo.js`);
const { makeRoomCode, makeBuddies, tickBuddies } = require(`${libDir}/rooms.js`);
const { migrateState, pruneState } = require(`${libDir}/persist.js`);
const { DEFAULT_SETTINGS, STATE_VERSION, initialState } = require(`${libDir}/defaults.js`);

let passed = 0;
let failed = 0;
const check = (label, ok, extra = "") => {
  if (ok) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}${extra ? ` — ${extra}` : ""}`);
  }
};

/* ------------------------------- formatting ------------------------------ */
check("fmtClock renders mm:ss", fmtClock(125) === "02:05", fmtClock(125));
check("fmtClock renders h:mm:ss past an hour", fmtClock(3725) === "01:02:05", fmtClock(3725));
check("fmtShort renders hours and minutes", fmtShort(5400) === "1h 30m", fmtShort(5400));
check("fmtShort renders minutes only", fmtShort(2700) === "45m", fmtShort(2700));

/* --------------------------------- dates -------------------------------- */
const days = lastNDays(7);
check("lastNDays returns 7 ordered keys", days.length === 7 && days[6] === todayKey(), days.join(","));

/* ------------------------------- sessions ------------------------------- */
const mk = (dayOffset, actualSec, extra = {}) => {
  const ended = new Date();
  ended.setDate(ended.getDate() - dayOffset);
  ended.setHours(20, 0, 0, 0);
  return {
    id: `s-${dayOffset}-${Math.random()}`,
    mode: "countdown",
    label: "Focus",
    subject: extra.subject ?? "Maths",
    startedAt: ended.getTime() - actualSec * 1000,
    endedAt: ended.getTime(),
    plannedSec: actualSec,
    actualSec,
    completed: extra.completed ?? true,
    strict: false,
    distractions: extra.distractions ?? 0,
    blocked: extra.blocked ?? 0,
    rating: extra.rating ?? null,
    roomId: null,
  };
};

const sessions = [
  mk(0, 1800),
  mk(0, 1800),
  mk(1, 3600),
  mk(2, 2700, { distractions: 2, rating: "dislike" }),
  mk(4, 5400, { rating: "like", subject: "Physics" }),
];
const buckets = dailyBuckets(sessions, 7);
check("dailyBuckets keeps 7 days", buckets.length === 7);
check(
  "dailyBuckets sums today's focus",
  buckets[6].focusedSec === 3600 && buckets[6].sessions === 2,
  JSON.stringify(buckets[6]),
);

check(
  "streak counts consecutive days (today, -1, -2)",
  computeStreak(sessions, { current: 0, best: 0, lastDay: null, xp: 0 }).current === 3,
  String(computeStreak(sessions, { current: 0, best: 0, lastDay: null, xp: 0 }).current),
);
check(
  "a missed day breaks the streak",
  computeStreak([mk(3, 1800), mk(4, 1800)], { current: 0, best: 0, lastDay: null, xp: 0 }).current === 0,
  String(computeStreak([mk(3, 1800), mk(4, 1800)], { current: 0, best: 0, lastDay: null, xp: 0 }).current),
);
check(
  "yesterday still counts before today's first session",
  computeStreak([mk(1, 1800), mk(2, 1800)], { current: 0, best: 0, lastDay: null, xp: 0 }).current === 2,
  String(computeStreak([mk(1, 1800), mk(2, 1800)], { current: 0, best: 0, lastDay: null, xp: 0 }).current),
);
const streak = computeStreak(sessions, { current: 0, best: 0, lastDay: null, xp: 0 });
check("XP = one per focused minute", streak.xp === Math.floor((1800 + 1800 + 3600 + 2700 + 5400) / 60), String(streak.xp));
check("best streak is remembered", streak.best >= 2);

const subjects = subjectBreakdown(sessions);
check("subjectBreakdown groups by subject", subjects[0].subject === "Maths" && subjects.length === 2, JSON.stringify(subjects));
check("distractionFreePercent reflects clean sessions", distractionFreePercent(sessions) === 80, String(distractionFreePercent(sessions)));
check("trend returns a number", Number.isFinite(trend(sessions, 7)));

/* ----------------------------- recommendations -------------------------- */
const rated = [
  mk(0, 1500, { rating: "dislike", subject: "Chemistry" }),
  mk(1, 1500, { rating: "dislike", subject: "Chemistry" }),
  mk(2, 1500, { rating: "dislike", subject: "Chemistry" }),
  mk(3, 3600, { rating: "like", subject: "Physics" }),
  mk(4, 3600, { rating: "like", subject: "Physics" }),
  mk(5, 3600, { rating: "like", subject: "Physics" }),
];
const rec = recommendSession(rated);
check("recommendation is produced once there is enough signal", Boolean(rec));
check("recommendation avoids the disliked short blocks", rec.minutes >= 45, JSON.stringify(rec));
check("recommendation reuses the liked subject", rec.subject === "Physics", rec.subject);
check("recommendation never suggests a nonexistent mode", ["study", "pomodoro", "stopwatch", "countdown"].includes(rec.mode), rec.mode);
check("no recommendation without enough data", recommendSession([mk(0, 600)]) === null);

/* -------------------------------- demo data ----------------------------- */
const demo = seedDemoHistory(14);
check("demo seeds two weeks of sessions", demo.sessions.length > 30, String(demo.sessions.length));
check("demo seeds app + web usage", demo.usage.filter((u) => u.kind === "app").length > 20 && demo.usage.some((u) => u.kind === "web"));
check("demo sessions never end in the future", demo.sessions.every((s) => s.endedAt <= Date.now()));
check("demo sessions have positive duration", demo.sessions.every((s) => s.actualSec > 0));

/* ---------------------------------- rooms ------------------------------- */
const code = makeRoomCode();
check("room codes are 6 chars of an unambiguous alphabet", /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
const buddies = makeBuddies(3, 120, 42);
check("buddies are created for the room", buddies.length === 3 && buddies.every((b) => b.isBot && !b.isSelf));
const ticked = tickBuddies(buddies, 60);
check("buddy minutes never decrease", ticked.every((m, i) => m.minutes >= buddies[i].minutes));
check("buddy minutes stay under the cap", ticked.every((m) => m.minutes <= m.targetMinutes + 60));

/* ------------------------------ drift helpers --------------------------- */
check("social / video / games / news count as drift", DISTRACTING.social && DISTRACTING.video && DISTRACTING.games && DISTRACTING.news);
check("study and other do not count as drift", !DISTRACTING.study && !DISTRACTING.other);
check("missing category never counts as drift", !DISTRACTING.undefined && !DISTRACTING.null);
check("drift threshold never drops below 3s", driftThresholdSec(0) === 3 && driftThresholdSec(-5) === 3);
check("drift threshold converts minutes to seconds", driftThresholdSec(15) === 900, String(driftThresholdSec(15)));
check("drift threshold survives a corrupt value", driftThresholdSec(NaN) === 900, String(driftThresholdSec(NaN)));
check("drift nudge names the app", /YouTube/.test(driftNudgeText("YouTube", 6).title), driftNudgeText("YouTube", 6).title);

/* -------------------------------- migration ----------------------------- */
const v1 = {
  version: 1,
  settings: { nickname: "Legacy user", pro: true, dailyGoalMinutes: 90 },
  sessions: [{ id: "old-1", endedAt: Date.now(), actualSec: 1800, subject: "Maths", mode: "study", label: "Old", startedAt: Date.now() - 1800000, plannedSec: 1800, completed: true, strict: false, distractions: 0, blocked: 0, rating: "like", roomId: null }],
  usage: [{ date: todayKey(), key: "chrome.exe", label: "Chrome", icon: "🌐", category: "other", kind: "app", seconds: 600 }],
};
const migrated = migrateState(v1, "browser");
check("v1 state migrates instead of being dropped", Boolean(migrated));
check("migration keeps the user's sessions", migrated?.sessions.length === 1 && migrated.sessions[0].id === "old-1");
check("migration keeps the user's settings", migrated?.settings.nickname === "Legacy user" && migrated.settings.dailyGoalMinutes === 90);
check("migration fills in newly added settings", migrated?.settings.focusGuardReminders === DEFAULT_SETTINGS.focusGuardReminders);
check("migration adds the reminders array", Array.isArray(migrated?.reminders) && migrated.reminders.length === 0);
check("migration stamps the current version", migrated?.version === STATE_VERSION, String(migrated?.version));
check("migration keeps v1 usage rows", migrated?.usage.length === 1);
check("migration on a partial blob fills defaults", Boolean(migrateState({ version: 1 }, "browser")?.appRules.length));
check("garbage state is rejected", migrateState("nonsense", "browser") === null && migrateState(null, "browser") === null);
check("a future schema version is rejected", migrateState({ version: 99 }, "browser") === null);
check("a fresh state passes through unchanged", migrateState(initialState("browser"), "browser")?.version === STATE_VERSION);
check("migration never invents a running session", migrateState({ version: 1 }, "browser")?.active === null);

/* --------------------------------- pruning ------------------------------ */
const stale = { ...initialState("browser"), sessions: new Array(500).fill(mk(1, 60)), blockedLog: new Array(300).fill({ id: "x", at: Date.now() }) };
const pruned = pruneState(stale);
check("pruning caps the session history", pruned.sessions.length === 400, String(pruned.sessions.length));
check("pruning caps the blocked log", pruned.blockedLog.length === 200, String(pruned.blockedLog.length));
check("pruning caps reminders", pruneState({ ...stale, reminders: new Array(50).fill({ id: "r" }) }).reminders.length === 20);

/* --------------------------------- summary ------------------------------ */
console.log(`\n${passed}/${passed + failed} engine checks passed`);
process.exit(failed ? 1 : 0);
