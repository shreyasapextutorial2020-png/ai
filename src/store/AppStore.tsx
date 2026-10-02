import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_POMODORO,
  DEFAULT_SETTINGS,
  STORAGE_KEY,
  STATE_VERSION,
  initialState,
  todayKey,
  uid,
} from "../lib/defaults";
import { seedDemoState } from "../lib/demo";
import {
  connectRoom,
  makeBuddies,
  makeRoomCode,
  tickBuddies,
  type RoomStatus,
  type RoomTransport,
} from "../lib/rooms";
import {
  hideBlockerWindow,
  isTauri,
  notify,
  requestNotificationPermission,
  setFocusActiveNative,
  showBlockerWindow,
  startMonitor,
  syncBlocklistToNative,
  syncExtensionSettings,
  syncTimerToNative,
  syncWebBlocklistToNative,
  type WindowInfo,
} from "../lib/desktop";
import { clamp, computeStreak } from "../lib/utils";
import type {
  ActiveSession,
  AppRule,
  FocusBlock,
  PersistedState,
  PomodoroConfig,
  RoomMember,
  RoomState,
  RuleMode,
  SessionLog,
  Settings,
  TimerMode,
  UsageSlice,
  WebRule,
} from "../lib/types";

/* ------------------------------------------------------------------ */
/* persistence                                                         */
/* ------------------------------------------------------------------ */

function loadState(): PersistedState {
  const bridgeMode: PersistedState["bridgeMode"] = isTauri() ? "tauri" : "browser";
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState;
      if (parsed && parsed.version === STATE_VERSION) {
        return {
          ...initialState(bridgeMode),
          ...parsed,
          settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
          pomodoro: { ...DEFAULT_POMODORO, ...parsed.pomodoro },
          bridgeMode,
          active: parsed.active ?? null,
        };
      }
    }
  } catch {
    /* corrupted storage — start fresh */
  }
  const fresh = initialState(bridgeMode);
  return bridgeMode === "browser" ? seedDemoState(fresh) : fresh;
}

function trimUsage(usage: UsageSlice[]) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 60);
  const cut = todayKey(cutoff);
  return usage.filter((u) => u.date >= cut);
}

/* ------------------------------------------------------------------ */
/* store shape                                                         */
/* ------------------------------------------------------------------ */

export interface NewSessionOptions {
  mode: TimerMode;
  label?: string;
  subject?: string;
  plannedSec?: number;
  strict?: boolean;
}

export interface GuardPayload {
  key: string;
  label: string;
  title: string;
  icon: string;
  kind: "app" | "web";
  at: number;
}

interface StoreValue {
  state: PersistedState;
  now: number;
  elapsedSec: number;
  remainingSec: number;
  isFocusActive: boolean;
  isPaused: boolean;
  strictActive: boolean;
  canStop: boolean;
  currentWindow: WindowInfo | null;
  guard: GuardPayload | null;
  roomStatus: RoomStatus;
  today: string;
  todayFocusedSec: number;
  todaySessions: SessionLog[];
  actions: {
    updateSettings: (patch: Partial<Settings>) => void;
    updatePomodoro: (patch: Partial<PomodoroConfig>) => void;
    startSession: (opts: NewSessionOptions) => void;
    pauseSession: () => void;
    resumeSession: () => void;
    stopSession: (reason?: "user" | "gave-up") => void;
    abandonStrictSession: () => void;
    rateSession: (id: string, rating: SessionLog["rating"]) => void;
    deleteSession: (id: string) => void;
    toggleAppRule: (id: string) => void;
    toggleWebRule: (id: string) => void;
    setRuleMode: (id: string, kind: "app" | "web", mode: RuleMode) => void;
    addCustomApp: (process: string, label: string) => void;
    addCustomWeb: (domain: string, label: string) => void;
    removeCustomRule: (id: string) => void;
    toggleChannel: (id: string) => void;
    addChannel: (handle: string) => void;
    removeChannel: (id: string) => void;
    saveBlock: (block: FocusBlock) => void;
    deleteBlock: (id: string) => void;
    toggleBlockDone: (id: string, dateKey: string) => void;
    createRoom: (opts: { name: string; goalMinutes: number; bots: number }) => RoomState;
    joinRoom: (code: string, opts: { name: string; goalMinutes: number }) => RoomState;
    leaveRoom: () => void;
    sendChat: (text: string) => void;
    sendReaction: (emoji: string) => void;
    dismissGuard: () => void;
    clearGuardAndReturn: () => void;
    resetAllData: () => void;
    clearDemoData: () => void;
    markWelcomeSeen: () => void;
  };
}

