import type { SoundKind } from "./audio";
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
export const STATE_VERSION = 3;

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
  /** extra layers mixed under the primary track (sound ids) */
  musicLayers: [],
  musicLayerVolume: 0.5,
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
  /* social */
  app("instagram.exe", "Instagram", "📸", "social"),
  app("tiktok.exe", "TikTok", "🎵", "social"),
  app("snapchat.exe", "Snapchat", "👻", "social"),
  app("twitter.exe", "X / Twitter", "🐦", "social"),
  app("facebook.exe", "Facebook", "📘", "social"),
  app("reddit.exe", "Reddit", "👽", "social"),
  /* chat */
  app("discord.exe", "Discord", "💬", "chat"),
  app("whatsapp.exe", "WhatsApp", "🟢", "chat"),
  app("telegram.exe", "Telegram", "✈️", "chat"),
  app("TelegramDesktop.exe", "Telegram Desktop", "✈️", "chat"),
  app("Signal.exe", "Signal", "🔒", "chat", false),
  /* chess, board & card games — the ones people actually lose evenings to */
  app("Chess.exe", "Chess.com", "♟️", "games"),
  app("chess.com.exe", "Chess.com (desktop app)", "♟️", "games"),
  app("lichess.exe", "Lichess", "♞", "games"),
  app("Chess24.exe", "Chess24", "♜", "games"),
  app("RummyCircle.exe", "RummyCircle", "🃏", "games"),
  app("Dream11.exe", "Dream11", "🏏", "games"),
  app("MPL.exe", "MPL", "🎯", "games", false),
  app("Solitaire.exe", "Solitaire", "🃏", "games", false),
  app("Minesweeper.exe", "Minesweeper", "💥", "games", false),
  /* video game clients */
  app("steam.exe", "Steam", "🎮", "games"),
  app("steamwebhelper.exe", "Steam Web Helper", "🎮", "games"),
  app("epicgameslauncher.exe", "Epic Games", "🕹️", "games"),
  app("LeagueClient.exe", "League of Legends", "⚔️", "games"),
  app("VALORANT.exe", "Valorant", "🔫", "games"),
  app("RobloxPlayerBeta.exe", "Roblox", "🧱", "games"),
  app("MinecraftLauncher.exe", "Minecraft", "⛏️", "games"),
  app("Freefire.exe", "Free Fire", "🔫", "games"),
  app("GTA5.exe", "GTA V", "🚗", "games", false),
  /* streaming & music */
  app("netflix.exe", "Netflix", "🍿", "video"),
  app("primevideo.exe", "Prime Video", "📺", "video"),
  app("Hotstar.exe", "Disney+ Hotstar", "🎥", "video"),
  app("Twitch.exe", "Twitch", "🟣", "video"),
  app("YouTube.exe", "YouTube (PWA / desktop)", "▶️", "video"),
  app("Spotify.exe", "Spotify", "🎧", "video", false),
  app("vlc.exe", "VLC", "🎬", "video", false),
  /* browsers — off by default: blocking these blocks your study material too.
     Block individual sites in the Website tab instead. */
  app("chrome.exe", "Google Chrome", "🌐", "other", false),
  app("msedge.exe", "Microsoft Edge", "🌊", "other", false),
  app("MicrosoftEdge.exe", "Microsoft Edge (legacy)", "🌊", "other", false),
  app("firefox.exe", "Firefox", "🦊", "other", false),
  app("brave.exe", "Brave", "🦁", "other", false),
  app("opera.exe", "Opera", "🎭", "other", false),
  app("vivaldi.exe", "Vivaldi", "🎨", "other", false),
  /* other */
  app("qbittorrent.exe", "qBittorrent", "⬇️", "other", false),
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
  /* chess, board & card games — blocked by default, this is the usual culprit */
  web("chess.com", "Chess.com", "♟️", "games"),
  web("lichess.org", "Lichess", "♞", "games"),
  web("chess24.com", "Chess24", "♜", "games"),
  web("chesskid.com", "ChessKid", "♟️", "games", false),
  web("rummycircle.com", "RummyCircle", "🃏", "games"),
  web("add52.com", "Adda52 Rummy", "🃏", "games", false),
  web("mpl.live", "MPL", "🎯", "games", false),
  web("dream11.com", "Dream11", "🏏", "games", false),
  web("play.chess.com", "Chess.com (play)", "♟️", "games", false),
  /* casual web games */
  web("friv.com", "Friv", "🎮", "games", false),
  web("poki.com", "Poki", "🎮", "games", false),
  web("y8.com", "Y8 Games", "🎮", "games", false),
  web("crazygames.com", "CrazyGames", "🎮", "games", false),
  web("miniclip.com", "Miniclip", "🎮", "games", false),
  web("roblox.com", "Roblox", "🧱", "games"),
  web("store.steampowered.com", "Steam Store", "🎮", "games"),
  web("epicgames.com", "Epic Games Store", "🕹️", "games", false),
  /* short-form & streaming video */
  /* YouTube stays available by default so lectures keep working: the Shorts
     shield and Study Mode tame it. Full blocking is one toggle away. */
  web("youtube.com", "YouTube", "▶️", "video", false),
  web("netflix.com", "Netflix", "🍿", "video"),
  web("primevideo.com", "Prime Video", "📺", "video"),
  web("hotstar.com", "Disney+ Hotstar", "🎥", "video"),
  web("jiocinema.com", "JioCinema", "🎥", "video", false),
  web("zee5.com", "ZEE5", "🎥", "video", false),
  web("sonyliv.com", "SonyLIV", "🎥", "video", false),
  web("twitch.tv", "Twitch", "🟣", "video"),
  web("dailymotion.com", "Dailymotion", "📹", "video", false),
  /* social */
  web("instagram.com", "Instagram", "📸", "social"),
  web("tiktok.com", "TikTok", "🎵", "social"),
  web("snapchat.com", "Snapchat", "👻", "social"),
  web("reddit.com", "Reddit", "👽", "social"),
  web("x.com", "X (Twitter)", "🐦", "social"),
  web("twitter.com", "Twitter", "🐦", "social"),
  web("facebook.com", "Facebook", "📘", "social"),
  web("threads.net", "Threads", "🧵", "social", false),
  web("pinterest.com", "Pinterest", "📌", "social", false),
  web("quora.com", "Quora", "❓", "social", false),
  web("linkedin.com", "LinkedIn", "💼", "social", false),
  /* chat */
  web("discord.com", "Discord", "💬", "chat"),
  web("web.whatsapp.com", "WhatsApp Web", "🟢", "chat"),
  web("telegram.org", "Telegram Web", "✈️", "chat", false),
  /* shopping */
  web("amazon.in", "Amazon", "🛒", "shopping", false),
  web("flipkart.com", "Flipkart", "🛍️", "shopping", false),
  web("myntra.com", "Myntra", "👕", "shopping", false),
  web("ajio.com", "AJIO", "🛍️", "shopping", false),
  web("meesho.com", "Meesho", "📦", "shopping", false),
  web("nykaa.com", "Nykaa", "💄", "shopping", false),
  web("aliexpress.com", "AliExpress", "📦", "shopping", false),
  web("ebay.com", "eBay", "🛒", "shopping", false),
  /* news & AI chat */
  web("news.google.com", "Google News", "📰", "news", false),
  web("timesofindia.com", "Times of India", "📰", "news", false),
  web("ndtv.com", "NDTV", "📰", "news", false),
  web("hindustantimes.com", "Hindustan Times", "📰", "news", false),
  web("inshorts.com", "Inshorts", "📰", "news", false),
  web("chatgpt.com", "ChatGPT", "🤖", "other", false),
  web("gemini.google.com", "Gemini", "✨", "other", false),
  /* adult — always blocked, never gated behind a session */
  web("pornhub.com", "Adult content", "🔞", "adult", true, "always"),
  web("xvideos.com", "Adult content", "🔞", "adult", true, "always"),
  web("xnxx.com", "Adult content", "🔞", "adult", true, "always"),
  web("xhamster.com", "Adult content", "🔞", "adult", true, "always"),
  web("redtube.com", "Adult content", "🔞", "adult", true, "always"),
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

