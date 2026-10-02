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
const {
  domainMatches,
  findMatchingRule,
  guessCategory,
  labelForDomain,
  matchesProcessRule,
  normalizeDomain,
  normalizeProcess,
  splitByMode,
  suggestedAppsForDomain,
} = require(`${libDir}/blocking.js`);
const { APP_CATALOGUE, SOUNDS, WEB_CATALOGUE } = require(`${libDir}/defaults.js`);

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

/* --------------------------- domain normalisation ------------------------ */
check("a pasted https URL is reduced to its domain", normalizeDomain("https://www.Chess.com/play?x=1#b") === "chess.com", normalizeDomain("https://www.Chess.com/play?x=1#b"));
check("a bare domain passes through", normalizeDomain("lichess.org") === "lichess.org");
check("uppercase and stray spaces are handled", normalizeDomain("  LICHESS.ORG  ") === "lichess.org");
check("ports are stripped", normalizeDomain("chess.com:8080/play") === "chess.com");
check("mobile subdomains fold onto the parent", normalizeDomain("m.youtube.com") === "youtube.com");
check("credentials in a URL are ignored", normalizeDomain("https://user:pw@chess.com/x") === "chess.com");
check("junk is rejected instead of blocking something random", normalizeDomain("not a domain") === "" && normalizeDomain("chess") === "" && normalizeDomain("") === "");
check("IP-looking hosts are rejected", normalizeDomain("192.168.1.1") === "");

check("a rule blocks its own domain", domainMatches("chess.com", "chess.com"));
check("a rule blocks subdomains", domainMatches("chess.com", "play.chess.com") && domainMatches("chess.com", "www.chess.com"));
check("a rule ignores lookalike domains", !domainMatches("chess.com", "chess.community.example") && !domainMatches("chess.com", "notchess.com"));
check("a pasted URL works as a rule", domainMatches("https://www.chess.com/play", "play.chess.com"));

check("labels are prettified", labelForDomain("chess.com") === "Chess.com", labelForDomain("chess.com"));
const chessGuess = guessCategory("play.chess.com");
check("typed chess domains get the game category", chessGuess.category === "games" && chessGuess.icon === "♟️", JSON.stringify(chessGuess));
check("streaming domains are recognised", guessCategory("netflix.com").category === "video");
check("unknown domains fall back to a generic icon", guessCategory("example.com").category === "other");

/* ---------------------------- process matching -------------------------- */
check("a rule matches the exact process", matchesProcessRule("chess.exe", "Chess.exe"));
check("a rule matches without the .exe suffix", matchesProcessRule("chess", "Chess.exe"));
check("a rule matches a longer real process name", matchesProcessRule("chess", "chess.com.exe"));
check("a rule matches a full path", matchesProcessRule("chess.exe", "C:\\Program Files\\Chess.com\\Chess.exe"));
check("a rule matches the window title when the process is generic", matchesProcessRule("chess.com", "chrome.exe", "Chess.com - Play Chess Online"));
check("a rule matches a title that dropped the TLD", matchesProcessRule("chess.com", "app.exe", "Chess — Play Chess"));
check("unrelated processes are not blocked", !matchesProcessRule("chess", "chrome.exe", "Physics lecture 4"));
check("short rules do not nuke unrelated titles", !matchesProcessRule("x", "chrome.exe", "Flexbox guide"), "single-char rule matched a title");
check("empty input is never a match", !matchesProcessRule("", "chess.exe") && !matchesProcessRule("chess", ""));
check("the first matching rule is reported", findMatchingRule(["steam", "chess", "tiktok"], "Chess.exe") === "chess");
check("no rule means no match", findMatchingRule(["steam"], "chess.exe", "Chess") === null);
check("process normalisation strips paths and extensions", normalizeProcess("C:\\Games\\Chess.exe") === "chess");

check("blocking a site suggests its desktop app", suggestedAppsForDomain("chess.com").includes("Chess.exe"), suggestedAppsForDomain("chess.com").join(", "));
check("an unknown site still offers a best guess", suggestedAppsForDomain("newthing.com").includes("newthing.exe"));