const StoreCtx = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error("useStore must be used inside <AppStoreProvider>");
  return ctx;
}

/* ------------------------------------------------------------------ */
/* provider                                                            */
/* ------------------------------------------------------------------ */

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PersistedState>(loadState);
  const [now, setNow] = useState(() => Date.now());
  const [currentWindow, setCurrentWindow] = useState<WindowInfo | null>(null);
  const [guard, setGuard] = useState<GuardPayload | null>(null);
  const [roomStatus, setRoomStatus] = useState<RoomStatus>("local");

  const stateRef = useRef(state);
  stateRef.current = state;

  const lastWindowRef = useRef<WindowInfo | null>(null);
  const usageTickRef = useRef<{ at: number } | null>(null);
  const lastCompleteRef = useRef(0);
  const goalHitRef = useRef<string | null>(null);
  const roomRef = useRef<RoomTransport | null>(null);
  const roomTickRef = useRef(0);

  /* ----------------------------- persist ---------------------------- */

  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        const payload: PersistedState = {
          ...state,
          usage: trimUsage(state.usage),
          blockedLog: state.blockedLog.slice(-200),
          sessions: state.sessions.slice(-400),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch (err) {
        console.warn("[regain] could not persist state", err);
      }
    }, 350);
    return () => window.clearTimeout(id);
  }, [state]);

  /* --------------------------- derived data ------------------------- */

  const active = state.active;
  const elapsedSec = useMemo(() => {
    if (!active) return 0;
    return active.bankedSec + (active.running ? Math.max(0, (now - active.startedAt) / 1000) : 0);
  }, [active, now]);

  const remainingSec = useMemo(() => {
    if (!active || active.plannedSec <= 0) return 0;
    return Math.max(0, active.plannedSec - elapsedSec);
  }, [active, elapsedSec]);

  const isFocusActive = Boolean(active && active.running);
  const isPaused = Boolean(active && !active.running);
  const strictActive = Boolean(active?.strict);
  const canStop = !(active?.strict && active.strictLevel >= 3);

  const today = todayKey();
  const todaySessions = useMemo(
    () => state.sessions.filter((s) => todayKey(new Date(s.endedAt)) === today),
    [state.sessions, today],
  );
  const todayFocusedSec = useMemo(
    () => todaySessions.reduce((acc, s) => acc + s.actualSec, 0),
    [todaySessions],
  );

  const enabledProcesses = useMemo(
    () =>
      state.settings.appBlocker
        ? state.appRules.filter((r) => r.enabled).map((r) => r.process.toLowerCase())
        : [],
    [state.appRules, state.settings.appBlocker],
  );
  const enabledDomains = useMemo(
    () =>
      state.settings.websiteBlocker
        ? state.webRules.filter((r) => r.enabled).map((r) => r.domain.toLowerCase())
        : [],
    [state.webRules, state.settings.websiteBlocker],
  );

  /* ----------------------------- helpers ---------------------------- */

  const accrueUsage = useCallback(
    (
      key: string,
      label: string,
      icon: string,
      kind: "app" | "web",
      category: UsageSlice["category"],
      seconds: number,
    ) => {
      if (!key) return;
      const date = todayKey();
      setState((prev) => {
        const idx = prev.usage.findIndex(
          (u) => u.date === date && u.key === key && u.kind === kind,
        );
        const usage =
          idx >= 0
            ? prev.usage.map((u, i) => (i === idx ? { ...u, seconds: u.seconds + seconds } : u))
            : [...prev.usage, { date, key, label, icon, kind, category, seconds }];
        return { ...prev, usage };
      });
    },
    [],
  );

  const registerBlocked = useCallback(
    (info: WindowInfo, kind: "app" | "web", meta: { label: string; icon: string; category: UsageSlice["category"] }) => {
      const s = stateRef.current;
      const duringFocus = Boolean(s.active?.running);
      setState((prev) => {
        const entry = {
          id: uid(),
          key: kind === "web" ? (info.domain || info.window_title) : info.process_name,
          label: meta.label,
          icon: meta.icon,
          category: meta.category,
          kind,
          at: Date.now(),
          duringFocus,
        };
        return {
          ...prev,
          blockedLog: [...prev.blockedLog, entry],
          active: prev.active
            ? {
                ...prev.active,
                distractions: prev.active.distractions + 1,
                blocked: prev.active.blocked + 1,
              }
            : prev.active,
        };
      });

      if (s.settings.focusGuard) {
        setGuard({
          key: kind === "web" ? info.window_title : info.process_name,
          label: meta.label,
          title: info.window_title,
          icon: meta.icon,
          kind,
          at: Date.now(),
        });
        void showBlockerWindow({ app: meta.label, title: info.window_title });
      }
      if (s.settings.notifications) {
        void notify(
          `🚫 ${meta.label} blocked`,
          duringFocus ? "Your focus session is protected. Get back to it." : "Blocked by Regain.",
        );
      }
    },
    [],
  );

  /* --------------------------- tick engine -------------------------- */

  const completeSession = useCallback(
    (reason: "completed" | "user" | "gave-up" | "emergency") => {
      const s = stateRef.current;
      const a = s.active;
      if (!a) return;
      if (Date.now() - lastCompleteRef.current < 1200) return;
      lastCompleteRef.current = Date.now();
      const actualSec = Math.round(
        a.bankedSec + (a.running ? (Date.now() - a.startedAt) / 1000 : 0),
      );
      if (actualSec < 5 && reason !== "user") {
        setState((prev) => ({ ...prev, active: null }));
        void hideBlockerWindow();
        return;
      }
      const log: SessionLog = {
        id: a.id,
        mode: a.mode,
        label: a.label,
        subject: a.subject,
        startedAt: a.startedAt,
        endedAt: Date.now(),
        plannedSec: a.plannedSec,
        actualSec,
        completed: reason === "completed",
        strict: a.strict,
        distractions: a.distractions,
        blocked: a.blocked,
        rating: null,
        roomId: a.roomId,
      };
      setState((prev) => {
        const sessions = [...prev.sessions, log];
        return {
          ...prev,
          sessions,
          active: null,
          streak: computeStreak(sessions, prev.streak),
        };
      });
      void hideBlockerWindow();
      void setFocusActiveNative(false, false);
      if (reason === "completed" && s.settings.notifications) {
        void notify("Session complete 🎉", `${Math.round(actualSec / 60)} focused minutes banked.`);
      }
      if (reason === "gave-up") {
        void notify("Session ended early", "Logged as an early exit — your streak stats are intact.");
      }
    },
    [],
  );

  const advancePomodoro = useCallback(() => {
    const s = stateRef.current;
    const a = s.active;
    if (!a) return;
    if (Date.now() - lastCompleteRef.current < 1200) return;
    lastCompleteRef.current = Date.now();
    const cfg = s.pomodoro;
    const actualSec = Math.round(
      a.bankedSec + (a.running ? (Date.now() - a.startedAt) / 1000 : 0),
    );

    if (a.phase === "focus") {
      const log: SessionLog = {
        id: `${a.id}-r${a.round}`,
        mode: "pomodoro",
        label: `Pomodoro · round ${a.round}`,
        subject: a.subject,
        startedAt: a.startedAt,
        endedAt: Date.now(),
        plannedSec: a.plannedSec,
        actualSec,
        completed: true,
        strict: a.strict,
        distractions: a.distractions,
        blocked: a.blocked,
        rating: null,
        roomId: a.roomId,
      };
      const longDue = a.round % cfg.roundsBeforeLong === 0;
      const phase = longDue ? "long" : "short";
      const plannedSec = (longDue ? cfg.longMin : cfg.shortMin) * 60;
      setState((prev) => {
        const sessions = [...prev.sessions, log];
        return {
          ...prev,
          sessions,
          streak: computeStreak(sessions, prev.streak),
          active: prev.active
            ? {
                ...prev.active,
                phase,
                plannedSec,
                bankedSec: 0,
                startedAt: Date.now(),
                running: cfg.autoStartBreaks,
                distractions: 0,
                blocked: 0,
              }
            : null,
        };
      });
      if (s.settings.notifications) {
        void notify(
          "Focus round complete 🎉",
          `Round ${a.round} banked. ${longDue ? `${cfg.longMin}m long break` : `${cfg.shortMin}m break`} time.`,
        );
      }
    } else {
      setState((prev) => ({
        ...prev,
        active: prev.active
          ? {
              ...prev.active,
              phase: "focus",
              plannedSec: cfg.focusMin * 60,
              bankedSec: 0,
              startedAt: Date.now(),
              running: cfg.autoStartFocus,
              round: prev.active.round + 1,
              distractions: 0,
              blocked: 0,
            }
          : null,
      }));
      if (s.settings.notifications) {
        void notify("Break finished ⏰", "Back to focus — you've got this.");
      }
    }
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      const stamp = Date.now();
      setNow(stamp);

      // 1. screen-time accrual for the foreground window
      const w = lastWindowRef.current;
      const last = usageTickRef.current;
      if (w && last) {
        const delta = clamp((stamp - last.at) / 1000, 0, 10);
        if (delta >= 1) {
          const meta = appMetaFor(w.process_name);
          accrueUsage(w.process_name, meta.label, meta.icon, "app", meta.category, delta);
          if (w.domain) {
            const webMeta = webMetaFor(w.domain);
            accrueUsage(w.domain, webMeta.label, webMeta.icon, "web", webMeta.category, delta);
          }
        }
      }
      usageTickRef.current = { at: stamp };

      // 2. multiplayer presence + simulated buddies (every 5 ticks)
      roomTickRef.current += 1;
      const s = stateRef.current;
      if (s.room && roomTickRef.current % 5 === 0) {
        const minutesHere = todayFocusedMinutes(s);
        setState((prev) => {
          if (!prev.room) return prev;
          const members = prev.room.members.map((m) =>
            m.isSelf ? { ...m, minutes: minutesHere, lastSeen: Date.now() } : m,
          );
          return { ...prev, room: { ...prev.room, members } };
        });
        const self = s.room.members.find((m) => m.isSelf);
        if (self) {
          roomRef.current?.progress({
            minutes: minutesHere,
            focusing: Boolean(s.active?.running),
            sessionSec: Math.round(elapsedFromRef(s)),
            distractions: s.active?.distractions ?? 0,
          });
        }
      }
      if (s.room && roomTickRef.current % 15 === 0) {
        setState((prev) =>
          prev.room
            ? {
                ...prev,
                room: {
                  ...prev.room,
                  members: tickBuddies(prev.room.members, 15),
                },
              }
            : prev,
        );
      }

      // 3. mirror the countdown to the native bridge so the extension badge is right
      if (roomTickRef.current % 5 === 0 && s.active) {
        void syncTimerToNative({
          mode: s.active.mode,
          remainingSec: s.active.plannedSec > 0 ? Math.max(0, Math.round(s.active.plannedSec - elapsedFromRef(s))) : 0,
          plannedSec: s.active.plannedSec,
          label: s.active.label,
        });
      }

      // 4. cross the daily goal → nudge once per day
      if (s.settings.notifications) {
        const mins = todayFocusedMinutes(s);
        const key = todayKey();
        if (mins >= s.settings.dailyGoalMinutes && goalHitRef.current !== key) {
          goalHitRef.current = key;
          void notify("Daily goal reached ✅", `${Math.round(mins)} minutes focused today.`);
        }
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [accrueUsage]);

  // session completion watch
  useEffect(() => {
    if (!active || !active.running || active.plannedSec <= 0) return;
    if (elapsedSec < active.plannedSec) return;
    if (active.mode === "pomodoro") advancePomodoro();
    else completeSession("completed");
  }, [active, elapsedSec, advancePomodoro, completeSession]);

  /* ------------------------ native sync + monitor -------------------- */

  useEffect(() => {
    void setFocusActiveNative(isFocusActive, strictActive);
  }, [isFocusActive, strictActive]);

  useEffect(() => {
    void syncBlocklistToNative(enabledProcesses);
  }, [enabledProcesses]);

  useEffect(() => {
    void syncWebBlocklistToNative(enabledDomains);
  }, [enabledDomains]);

  // reels / study-mode switches and the channel allow-list go to the extension
  const reelsBlocked = state.settings.blockReelsShorts;
  const studyMode = state.settings.youtubeStudyMode;
  const channels = state.channels;
  useEffect(() => {
    void syncExtensionSettings({
      reelsBlocked,
      studyMode,
      channels: channels.filter((c) => c.enabled).map((c) => c.handle),
    });
  }, [reelsBlocked, studyMode, channels]);

  const focusGuardEnabled = state.settings.focusGuard;

  useEffect(() => {
    const stop = startMonitor({
      blockedProcesses: enabledProcesses,
      blockedDomains: enabledDomains,
      active: isFocusActive && state.settings.blockDuringFocus,
      onWindow: (info) => {
        lastWindowRef.current = info;
        setCurrentWindow(info);
      },
      onBlocked: (info) => {
        const meta = info.domain ? webMetaFor(info.domain) : appMetaFor(info.process_name);
        const allowed = info.domain
          ? enabledDomains.includes(info.domain.toLowerCase())
          : enabledProcesses.includes(info.process_name.toLowerCase());
        if (!allowed) {
          // still surface the event so the UI can nudge, but do not log it as a block
          setCurrentWindow(info);
          return;
        }
        registerBlocked(info, info.domain ? "web" : "app", meta);
      },
    });
    return stop;
  }, [enabledProcesses, enabledDomains, isFocusActive, state.settings.blockDuringFocus, registerBlocked]);

  useEffect(() => {
    if (!focusGuardEnabled) setGuard(null);
  }, [focusGuardEnabled]);

  /* ----------------------------- sessions ---------------------------- */

  const startSession = useCallback((opts: NewSessionOptions) => {
    void requestNotificationPermission();
    setState((prev) => {
      if (prev.active) return prev;
      const strict = opts.strict ?? prev.settings.strictMode;
      const plannedSec =
        opts.plannedSec ??
        (opts.mode === "pomodoro"
          ? prev.pomodoro.focusMin * 60
          : opts.mode === "countdown"
            ? 25 * 60
            : 0);
      const session: ActiveSession = {
        id: uid(),
        mode: opts.mode,
        label:
          opts.label?.trim() ||
          (opts.mode === "pomodoro" ? "Pomodoro focus" : opts.mode === "study" ? "Study session" : "Focus session"),
        subject: opts.subject?.trim() || "General",
        startedAt: Date.now(),
        bankedSec: 0,
        plannedSec,
        running: true,
        pausedAt: null,
        strict,
        strictLevel: prev.settings.strictLevel,
        focusGuard: prev.settings.focusGuard,
        distractions: 0,
        blocked: 0,
        phase: "focus",
        round: 1,
        roomId: prev.room?.code ?? null,
        music: prev.settings.musicTrack,
      };
      return { ...prev, active: session };
    });
  }, []);

  const pauseSession = useCallback(() => {
    setState((prev) => {
      if (!prev.active || !prev.active.running) return prev;
      const bankedSec =
        prev.active.bankedSec + (Date.now() - prev.active.startedAt) / 1000;
      return {
        ...prev,
        active: { ...prev.active, running: false, bankedSec, pausedAt: Date.now() },
      };
    });
  }, []);

  const resumeSession = useCallback(() => {
    setState((prev) => {
      if (!prev.active || prev.active.running) return prev;
      return {
        ...prev,
        active: { ...prev.active, running: true, startedAt: Date.now(), pausedAt: null },
      };
    });
  }, []);

  const stopSession = useCallback(
    (reason: "user" | "gave-up" = "user") => {
      completeSession(reason);
    },
    [completeSession],
  );

  const abandonStrictSession = useCallback(() => {
    completeSession("emergency");
  }, [completeSession]);

  const rateSession = useCallback((id: string, rating: SessionLog["rating"]) => {
    setState((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s) =>
        s.id === id ? { ...s, rating: s.rating === rating ? null : rating } : s,
      ),
    }));
  }, []);

  const deleteSession = useCallback((id: string) => {
    setState((prev) => ({ ...prev, sessions: prev.sessions.filter((s) => s.id !== id) }));
  }, []);

  /* ------------------------------ rules ------------------------------ */

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setState((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }));
  }, []);

  const updatePomodoro = useCallback((patch: Partial<PomodoroConfig>) => {
    setState((prev) => ({ ...prev, pomodoro: { ...prev.pomodoro, ...patch } }));
  }, []);

  const toggleAppRule = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      appRules: prev.appRules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
    }));
  }, []);

  const toggleWebRule = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      webRules: prev.webRules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
    }));
  }, []);

  const setRuleMode = useCallback((id: string, kind: "app" | "web", mode: RuleMode) => {
    setState((prev) =>
      kind === "app"
        ? { ...prev, appRules: prev.appRules.map((r) => (r.id === id ? { ...r, mode } : r)) }
        : { ...prev, webRules: prev.webRules.map((r) => (r.id === id ? { ...r, mode } : r)) },
    );
  }, []);

  const addCustomApp = useCallback((process: string, label: string) => {
    const clean = process.trim().toLowerCase();
    if (!clean) return;
    const withExe = clean.endsWith(".exe") ? clean : `${clean}.exe`;
    setState((prev) => {
      if (prev.appRules.some((r) => r.process.toLowerCase() === withExe)) return prev;
      const rule: AppRule = {
        id: `app-custom-${uid()}`,
        process: withExe,
        name: label.trim() || withExe.replace(".exe", ""),
        icon: "🧩",
        category: "other",
        enabled: true,
        mode: "focus",
        custom: true,
      };
      return { ...prev, appRules: [...prev.appRules, rule] };
    });
  }, []);

  const addCustomWeb = useCallback((domain: string, label: string) => {
    const clean = domain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "");
    if (!clean) return;
    setState((prev) => {
      if (prev.webRules.some((r) => r.domain === clean)) return prev;
      const rule: WebRule = {
        id: `web-custom-${uid()}`,
        domain: clean,
        label: label.trim() || clean,
        icon: "🔗",
        category: "other",
        enabled: true,
        mode: "focus",
      };
      return { ...prev, webRules: [...prev.webRules, rule] };
    });
  }, []);

  const removeCustomRule = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      appRules: prev.appRules.filter((r) => r.id !== id || !r.custom),
      webRules: prev.webRules.filter((r) => r.id !== id || !r.custom),
    }));
  }, []);

  const toggleChannel = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      channels: prev.channels.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)),
    }));
  }, []);

  const addChannel = useCallback((handle: string) => {
    const clean = handle.trim();
    if (!clean) return;
    setState((prev) => ({
      ...prev,
      channels: [
        ...prev.channels,
        {
          id: `ch-${uid()}`,
          name: clean.replace(/^@/, ""),
          handle: clean.startsWith("@") ? clean : `@${clean}`,
          enabled: true,
        },
      ],
    }));
  }, []);

  const removeChannel = useCallback((id: string) => {
    setState((prev) => ({ ...prev, channels: prev.channels.filter((c) => c.id !== id) }));
  }, []);

  /* ------------------------------ planner ---------------------------- */

  const saveBlock = useCallback((block: FocusBlock) => {
    setState((prev) => {
      const exists = prev.blocks.some((b) => b.id === block.id);
      return {
        ...prev,
        blocks: exists ? prev.blocks.map((b) => (b.id === block.id ? block : b)) : [...prev.blocks, block],
      };
    });
  }, []);

  const deleteBlock = useCallback((id: string) => {
    setState((prev) => ({ ...prev, blocks: prev.blocks.filter((b) => b.id !== id) }));
  }, []);

  const toggleBlockDone = useCallback((id: string, dateKey: string) => {
    setState((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) =>
        b.id === id
          ? {
              ...b,
              completedOn: b.completedOn.includes(dateKey)
                ? b.completedOn.filter((d) => d !== dateKey)
                : [...b.completedOn, dateKey],
            }
          : b,
      ),
    }));
  }, []);

  /* ------------------------------- rooms ----------------------------- */

  const selfMember = useCallback(
    (name: string, avatar: string, targetMinutes: number): RoomMember => ({
      id: stateRef.current.selfId,
      name,
      avatar,
      minutes: todayFocusedMinutes(stateRef.current),
      targetMinutes,
      focusing: Boolean(stateRef.current.active?.running),
      sessionSec: Math.round(elapsedFromRef(stateRef.current)),
      distractions: stateRef.current.active?.distractions ?? 0,
      isSelf: true,
      joinedAt: Date.now(),
      lastSeen: Date.now(),
    }),
    [],
  );

  const createRoom = useCallback(
    (opts: { name: string; goalMinutes: number; bots: number }) => {
      const s = stateRef.current;
      const code = makeRoomCode();
      const me = selfMember(s.settings.nickname, s.settings.avatar, opts.goalMinutes);
      const room: RoomState = {
        id: uid(),
        code,
        name: opts.name.trim() || "Focus room",
        goalMinutes: opts.goalMinutes,
        hostId: me.id,
        createdAt: Date.now(),
        members: [me, ...makeBuddies(opts.bots, opts.goalMinutes)],
        chat: [
          {
            id: uid(),
            memberId: "system",
            name: "Regain",
            avatar: "✨",
            text: `Room ${code} created. Share the code so friends can join your focus block.`,
            at: Date.now(),
          },
        ],
      };
      setState((prev) => ({ ...prev, room }));
      return room;
    },
    [selfMember],
  );

  const joinRoom = useCallback(
    (code: string, opts: { name: string; goalMinutes: number }) => {
      const s = stateRef.current;
      const clean = code.trim().toUpperCase();
      const me = selfMember(s.settings.nickname, s.settings.avatar, opts.goalMinutes);
      const room: RoomState = {
        id: uid(),
        code: clean,
        name: opts.name.trim() || `Room ${clean}`,
        goalMinutes: opts.goalMinutes,
        hostId: "remote",
        createdAt: Date.now(),
        members: [me, ...makeBuddies(3, opts.goalMinutes)],
        chat: [
          {
            id: uid(),
            memberId: "system",
            name: "Regain",
            avatar: "✨",
            text: `You joined room ${clean}. Everyone's focus time shows up live on the leaderboard.`,
            at: Date.now(),
          },
        ],
      };
      setState((prev) => ({ ...prev, room }));
      return room;
    },
    [selfMember],
  );

  const leaveRoom = useCallback(() => {
    roomRef.current?.close();
    roomRef.current = null;
    setRoomStatus("local");
    setState((prev) => ({ ...prev, room: null }));
  }, []);

  // room transport lifecycle
  const roomCode = state.room?.code ?? null;
  useEffect(() => {
    if (!roomCode) return;
    const room = stateRef.current.room;
    if (!room) return;
    const self = room.members.find((m) => m.isSelf);
    if (!self) return;
    const transport = connectRoom({
      room,
      self,
      relayUrl: stateRef.current.settings.roomServerUrl || undefined,
      onStatus: setRoomStatus,
      onMembers: (members) =>
        setState((prev) => {
          if (!prev.room) return prev;
          const me = prev.room.members.find((m) => m.isSelf);
          // The relay echoes our own presence back; drop it (and any duplicate
          // id) so React keys stay unique and we never render ourselves twice.
          const seen = new Set<string>();
          const remote = members.filter((m) => {
            if (!m?.id || m.isSelf || m.id === me?.id || seen.has(m.id)) return false;
            seen.add(m.id);
            return true;
          });
          return { ...prev, room: { ...prev.room, members: me ? [me, ...remote] : remote } };
        }),
      onChat: (chat) =>
        setState((prev) => (prev.room ? { ...prev, room: { ...prev.room, chat } } : prev)),
    });
    roomRef.current = transport;
    return () => {
      transport.close();
      roomRef.current = null;
    };
  }, [roomCode]);

  const sendChat = useCallback((text: string) => {
    const clean = text.trim();
    if (!clean) return;
    const s = stateRef.current;
    if (!s.room) return;
    const me = s.room.members.find((m) => m.isSelf);
    const msg = {
      id: uid(),
      memberId: me?.id ?? "me",
      name: me?.name ?? s.settings.nickname,
      avatar: me?.avatar ?? s.settings.avatar,
      text: clean,
      at: Date.now(),
    };
    setState((prev) =>
      prev.room ? { ...prev, room: { ...prev.room, chat: [...prev.room.chat, msg] } } : prev,
    );
    roomRef.current?.send(clean);
  }, []);

  const sendReaction = useCallback((emoji: string) => {
    const s = stateRef.current;
    const me = s.room?.members.find((m) => m.isSelf);
    if (!s.room || !me) return;
    setState((prev) => {
      if (!prev.room) return prev;
      return {
        ...prev,
        room: {
          ...prev.room,
          members: prev.room.members.map((m) =>
            m.id === me.id
              ? { ...m, reactions: { ...(m.reactions ?? {}), [emoji]: (m.reactions?.[emoji] ?? 0) + 1 } }
              : m,
          ),
        },
      };
    });
    roomRef.current?.react(emoji);
  }, []);

  /* ------------------------------- misc ------------------------------ */

  const dismissGuard = useCallback(() => {
    setGuard(null);
    void hideBlockerWindow();
  }, []);

  const clearGuardAndReturn = useCallback(() => {
    setGuard(null);
    void hideBlockerWindow();
    if (!stateRef.current.active) {
      startSession({ mode: "study" });
    }
  }, [startSession]);

  const clearDemoData = useCallback(() => {
    setState((prev) => ({ ...prev, sessions: [], usage: [], blockedLog: [], demoData: false }));
  }, []);

  const resetAllData = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    const fresh = initialState(isTauri() ? "tauri" : "browser");
    setState(isTauri() ? fresh : seedDemoState(fresh));
    setGuard(null);
    roomRef.current?.close();
    roomRef.current = null;
  }, []);

  const markWelcomeSeen = useCallback(() => {
    setState((prev) => ({ ...prev, seenWelcome: true }));
  }, []);

  const value: StoreValue = {
    state,
    now,
    elapsedSec,
    remainingSec,
    isFocusActive,
    isPaused,
    strictActive,
    canStop,
    currentWindow,
    guard,
    roomStatus,
    today,
    todayFocusedSec,
    todaySessions,
    actions: {
      updateSettings,
      updatePomodoro,
      startSession,
      pauseSession,
      resumeSession,
      stopSession,
      abandonStrictSession,
      rateSession,
      deleteSession,
      toggleAppRule,
      toggleWebRule,
      setRuleMode,
      addCustomApp,
      addCustomWeb,
      removeCustomRule,
      toggleChannel,
      addChannel,
      removeChannel,
      saveBlock,
      deleteBlock,
      toggleBlockDone,
      createRoom,
      joinRoom,
      leaveRoom,
      sendChat,
      sendReaction,
      dismissGuard,
      clearGuardAndReturn,
      resetAllData,
      clearDemoData,
      markWelcomeSeen,
    },
  };

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