export type SoundCategory = "noise" | "nature" | "place" | "music" | "focus";

export interface SoundDef {
  id: string;
  name: string;
  icon: string;
  blurb: string;
  pro: boolean;
  category: SoundCategory;
  /** synthesis voice used by the ambient engine */
  kind: SoundKind;
}

export const SOUND_CATEGORY_LABELS: Record<SoundCategory, string> = {
  noise: "Noise & masking",
  nature: "Nature & weather",
  place: "Places",
  music: "Music",
  focus: "Brainwave focus",
};

export const SOUNDS: SoundDef[] = [
  /* ---------------------------- masking ---------------------------- */
  { id: "rain", name: "Rainfall", icon: "🌧️", blurb: "Steady rain, proven to mask office noise", pro: false, category: "nature", kind: "rain" },
  { id: "brown", name: "Brown noise", icon: "🟤", blurb: "Deep rumble that quiets a racing mind", pro: false, category: "noise", kind: "brown" },
  { id: "white", name: "White noise", icon: "⚪", blurb: "Full-spectrum masking for library quiet", pro: false, category: "noise", kind: "white" },
  { id: "pink", name: "Pink noise", icon: "🌸", blurb: "Softer masking, easier on the ears", pro: false, category: "noise", kind: "pink" },

  /* ----------------------------- nature ---------------------------- */
  { id: "thunder", name: "Thunderstorm", icon: "🌩️", blurb: "Heavy rain with rolling thunder", pro: true, category: "nature", kind: "thunder" },
  { id: "stream", name: "Forest stream", icon: "🏞️", blurb: "Water over stones, birds in the canopy", pro: true, category: "nature", kind: "stream" },
  { id: "wind", name: "Windy hills", icon: "🍃", blurb: "Long gusts and grass, no melody", pro: false, category: "nature", kind: "wind" },
  { id: "ocean", name: "Ocean waves", icon: "🌊", blurb: "Slow swells for long study blocks", pro: true, category: "nature", kind: "ocean" },
  { id: "fire", name: "Fireplace", icon: "🔥", blurb: "Crackling warmth for night sessions", pro: true, category: "nature", kind: "fire" },
  { id: "forest", name: "Forest morning", icon: "🌲", blurb: "Birdsong and leaves, low arousal", pro: true, category: "nature", kind: "forest" },
  { id: "night", name: "Night crickets", icon: "🦗", blurb: "Crickets and a distant owl", pro: true, category: "nature", kind: "night" },
  { id: "chimes", name: "Wind chimes", icon: "🎐", blurb: "Sparse metallic chimes in the breeze", pro: true, category: "nature", kind: "chimes" },

  /* ----------------------------- places ---------------------------- */
  { id: "cafe", name: "Café murmur", icon: "☕", blurb: "70 dB of background chatter", pro: true, category: "place", kind: "cafe" },
  { id: "library", name: "Quiet library", icon: "📚", blurb: "Room hum, page turns, the odd cough", pro: false, category: "place", kind: "library" },
  { id: "train", name: "Night train", icon: "🚆", blurb: "Rain on the window, rhythmic clatter", pro: true, category: "place", kind: "train" },
  { id: "keyboard", name: "Library typing", icon: "⌨️", blurb: "A stranger's keyboard, studied ambience", pro: true, category: "place", kind: "keyboard" },
  { id: "plane", name: "Cabin hum", icon: "✈️", blurb: "Cruise-altitude engine drone", pro: true, category: "place", kind: "plane" },

  /* ----------------------------- music ----------------------------- */
  { id: "lofi", name: "Lo-fi pads", icon: "🎧", blurb: "Endless generated chords, no lyrics", pro: true, category: "music", kind: "lofi" },
  { id: "piano", name: "Lo-fi piano", icon: "🎹", blurb: "Soft keys over vinyl crackle", pro: true, category: "music", kind: "lofiPiano" },
  { id: "jazz", name: "Lo-fi jazz", icon: "🎷", blurb: "Brush drums and a walking bass", pro: true, category: "music", kind: "lofiJazz" },
  { id: "beats", name: "Lo-fi beats", icon: "🥁", blurb: "Boom-bap drums, 78 BPM, no vocals", pro: true, category: "music", kind: "lofiBeats" },
  { id: "chill", name: "Chillwave", icon: "🌙", blurb: "Warm synth chords and slow arpeggios", pro: true, category: "music", kind: "chillwave" },
  { id: "synthwave", name: "Synthwave", icon: "🏎️", blurb: "Retro arpeggiator, focus-tempo pulse", pro: true, category: "music", kind: "synthwave" },
  { id: "ambient", name: "Ambient pads", icon: "🌌", blurb: "Slow, wide, almost still", pro: true, category: "music", kind: "ambient" },
  { id: "bowls", name: "Singing bowls", icon: "🎼", blurb: "Tibetan bowl strikes with long decay", pro: false, category: "music", kind: "bowls" },
  { id: "tanpura", name: "Tanpura drone", icon: "🪕", blurb: "Steady Sa–Pa drone for deep reading", pro: false, category: "music", kind: "tanpura" },
  { id: "flute", name: "Bansuri flute", icon: "🪈", blurb: "Airy phrases in a pentatonic scale", pro: true, category: "music", kind: "flute" },

  /* ---------------------------- brainwave -------------------------- */
  { id: "deep", name: "Deep focus 40 Hz", icon: "🧠", blurb: "Gamma-tinged binaural drone", pro: true, category: "focus", kind: "deep" },
  { id: "alpha", name: "Alpha 10 Hz", icon: "🌀", blurb: "Relaxed alertness, good for reading", pro: true, category: "focus", kind: "alpha" },
  { id: "theta", name: "Theta 6 Hz", icon: "💤", blurb: "Wind-down drone for late revision", pro: true, category: "focus", kind: "theta" },
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
