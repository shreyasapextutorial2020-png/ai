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
} = require(`${libDir}/utils.js`);
const { recommendSession } = require(`${libDir}/recommend.js`);
const { seedDemoHistory } = require(`${libDir}/demo.js`);
const { makeRoomCode, makeBuddies, tickBuddies } = require(`${libDir}/rooms.js`);

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

/* --------------------------------- summary ------------------------------ */
console.log(`\n${passed}/${passed + failed} engine checks passed`);
process.exit(failed ? 1 : 0);