/* ------------------------------------------------------------------ */
/* module-level helpers                                                */
/* ------------------------------------------------------------------ */

function elapsedFromRef(s: PersistedState) {
  const a = s.active;
  if (!a) return 0;
  return a.bankedSec + (a.running ? (Date.now() - a.startedAt) / 1000 : 0);
}

function todayFocusedMinutes(s: PersistedState) {
  const key = todayKey();
  const secs = s.sessions
    .filter((x) => todayKey(new Date(x.endedAt)) === key)
    .reduce((acc, x) => acc + x.actualSec, 0);
  return Math.floor(secs / 60) + Math.floor(elapsedFromRef(s) / 60);
}

const APP_META_FALLBACK = { label: "App", icon: "🪟", category: "other" as const };

export function appMetaFor(processName: string) {
  const key = processName.toLowerCase();
  const known = KNOWN_APPS.find((a) => a.key === key);
  if (known) return known;
  return {
    label: processName.replace(/\.exe$/i, ""),
    icon: APP_META_FALLBACK.icon,
    category: APP_META_FALLBACK.category,
  };
}

export function webMetaFor(domain: string) {
  const key = domain.toLowerCase();
  const known = KNOWN_SITES.find((s) => key === s.key || key.endsWith(`.${s.key}`));
  if (known) return known;
  return { label: domain, icon: "🔗", category: "other" as UsageSlice["category"] };
}

