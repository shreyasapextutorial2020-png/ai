import type {
  AppRule,
  FocusBlock,
  PersistedState,
  PomodoroConfig,
  Settings,
  StudyChannel,
  WebRule,
} from "./types";

export const STORAGE_KEY = "regain.pc.state.v1";
export const STATE_VERSION = 2;

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const todayKey = (d: Date = new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};

export const DEFAULT_SETTINGS: Settings = {
  theme: "midnight",
  accent: "#7c5cff",
  pro: false,
  proPlan: "monthly",
  strictMode: false,
  strictLevel: 2,
  blockDuringFocus: true,
  blockReelsShorts: true,
  youtubeStudyMode: false,
  websiteBlocker: true,
  appBlocker: true,
  notifications: true,
  focusGuard: false,
  focusGuardReminders: true,
  focusGuardMinutes: 15,
  startAtLogin: false,
  minimiseToTray: true,
  tickSound: false,
  musicVolume: 0.35,
  musicTrack: "rain",
  wallpaper: "aurora",
  roomServerUrl: "",
  nickname: "You",
  avatar: "🦊",
  dailyGoalMinutes: 120,
  hardcoreUninstallGuard: false,
};

export const DEFAULT_POMODORO: PomodoroConfig = {
  focusMin: 25,
  shortMin: 5,
  longMin: 15,
  roundsBeforeLong: 4,
  autoStartBreaks: true,
  autoStartFocus: false,
};

/* ------------------------------------------------------------------ */
/* App blocker catalogue (Windows process names)                       */
/* ------------------------------------------------------------------ */

const app = (
  process: string,
  name: string,
  icon: string,
  category: AppRule["category"],
  enabled = true,
  mode: AppRule["mode"] = "focus",
): AppRule => ({ id: `app-${process}`, process, name, icon, category, enabled, mode });

export const APP_CATALOGUE: AppRule[] = [
  app("instagram.exe", "Instagram", "📸", "social"),
  app("tiktok.exe", "TikTok", "🎵", "social"),
  app("snapchat.exe", "Snapchat", "👻", "social"),
  app("twitter.exe", "X / Twitter", "🐦", "social"),
  app("facebook.exe", "Facebook", "📘", "social"),
  app("reddit.exe", "Reddit", "👽", "social"),
  app("discord.exe", "Discord", "💬", "chat"),
  app("whatsapp.exe", "WhatsApp", "🟢", "chat"),
  app("telegram.exe", "Telegram", "✈️", "chat"),
  app("Spotify.exe", "Spotify", "🎧", "video", false),
  app("steam.exe", "Steam", "🎮", "games"),
  app("steamwebhelper.exe", "Steam Web Helper", "🎮", "games"),
  app("epicgameslauncher.exe", "Epic Games", "🕹️", "games"),
  app("vlc.exe", "VLC", "🎬", "video", false),
  app("netflix.exe", "Netflix", "🍿", "video"),
  app("primevideo.exe", "Prime Video", "📺", "video"),
  app("Hotstar.exe", "Disney+ Hotstar", "🎥", "video"),
  app("Freefire.exe", "Free Fire", "🔫", "games"),
  app("GTA5.exe", "GTA V", "🚗", "games"),
  app("MicrosoftEdge.exe", "Microsoft Edge", "🌊", "other", false, "focus"),
  app("chrome.exe", "Google Chrome", "🌐", "other", false, "focus"),
  app("msedge.exe", "MS Edge (legacy)", "🌐", "other", false, "focus"),
  app("TelegramDesktop.exe", "Telegram Desktop", "✈️", "chat"),
  app("qbittorrent.exe", "qBittorrent", "⬇️", "other"),
];

/* ------------------------------------------------------------------ */
/* Website blocker catalogue                                           */
/* ------------------------------------------------------------------ */

const web = (
  domain: string,
  label: string,
  icon: string,
  category: WebRule["category"],
  enabled = true,
  mode: WebRule["mode"] = "focus",
): WebRule => ({ id: `web-${domain}`, domain, label, icon, category, enabled, mode });