check("splitByMode separates focus rules from always rules", JSON.stringify(splitByMode([
  { enabled: true, mode: "focus", id: "a" },
  { enabled: true, mode: "always", id: "b" },
  { enabled: false, mode: "always", id: "c" },
]).always.map((r) => r.id)) === '["b"]');
check("splitByMode drops disabled rules entirely", splitByMode([
  { enabled: false, mode: "focus", id: "a" },
]).focus.length === 0);

/* ----------------------------- catalogues ------------------------------- */
const chessSite = WEB_CATALOGUE.find((r) => r.domain === "chess.com");
check("chess.com is blocked by default", Boolean(chessSite?.enabled), JSON.stringify(chessSite));
check("chess sites cover the usual suspects", ["chess.com", "lichess.org", "chess24.com"].every((d) => WEB_CATALOGUE.some((r) => r.domain === d)));
check("casual web-game sites are in the catalogue", ["friv.com", "poki.com", "y8.com", "crazygames.com"].every((d) => WEB_CATALOGUE.some((r) => r.domain === d)));
check("every site rule has a valid domain", WEB_CATALOGUE.every((r) => normalizeDomain(r.domain) === r.domain), WEB_CATALOGUE.filter((r) => normalizeDomain(r.domain) !== r.domain).map((r) => r.domain).join(", "));
check("no duplicate site rules", new Set(WEB_CATALOGUE.map((r) => r.domain)).size === WEB_CATALOGUE.length);
check("adult sites are always-on", WEB_CATALOGUE.filter((r) => r.category === "adult").every((r) => r.mode === "always"));
check("every category used by presets has rules", ["games", "video", "social", "chat", "shopping", "adult"].every((c) => WEB_CATALOGUE.some((r) => r.category === c)));
check("the site catalogue is substantially bigger than before", WEB_CATALOGUE.length >= 55, `${WEB_CATALOGUE.length} sites`);
check("the app catalogue is substantially bigger than before", APP_CATALOGUE.length >= 40, `${APP_CATALOGUE.length} apps`);
check("chess desktop apps are covered", APP_CATALOGUE.some((r) => normalizeProcess(r.process) === "chess" || normalizeProcess(r.process) === "chess.com"));
check("every app rule has a usable pattern", APP_CATALOGUE.every((r) => r.process.trim().length > 0));
check("no duplicate app rules", new Set(APP_CATALOGUE.map((r) => normalizeProcess(r.process))).size === APP_CATALOGUE.length, APP_CATALOGUE.map((r) => normalizeProcess(r.process)).join(", "));
check("an already-blocked app matches the catalogue rule", findMatchingRule(APP_CATALOGUE.map((r) => r.process), "Chess.exe", "Chess.com - Play") !== null);
check("a generic browser window is not matched by the chess rule", !matchesProcessRule("chess", "chrome.exe", "Physics lecture"));

/* ------------------------------- music ---------------------------------- */
check("the sound library grew past 25 soundscapes", SOUNDS.length >= 25, `${SOUNDS.length} sounds`);
check("every sound has a unique id", new Set(SOUNDS.map((s) => s.id)).size === SOUNDS.length);
check("every sound has an icon and a name", SOUNDS.every((s) => s.icon && s.name));
check("every sound has a category the UI knows", SOUNDS.every((s) => ["noise", "nature", "place", "music", "focus"].includes(s.category)), SOUNDS.map((s) => `${s.id}:${s.category}`).join(" "));
check("the music category actually contains music", SOUNDS.filter((s) => s.category === "music").length >= 8, `${SOUNDS.filter((s) => s.category === "music").length} music tracks`);
check("free users still get usable sounds", SOUNDS.filter((s) => !s.pro).length >= 8, `${SOUNDS.filter((s) => !s.pro).length} free sounds`);
check("the default track exists in the catalogue", SOUNDS.some((s) => s.id === DEFAULT_SETTINGS.musicTrack));

/* --------------------------------- summary ------------------------------ */
console.log(`\n${passed}/${passed + failed} engine checks passed`);
process.exit(failed ? 1 : 0);