const KNOWN_APPS: Array<{ key: string; label: string; icon: string; category: UsageSlice["category"] }> = [
  { key: "chrome.exe", label: "Google Chrome", icon: "🌐", category: "other" },
  { key: "msedge.exe", label: "Microsoft Edge", icon: "🌊", category: "other" },
  { key: "firefox.exe", label: "Firefox", icon: "🦊", category: "other" },
  { key: "code.exe", label: "VS Code", icon: "🧑‍💻", category: "study" },
  { key: "discord.exe", label: "Discord", icon: "💬", category: "chat" },
  { key: "whatsapp.exe", label: "WhatsApp", icon: "🟢", category: "chat" },
  { key: "tiktok.exe", label: "TikTok", icon: "🎵", category: "social" },
  { key: "instagram.exe", label: "Instagram", icon: "📸", category: "social" },
  { key: "steam.exe", label: "Steam", icon: "🎮", category: "games" },
  { key: "winword.exe", label: "Microsoft Word", icon: "📄", category: "study" },
  { key: "excel.exe", label: "Microsoft Excel", icon: "📊", category: "study" },
  { key: "powerpnt.exe", label: "PowerPoint", icon: "📽️", category: "study" },
  { key: "notion.exe", label: "Notion", icon: "📓", category: "study" },
  { key: "obsidian.exe", label: "Obsidian", icon: "🪨", category: "study" },
  { key: "spotify.exe", label: "Spotify", icon: "🎧", category: "video" },
  { key: "explorer.exe", label: "File Explorer", icon: "🗂️", category: "other" },
  { key: "telegram.exe", label: "Telegram", icon: "✈️", category: "chat" },
];

const KNOWN_SITES: Array<{ key: string; label: string; icon: string; category: UsageSlice["category"] }> = [
  { key: "youtube.com", label: "YouTube", icon: "▶️", category: "video" },
  { key: "instagram.com", label: "Instagram", icon: "📸", category: "social" },
  { key: "tiktok.com", label: "TikTok", icon: "🎵", category: "social" },
  { key: "reddit.com", label: "Reddit", icon: "👽", category: "social" },
  { key: "x.com", label: "X", icon: "🐦", category: "social" },
  { key: "facebook.com", label: "Facebook", icon: "📘", category: "social" },
  { key: "netflix.com", label: "Netflix", icon: "🍿", category: "video" },
  { key: "docs.google.com", label: "Google Docs", icon: "📝", category: "study" },
  { key: "classroom.google.com", label: "Google Classroom", icon: "🏫", category: "study" },
  { key: "khanacademy.org", label: "Khan Academy", icon: "🎓", category: "study" },
  { key: "stackoverflow.com", label: "Stack Overflow", icon: "🧱", category: "study" },
  { key: "chatgpt.com", label: "ChatGPT", icon: "🤖", category: "study" },
  { key: "wikipedia.org", label: "Wikipedia", icon: "📚", category: "study" },
];
