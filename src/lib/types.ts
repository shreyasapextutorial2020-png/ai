/** Core data model for Regain PC. */

export type TimerMode = "study" | "pomodoro" | "stopwatch" | "countdown";
export type PomodoroPhase = "focus" | "short" | "long";
export type Rating = "like" | "dislike";
export type RuleMode = "focus" | "always";
export type RuleCategory =
  | "social"
  | "video"
  | "games"
  | "chat"
  | "adult"
  | "shopping"
  | "news"
  | "study"
  | "other";

export type ThemeId = "midnight" | "amoled" | "forest" | "ocean" | "sunset" | "aurora" | "light";

export interface ActiveSession {
  id: string;
  mode: TimerMode;
  label: string;
  subject: string;
  /** epoch ms when the current run started (resets on resume) */
  startedAt: number;
  /** seconds banked from previous runs of this session */
  bankedSec: number;
  /** 0 = open ended (stopwatch-like) */
  plannedSec: number;
  running: boolean;
  pausedAt: number | null;
  /** countdown target in seconds for "countdown" mode */
  strict: boolean;
  strictLevel: 0 | 1 | 2 | 3;
  focusGuard: boolean;
  distractions: number;
  blocked: number;
  phase: PomodoroPhase;
  round: number;
  roomId: string | null;
  music: string | null;
}

export interface SessionLog {
  id: string;
  mode: TimerMode;
  label: string;
  subject: string;
  startedAt: number;
  endedAt: number;
  plannedSec: number;
  actualSec: number;
  completed: boolean;
  strict: boolean;
  distractions: number;
  blocked: number;
  rating: Rating | null;
  roomId: string | null;
}

export interface FocusBlock {
  id: string;
  /** 0 = Sunday … 6 = Saturday */
  day: number;
  start: string; // "09:00"
  end: string; // "10:30"
  label: string;
  subject: string;
  colour: string;
  reminder: boolean;
  /** ISO date keys the block was completed on */
  completedOn: string[];
}

export interface AppRule {
  id: string;
  /** process name as reported by the OS, e.g. "discord.exe" */
  process: string;
  name: string;
  icon: string;
  category: RuleCategory;
  enabled: boolean;
  mode: RuleMode;
  custom?: boolean;
}

export interface WebRule {
  id: string;
  domain: string;
  label: string;
  icon: string;
  category: RuleCategory;
  enabled: boolean;
  mode: RuleMode;
  vpnSafeBlock?: boolean;
  custom?: boolean;
}

export interface StudyChannel {
  id: string;
  name: string;
  handle: string;
  enabled: boolean;
}

export interface UsageSlice {
  date: string; // YYYY-MM-DD
  key: string; // process name or domain
  label: string;
  icon: string;
  category: RuleCategory;
  kind: "app" | "web";
  seconds: number;
}

export interface RoomMember {
  id: string;
  name: string;
  avatar: string;
  minutes: number;
  targetMinutes: number;
  focusing: boolean;
  /** seconds of uninterrupted focus in the current block */
  sessionSec: number;
  distractions: number;
  isSelf: boolean;
  joinedAt: number;
  lastSeen: number;
  isBot?: boolean;
  reactions?: Record<string, number>;
}

export interface RoomState {
  id: string;
  code: string;
  name: string;
  goalMinutes: number;
  hostId: string;
  createdAt: number;
  members: RoomMember[];
  chat: RoomMessage[];
}

export interface RoomMessage {
  id: string;
  memberId: string;
  name: string;
  avatar: string;
  text: string;
  at: number;
}

export interface Reminder {
  id: string;
  kind: "drift" | "planner" | "goal" | "rating";
  title: string;
  body: string;
  at: number;
  /** app / domain / block id that triggered it */
  ref?: string;
}

export interface Settings {
  theme: ThemeId;
  accent: string;
  pro: boolean;
  proPlan: "monthly" | "yearly" | "lifetime";
  strictMode: boolean;
  strictLevel: 1 | 2 | 3;
  blockDuringFocus: boolean;
  blockReelsShorts: boolean;
  youtubeStudyMode: boolean;
  websiteBlocker: boolean;
  appBlocker: boolean;
  notifications: boolean;
  focusGuard: boolean;
  focusGuardReminders: boolean;
  focusGuardMinutes: number;
  startAtLogin: boolean;
  minimiseToTray: boolean;
  tickSound: boolean;
  musicVolume: number;
  musicTrack: string;
  /** additional sound ids layered under the primary track */
  musicLayers: string[];
  musicLayerVolume: number;
  /** overall thumbs-up/down for the app itself (separate from session ratings) */
  appRating: Rating | null;
  appRatingAt: number | null;
  wallpaper: string;
  roomServerUrl: string;
  nickname: string;
  avatar: string;
  dailyGoalMinutes: number;
  hardcoreUninstallGuard: boolean;
}

export interface PomodoroConfig {
  focusMin: number;
  shortMin: number;
  longMin: number;
  roundsBeforeLong: number;
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
}

export interface StreakInfo {
  current: number;
  best: number;
  lastDay: string | null;
  xp: number;
}

export interface PersistedState {
  version: number;
  settings: Settings;
  pomodoro: PomodoroConfig;
  sessions: SessionLog[];
  blocks: FocusBlock[];
  appRules: AppRule[];
  webRules: WebRule[];
  channels: StudyChannel[];
  usage: UsageSlice[];
  streak: StreakInfo;
  active: ActiveSession | null;
  room: RoomState | null;
  /** Tauri bridge connection state, purely informational for the UI */
  bridgeMode: "tauri" | "browser";
  /** stable per-install identity used for multiplayer rooms */
  selfId: string;
  blockedLog: BlockedLogEntry[];
  /** nudges surfaced as toasts (drift, planner, goal) */
  reminders: Reminder[];
  /** sample history is loaded so charts are meaningful on first run */
  demoData: boolean;
  seenWelcome: boolean;
}

export interface BlockedLogEntry {
  id: string;
  key: string;
  label: string;
  icon: string;
  category: RuleCategory;
  kind: "app" | "web";
  at: number;
  duringFocus: boolean;
}

export interface BlockedEvent {
  process_name: string;
  window_title: string;
  pid: number;
  at: number;
  kind: "app" | "web";
}