export const WEB_CATALOGUE: WebRule[] = [
  web("instagram.com", "Instagram", "📸", "social"),
  web("tiktok.com", "TikTok", "🎵", "social"),
  web("snapchat.com", "Snapchat", "👻", "social"),
  web("reddit.com", "Reddit", "👽", "social"),
  web("x.com", "X (Twitter)", "🐦", "social"),
  web("twitter.com", "Twitter", "🐦", "social"),
  web("facebook.com", "Facebook", "📘", "social"),
  web("pinterest.com", "Pinterest", "📌", "social"),
  web("netflix.com", "Netflix", "🍿", "video"),
  web("primevideo.com", "Prime Video", "📺", "video"),
  web("hotstar.com", "Disney+ Hotstar", "🎥", "video"),
  web("twitch.tv", "Twitch", "🟣", "video"),
  web("9gag.com", "9GAG", "😂", "other"),
  web("roblox.com", "Roblox", "🎮", "games"),
  web("chess.com", "Chess.com", "♟️", "games"),
  web("store.steampowered.com", "Steam Store", "🎮", "games"),
  web("amazon.in", "Amazon", "🛒", "shopping", false),
  web("flipkart.com", "Flipkart", "🛍️", "shopping", false),
  web("pornhub.com", "Adult content", "🔞", "adult", true, "always"),
  web("xvideos.com", "Adult content", "🔞", "adult", true, "always"),
  web("xnxx.com", "Adult content", "🔞", "adult", true, "always"),
  web("news.google.com", "Google News", "📰", "news", false),
  web("timesofindia.com", "Times of India", "📰", "news", false),
];

/* ------------------------------------------------------------------ */
/* YouTube study-mode channels                                         */
/* ------------------------------------------------------------------ */

export const STUDY_CHANNELS: StudyChannel[] = [
  { id: "ch-physics", name: "Physics Wallah", handle: "@PhysicsWallah", enabled: true },
  { id: "ch-khan", name: "Khan Academy", handle: "@khanacademy", enabled: true },
  { id: "ch-mit", name: "MIT OpenCourseWare", handle: "@mitocw", enabled: true },
  { id: "ch-crash", name: "CrashCourse", handle: "@crashcourse", enabled: true },
  { id: "ch-veritasium", name: "Veritasium", handle: "@veritasium", enabled: true },
  { id: "ch-3b1b", name: "3Blue1Brown", handle: "@3blue1brown", enabled: true },
  { id: "ch-apna", name: "Apna College", handle: "@ApnaCollegeOfficial", enabled: false },
  { id: "ch-cs50", name: "CS50", handle: "@cs50", enabled: true },
  { id: "ch-gate", name: "Gate Smashers", handle: "@GateSmashers", enabled: false },
  { id: "ch-fireship", name: "Fireship", handle: "@Fireship", enabled: false },
];

/* ------------------------------------------------------------------ */
/* Themes                                                              */
/* ------------------------------------------------------------------ */

export interface ThemeDef {
  id: Settings["theme"];
  name: string;
  pro: boolean;
  swatch: [string, string, string];
}

export const THEMES: ThemeDef[] = [
  { id: "midnight", name: "Midnight", pro: false, swatch: ["#12122b", "#1d1b3f", "#7c5cff"] },
  { id: "amoled", name: "AMOLED Black", pro: false, swatch: ["#000000", "#0b0b12", "#8b7bff"] },
  { id: "forest", name: "Forest Calm", pro: false, swatch: ["#08211b", "#0f3a2e", "#2fbf8f"] },
  { id: "ocean", name: "Deep Ocean", pro: true, swatch: ["#04182b", "#0a2f52", "#38bdf8"] },
  { id: "sunset", name: "Sunset Lo-Fi", pro: true, swatch: ["#2a0f1f", "#4a1730", "#fb7185"] },
  { id: "aurora", name: "Aurora", pro: true, swatch: ["#0a0f24", "#132447", "#4ade80"] },
  { id: "light", name: "Daylight", pro: false, swatch: ["#f6f7fb", "#ffffff", "#6d4aff"] },
];

export const ACCENTS = [
  "#7c5cff",
  "#38bdf8",
  "#2fbf8f",
  "#f59e0b",
  "#fb7185",
  "#a3e635",
  "#e879f9",
  "#f97316",
];

export const WALLPAPERS = [
  { id: "aurora", name: "Aurora waves", css: "radial-gradient(1200px 500px at 20% -10%, rgba(124,92,255,.45), transparent 60%), radial-gradient(900px 500px at 90% 10%, rgba(56,189,248,.35), transparent 60%)" },
  { id: "dunes", name: "Desert dunes", css: "radial-gradient(1000px 600px at 10% 0%, rgba(251,146,60,.35), transparent 60%), radial-gradient(900px 500px at 80% 20%, rgba(244,63,94,.28), transparent 60%)" },
  { id: "rainforest", name: "Rainforest", css: "radial-gradient(1000px 600px at 15% 0%, rgba(45,212,191,.32), transparent 60%), radial-gradient(900px 500px at 85% 25%, rgba(34,197,94,.28), transparent 60%)" },
  { id: "nebula", name: "Nebula", css: "radial-gradient(1100px 600px at 25% -5%, rgba(168,85,247,.4), transparent 60%), radial-gradient(900px 500px at 80% 15%, rgba(59,130,246,.3), transparent 60%)" },
  { id: "paper", name: "Paper", css: "radial-gradient(900px 500px at 20% 0%, rgba(148,163,184,.25), transparent 60%)" },
];

