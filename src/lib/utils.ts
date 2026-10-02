import type { PersistedState, SessionLog, UsageSlice } from "./types";
import { todayKey } from "./defaults";

export { todayKey };

/* ----------------------------- formatting ----------------------------- */

export function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

/** 01:24:07 for long, 24:07 for short */
export function fmtClock(totalSec: number) {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** 1h 24m / 42m / 30s */
export function fmtShort(totalSec: number) {
  const s = Math.max(0, Math.floor(totalSec));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function fmtHours(totalSec: number) {
  return (totalSec / 3600).toFixed(1);
}

export function fmtDate(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtDay(dateKey: string) {
  const d = new Date(`${dateKey}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export function minutesToClock(mins: number) {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${pad(m)}m` : `${m}m`;
}

/* ------------------------------ date keys ------------------------------ */

export function lastNDays(n: number, from: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(from);
    d.setDate(d.getDate() - i);
    out.push(todayKey(d));
  }
  return out;
}

export function weekdayName(day: number) {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day] ?? "";
}

export function weekdayShort(day: number) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day] ?? "";
}

export function clockToMinutes(clock: string) {
  const [h, m] = clock.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function minutesToClockStr(mins: number) {
  const clamped = ((mins % 1440) + 1440) % 1440;
  return `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}`;
}

/* ------------------------------ analytics ------------------------------ */

export interface DayBucket {
  date: string;
  focusedSec: number;
  sessions: number;
  distractions: number;
}

export function dailyBuckets(sessions: SessionLog[], days = 14): DayBucket[] {
  const map = new Map<string, DayBucket>();
  for (const key of lastNDays(days)) {
    map.set(key, { date: key, focusedSec: 0, sessions: 0, distractions: 0 });
  }
  for (const s of sessions) {
    const key = todayKey(new Date(s.endedAt));
    const bucket = map.get(key);
    if (!bucket) continue;
    bucket.focusedSec += s.actualSec;
    bucket.sessions += 1;
    bucket.distractions += s.distractions;
  }
  return [...map.values()];
}

export function totalFocus(sessions: SessionLog[]) {
  return sessions.reduce((acc, s) => acc + s.actualSec, 0);
}

export function totalBlocked(sessions: SessionLog[]) {
  return sessions.reduce((acc, s) => acc + s.blocked, 0);
}

export function subjectBreakdown(sessions: SessionLog[]) {
  const map = new Map<string, number>();
  for (const s of sessions) {
    const key = s.subject?.trim() || "General";
    map.set(key, (map.get(key) || 0) + s.actualSec);
  }
  return [...map.entries()]
    .map(([subject, seconds]) => ({ subject, seconds }))
    .sort((a, b) => b.seconds - a.seconds);
}

export function usageForDate(usage: UsageSlice[], date: string, kind?: "app" | "web") {
  const map = new Map<string, UsageSlice>();
  for (const u of usage) {
    if (u.date !== date) continue;
    if (kind && u.kind !== kind) continue;
    const existing = map.get(u.key);
    if (existing) existing.seconds += u.seconds;
    else map.set(u.key, { ...u });
  }
  return [...map.values()].sort((a, b) => b.seconds - a.seconds);
}

export function distractionFreePercent(sessions: SessionLog[]) {
  if (!sessions.length) return 100;
  const total = sessions.length;
  const clean = sessions.filter((s) => s.distractions === 0).length;
  return Math.round((clean / total) * 100);
}

/** Rolling average of the last `window` days vs the days before it. */
export function trend(sessions: SessionLog[], window = 7) {
  const buckets = dailyBuckets(sessions, window * 2);
  const recent = buckets.slice(window).reduce((a, b) => a + b.focusedSec, 0);
  const previous = buckets.slice(0, window).reduce((a, b) => a + b.focusedSec, 0);
  if (previous === 0) return recent === 0 ? 0 : 100;
  return Math.round(((recent - previous) / previous) * 100);
}

export function bestDay(sessions: SessionLog[]) {
  const buckets = dailyBuckets(sessions, 60);
  return buckets.reduce(
    (best, b) => (b.focusedSec > best.focusedSec ? b : best),
    { date: todayKey(), focusedSec: 0, sessions: 0, distractions: 0 },
  );
}

/** Longest uninterrupted run of days with at least one completed session. */
export function computeStreak(sessions: SessionLog[], previous: PersistedState["streak"]) {
  const done = new Set(
    sessions.filter((s) => s.actualSec >= 60).map((s) => todayKey(new Date(s.endedAt))),
  );
  let current = 0;
  const cursor = new Date();
  // Today may not be logged yet — start counting from yesterday in that case.
  if (!done.has(todayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (done.has(todayKey(cursor))) {
    current += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  const xp = sessions.reduce((acc, s) => acc + Math.floor(s.actualSec / 60), 0);
  return {
    current,
    best: Math.max(previous.best, current),
    lastDay: done.size ? todayKey() : previous.lastDay,
    xp,
  };
}

/* ------------------------------ reminders ------------------------------ */

/** Categories that count as "drift" when you are supposed to be focusing. */
export const DISTRACTING_CATEGORIES = new Set(["social", "video", "games", "news", "shopping"]);

/**
 * Focus Guard reminders fire when an unblocked but distracting app or site
 * keeps the foreground for `thresholdSec` inside a focus session — the
 * "you drifted" nudge, without hard-blocking study tools or browsers.
 */
export function isDistractingCategory(category: string | undefined | null) {
  return Boolean(category && DISTRACTING_CATEGORIES.has(category));
}

/** Never allow a zero/negative threshold even if a bad value is stored. */
export function driftThresholdSec(minutes: number) {
  return Math.max(3, Math.round((Number.isFinite(minutes) ? minutes : 15) * 60));
}

export function driftNudgeText(label: string, minutes: number) {
  return {
    title: `👀 Still on ${label}?`,
    body: `${Math.max(1, Math.round(minutes))} min on a distracting ${minutes >= 2 ? "app" : "window"} during focus. Back to the timer?`,
  };
}

export function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
