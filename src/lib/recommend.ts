import type { SessionLog } from "./types";

export interface Recommendation {
  title: string;
  body: string;
  mode: SessionLog["mode"];
  minutes: number;
  subject: string;
  reason: string;
}

const MODE_LABEL: Record<SessionLog["mode"], string> = {
  study: "Study session",
  pomodoro: "Pomodoro",
  stopwatch: "Stopwatch",
  countdown: "Countdown",
};

/**
 * Turns like/dislike ratings and completed sessions into a concrete next
 * session. Disliked patterns are avoided; liked ones are repeated.
 */
export function recommendSession(sessions: SessionLog[]): Recommendation | null {
  if (sessions.length < 3) return null;

  const scored = new Map<string, number>();
  const bump = (key: string, amount: number) => scored.set(key, (scored.get(key) ?? 0) + amount);

  for (const s of sessions.slice(-60)) {
    const bonus = s.rating === "like" ? 3 : s.rating === "dislike" ? -3 : 0;
    const weight = 1 + bonus + (s.completed ? 0.6 : 0);
    bump(`mode:${s.mode}`, weight);
    if (s.actualSec >= 25 * 60) bump("long", 1);
    if (s.actualSec < 25 * 60) bump("short", s.actualSec >= 10 * 60 ? 0.5 : -1);
    const hour = new Date(s.startedAt).getHours();
    if (hour < 12) bump("morning", weight);
    else if (hour < 17) bump("afternoon", weight);
    else bump("evening", weight);
    if (s.distractions === 0) bump(`subject:${s.subject}`, 1.5);
  }

  const bestMode = maxKey(scored, "mode:", 4);
  const mode = (bestMode?.replace("mode:", "") as SessionLog["mode"]) ?? "countdown";
  const avgMinutes = Math.round(
    sessions.slice(-12).reduce((a, s) => a + s.actualSec, 0) / Math.max(1, Math.min(12, sessions.length)) / 60,
  );
  const likedLong = (scored.get("long") ?? 0) > (scored.get("short") ?? 0);
  const minutes = clampMinutes(likedLong ? Math.max(45, avgMinutes) : avgMinutes || 30);

  const slot = maxKey(scored, "", 3) ?? "evening";
  const nowSlot = hourSlot(new Date().getHours());
  const subjectPool = sessions.slice(-20).filter((s) => s.rating !== "dislike");
  const subject = subjectPool.length
    ? subjectPool[subjectPool.length - 1].subject
    : "General";

  return {
    title: `${MODE_LABEL[mode]} · ${minutes} min`,
    body: `Repeat the pattern you rated highest: ${MODE_LABEL[mode].toLowerCase()} blocks around ${minutes} minutes in the ${slot.replace("mode:", "")}.`,
    mode,
    minutes,
    subject,
    reason:
      slot.replace("mode:", "") === nowSlot
        ? "You are in your strongest slot right now — perfect timing."
        : `Your strongest slot is usually the ${slot.replace("mode:", "")}.`,
  };
}

function maxKey(map: Map<string, number>, prefix: string, min: number): string | null {
  let best: string | null = null;
  let bestValue = -Infinity;
  for (const [key, value] of map) {
    if (prefix && !key.startsWith(prefix)) continue;
    if (!prefix && ["mode:", "subject:"].some((p) => key.startsWith(p))) continue;
    if (value > bestValue) {
      bestValue = value;
      best = key;
    }
  }
  return bestValue >= min ? best : null;
}

function clampMinutes(m: number) {
  return Math.max(10, Math.min(180, Math.round(m / 5) * 5));
}

function hourSlot(hour: number) {
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}