/* ------------------------------------------------------------------ */
/* Focus sounds (all generated live with the Web Audio API)            */
/* ------------------------------------------------------------------ */

export interface SoundDef {
  id: string;
  name: string;
  icon: string;
  blurb: string;
  pro: boolean;
  kind:
    | "white"
    | "pink"
    | "brown"
    | "rain"
    | "ocean"
    | "fire"
    | "forest"
    | "cafe"
    | "lofi"
    | "deep";
}

export const SOUNDS: SoundDef[] = [
  { id: "rain", name: "Rainfall", icon: "🌧️", blurb: "Steady rain, proven to mask office noise", pro: false, kind: "rain" },
  { id: "brown", name: "Brown noise", icon: "🟤", blurb: "Deep rumble that quiets a racing mind", pro: false, kind: "brown" },
  { id: "white", name: "White noise", icon: "⚪", blurb: "Full-spectrum masking for library quiet", pro: false, kind: "white" },
  { id: "pink", name: "Pink noise", icon: "🌸", blurb: "Softer masking, easier on the ears", pro: false, kind: "pink" },
  { id: "ocean", name: "Ocean waves", icon: "🌊", blurb: "Slow swells for long study blocks", pro: true, kind: "ocean" },
  { id: "fire", name: "Fireplace", icon: "🔥", blurb: "Crackling warmth for night sessions", pro: true, kind: "fire" },
  { id: "forest", name: "Forest morning", icon: "🌲", blurb: "Birdsong and leaves, low arousal", pro: true, kind: "forest" },
  { id: "cafe", name: "Café murmur", icon: "☕", blurb: "70 dB of background chatter", pro: true, kind: "cafe" },
  { id: "lofi", name: "Lo-fi pads", icon: "🎧", blurb: "Endless generated chords, no lyrics", pro: true, kind: "lofi" },
  { id: "deep", name: "Deep focus 40 Hz", icon: "🧠", blurb: "Gamma-tinged binaural drone", pro: true, kind: "deep" },
];

/* ------------------------------------------------------------------ */
/* Initial state                                                       */
/* ------------------------------------------------------------------ */

export const DEFAULT_BLOCKS: FocusBlock[] = [
  { id: "b-1", day: 1, start: "06:30", end: "08:00", label: "Deep work — Maths", subject: "Maths", colour: "#7c5cff", reminder: true, completedOn: [] },
  { id: "b-2", day: 1, start: "19:00", end: "20:30", label: "Revision — Physics", subject: "Physics", colour: "#38bdf8", reminder: true, completedOn: [] },
  { id: "b-3", day: 2, start: "06:30", end: "08:00", label: "Deep work — Chemistry", subject: "Chemistry", colour: "#2fbf8f", reminder: false, completedOn: [] },
  { id: "b-4", day: 3, start: "20:00", end: "21:30", label: "Mock test review", subject: "Test", colour: "#f59e0b", reminder: true, completedOn: [] },
  { id: "b-5", day: 6, start: "09:00", end: "11:00", label: "Weekly full syllabus", subject: "All", colour: "#fb7185", reminder: true, completedOn: [] },
];

export function initialState(bridgeMode: "tauri" | "browser"): PersistedState {
  return {
    version: STATE_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    pomodoro: { ...DEFAULT_POMODORO },
    sessions: [],
    blocks: DEFAULT_BLOCKS,
    appRules: APP_CATALOGUE,
    webRules: WEB_CATALOGUE,
    channels: STUDY_CHANNELS,
    usage: [],
    streak: { current: 0, best: 0, lastDay: null, xp: 0 },
    active: null,
    room: null,
    bridgeMode,
    selfId: uid(),
    blockedLog: [],
    reminders: [],
    demoData: false,
    seenWelcome: false,
  };
}

export const CATEGORY_COLOURS: Record<string, string> = {
  study: "#2fbf8f",
  social: "#fb7185",
  video: "#f59e0b",
  games: "#a78bfa",
  chat: "#38bdf8",
  adult: "#ef4444",
  shopping: "#e879f9",
  news: "#94a3b8",
  other: "#64748b",
};

export const CATEGORY_LABELS: Record<string, string> = {
  study: "Study",
  social: "Social",
  video: "Streaming",
  games: "Games",
  chat: "Chat",
  adult: "Adult",
  shopping: "Shopping",
  news: "News",
  other: "Other",
};
