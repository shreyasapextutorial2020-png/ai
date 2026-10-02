import { uid, todayKey } from "./defaults";
import type { PersistedState, SessionLog, UsageSlice } from "./types";

const SUBJECTS = ["Maths", "Physics", "Chemistry", "Biology", "Computer Science", "English", "Revision"];
const MODES: SessionLog["mode"][] = ["study", "pomodoro", "countdown", "stopwatch"];

const APPS: Array<Pick<UsageSlice, "key" | "label" | "icon" | "category" | "kind">> = [
  { key: "chrome.exe", label: "Google Chrome", icon: "🌐", category: "other", kind: "app" },
  { key: "Code.exe", label: "VS Code", icon: "🧑‍💻", category: "study", kind: "app" },
  { key: "discord.exe", label: "Discord", icon: "💬", category: "chat", kind: "app" },
  { key: "tiktok.exe", label: "TikTok", icon: "🎵", category: "social", kind: "app" },
  { key: "steam.exe", label: "Steam", icon: "🎮", category: "games", kind: "app" },
  { key: "WINWORD.EXE", label: "Microsoft Word", icon: "📄", category: "study", kind: "app" },
  { key: "Spotify.exe", label: "Spotify", icon: "🎧", category: "video", kind: "app" },
  { key: "explorer.exe", label: "File Explorer", icon: "🗂️", category: "other", kind: "app" },
];

const SITES: Array<Pick<UsageSlice, "key" | "label" | "icon" | "category" | "kind">> = [
  { key: "youtube.com", label: "YouTube", icon: "▶️", category: "video", kind: "web" },
  { key: "instagram.com", label: "Instagram", icon: "📸", category: "social", kind: "web" },
  { key: "docs.google.com", label: "Google Docs", icon: "📝", category: "study", kind: "web" },
  { key: "reddit.com", label: "Reddit", icon: "👽", category: "social", kind: "web" },
  { key: "khanacademy.org", label: "Khan Academy", icon: "🎓", category: "study", kind: "web" },
  { key: "classroom.google.com", label: "Google Classroom", icon: "🏫", category: "study", kind: "web" },
  { key: "netflix.com", label: "Netflix", icon: "🍿", category: "video", kind: "web" },
  { key: "stackoverflow.com", label: "Stack Overflow", icon: "🧱", category: "study", kind: "web" },
];

/** Builds ~2 weeks of believable history so analytics screens are meaningful. */
export function seedDemoHistory(days = 14): {
  sessions: SessionLog[];
  usage: UsageSlice[];
} {
  const sessions: SessionLog[] = [];
  const usage: UsageSlice[] = [];
  const now = new Date();

  for (let back = days; back >= 1; back--) {
    const day = new Date(now);
    day.setDate(day.getDate() - back);
    const key = todayKey(day);
    const weekend = day.getDay() === 0 || day.getDay() === 6;

    // weekends are lighter, midweek is strongest
    const base = weekend ? 45 + Math.random() * 70 : 120 + Math.random() * 150;
    const count = Math.max(1, Math.round(base / 45));
    let cursor = 9 * 3600;

    for (let i = 0; i < count; i++) {
      const planned = [25 * 60, 45 * 60, 50 * 60, 60 * 60][Math.floor(Math.random() * 4)];
      const actual = Math.round(planned * (0.72 + Math.random() * 0.28));
      const startedAt = new Date(day);
      startedAt.setSeconds(cursor);
      cursor += actual + 600 + Math.floor(Math.random() * 900);
      const endedAt = new Date(startedAt.getTime() + actual * 1000);
      sessions.push({
        id: uid(),
        mode: MODES[Math.floor(Math.random() * MODES.length)],
        label: "Focus session",
        subject: SUBJECTS[Math.floor(Math.random() * SUBJECTS.length)],
        startedAt: startedAt.getTime(),
        endedAt: endedAt.getTime(),
        plannedSec: planned,
        actualSec: actual,
        completed: actual >= planned * 0.95,
        strict: Math.random() > 0.7,
        distractions: Math.random() > 0.6 ? Math.floor(Math.random() * 4) : 0,
        blocked: Math.floor(Math.random() * 5),
        rating: Math.random() > 0.5 ? "like" : Math.random() > 0.4 ? "dislike" : null,
        roomId: null,
      });
    }

    for (const a of APPS) {
      const minutes = Math.round(Math.random() * (a.category === "study" ? 190 : 70));
      if (minutes < 3) continue;
      usage.push({ ...a, date: key, seconds: minutes * 60 });
    }
    for (const s of SITES) {
      const minutes = Math.round(Math.random() * (s.category === "study" ? 120 : 60));
      if (minutes < 3) continue;
      usage.push({ ...s, date: key, seconds: minutes * 60 });
    }
  }

  return { sessions, usage };
}

export function seedDemoState(state: PersistedState): PersistedState {
  if (state.demoData) return state;
  const { sessions, usage } = seedDemoHistory();
  const withSessions: PersistedState = {
    ...state,
    sessions: [...sessions, ...state.sessions].sort((a, b) => a.endedAt - b.endedAt),
    usage: [...usage, ...state.usage],
    demoData: true,
  };
  // best streak for the seeded history
  const days = new Set(sessions.map((s) => todayKey(new Date(s.endedAt))));
  let best = 0;
  let run = 0;
  const sorted = [...days].sort();
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0) run = 1;
    else {
      const prev = new Date(`${sorted[i - 1]}T00:00:00`);
      prev.setDate(prev.getDate() + 1);
      run = todayKey(prev) === sorted[i] ? run + 1 : 1;
    }
    best = Math.max(best, run);
  }
  withSessions.streak = {
    ...withSessions.streak,
    best,
    xp: sessions.reduce((acc, s) => acc + Math.floor(s.actualSec / 60), 0),
  };
  return withSessions;
}
