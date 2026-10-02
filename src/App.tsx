import { useEffect, useMemo, useRef, useState } from "react";
import { AppStoreProvider, useStore } from "./store/AppStore";
import { Shell } from "./components/Shell";
import { FocusGuard } from "./components/FocusGuard";
import { listenSafe } from "./lib/desktop";
import { Modal, useToasts } from "./components/ui";
import { FocusPage } from "./pages/FocusPage";
import { PomodoroPage } from "./pages/PomodoroPage";
import { PlannerPage } from "./pages/PlannerPage";
import { BlockingPage } from "./pages/BlockingPage";
import { ScreenTimePage } from "./pages/ScreenTimePage";
import { RoomsPage } from "./pages/RoomsPage";
import { MusicPage } from "./pages/MusicPage";
import { ThemesPage } from "./pages/ThemesPage";
import { InsightsPage } from "./pages/InsightsPage";
import { StrictPage } from "./pages/StrictPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ProPage } from "./pages/ProPage";
import { ambient } from "./lib/audio";
import { WALLPAPERS, SOUNDS } from "./lib/defaults";
import { ALL_NAV_ITEMS, type PageId } from "./lib/nav";
import { fmtClock } from "./lib/utils";
import type { ThemeId } from "./lib/types";

/* ------------------------------- theming -------------------------------- */

const DARK_BASE: Record<string, string> = {
  "--bg": "#0a0a14",
  "--bg-2": "#101024",
  "--panel": "rgba(24,24,44,.72)",
  "--panel-solid": "#171729",
  "--text": "#eceaff",
  "--muted": "#9c9ab8",
};

const THEME_VARS: Record<ThemeId, Record<string, string>> = {
  midnight: { ...DARK_BASE, "--panel": "rgba(26,24,54,.74)", "--panel-solid": "#1a1836" },
  amoled: {
    ...DARK_BASE,
    "--bg": "#000000",
    "--bg-2": "#050508",
    "--panel": "rgba(10,10,16,.82)",
    "--panel-solid": "#0b0b12",
    "--border": "rgba(255,255,255,.11)",
    "--muted": "#8e8ca8",
  },
  forest: {
    ...DARK_BASE,
    "--bg": "#061914",
    "--bg-2": "#0a261e",
    "--panel": "rgba(12,43,35,.72)",
    "--panel-solid": "#0d3329",
    "--text": "#e6fff6",
    "--muted": "#8fbdae",
  },
  ocean: {
    ...DARK_BASE,
    "--bg": "#03131f",
    "--bg-2": "#062033",
    "--panel": "rgba(9,38,59,.72)",
    "--panel-solid": "#0a2a41",
    "--text": "#e5f6ff",
    "--muted": "#8fb4c9",
  },
  sunset: {
    ...DARK_BASE,
    "--bg": "#1c0a14",
    "--bg-2": "#2a0f1f",
    "--panel": "rgba(58,20,40,.72)",
    "--panel-solid": "#3a1428",
    "--text": "#ffeaf2",
    "--muted": "#c39aae",
  },
  aurora: {
    ...DARK_BASE,
    "--bg": "#070d1c",
    "--bg-2": "#0c1730",
    "--panel": "rgba(16,32,60,.72)",
    "--panel-solid": "#102039",
    "--text": "#e8f6ff",
    "--muted": "#93a9c7",
  },
  light: {},
};

function useTheme() {
  const { state } = useStore();
  const { theme, accent, wallpaper } = state.settings;

  useEffect(() => {
    const root = document.documentElement;
    Object.entries(THEME_VARS[theme]).forEach(([k, v]) => root.style.setProperty(k, v));
    if (theme === "light") {
      root.dataset.theme = "light";
    } else {
      delete root.dataset.theme;
      root.removeAttribute("data-theme");
    }
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-2", mixHex(accent, "#ffffff", 0.35));
    const wp = WALLPAPERS.find((w) => w.id === wallpaper);
    if (wp) root.style.setProperty("--wallpaper", wp.css);
  }, [theme, accent, wallpaper]);
}

function mixHex(hex: string, target: string, amount: number) {
  const a = hex.replace("#", "");
  const b = target.replace("#", "");
  const pa = [0, 2, 4].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [0, 2, 4].map((i) => parseInt(b.slice(i, i + 2), 16));
  const mixed = pa.map((v, i) => Math.round(v + (pb[i] - v) * amount));
  return `#${mixed.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/* ------------------------------ page router ----------------------------- */

function Page({ id }: { id: PageId }) {
  switch (id) {
    case "focus":
      return <FocusPage />;
    case "pomodoro":
      return <PomodoroPage />;
    case "planner":
      return <PlannerPage />;
    case "blocking":
      return <BlockingPage />;
    case "screentime":
      return <ScreenTimePage />;
    case "insights":
      return <InsightsPage />;
    case "rooms":
      return <RoomsPage />;
    case "music":
      return <MusicPage />;
    case "themes":
      return <ThemesPage />;
    case "strict":
      return <StrictPage />;
    case "settings":
      return <SettingsPage />;
    case "pro":
      return <ProPage />;
    default:
      return <FocusPage />;
  }
}

/* ------------------------------ app content ----------------------------- */

function AppContent() {
  const { state, actions, elapsedSec, isFocusActive, guard } = useStore();
  const { push, node } = useToasts();
  const [page, setPage] = useState<PageId>(() => {
    const hash = window.location.hash.replace("#", "");
    return (ALL_NAV_ITEMS.find((i) => i.id === hash)?.id ?? "focus") as PageId;
  });

  useTheme();

  // deep-link / tray routing
  useEffect(() => {
    const onHash = () => {
      const hash = window.location.hash.replace("#", "");
      const match = ALL_NAV_ITEMS.find((i) => i.id === hash);
      if (match) setPage(match.id);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // session + blocker event toasts and chimes
  const [showShortcuts, setShowShortcuts] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const guardOpenRef = useRef(false);
  guardOpenRef.current = Boolean(guard);
  const sessionCount = useRef(state.sessions.length);
  const blockedCount = useRef(state.blockedLog.length);
  useEffect(() => {
    if (state.sessions.length > sessionCount.current) {
      const last = state.sessions[state.sessions.length - 1];
      sessionCount.current = state.sessions.length;
      push({
        title: last.completed ? "Session complete 🎉" : "Session logged",
        body: `${Math.round(last.actualSec / 60)} min · ${last.subject}`,
        tone: last.completed ? "good" : "info",
      });
      if (state.settings.tickSound) ambient.cue("complete");
    }
  }, [state.sessions, push, state.settings.tickSound]);

  useEffect(() => {
    if (state.blockedLog.length > blockedCount.current) {
      const last = state.blockedLog[state.blockedLog.length - 1];
      blockedCount.current = state.blockedLog.length;
      push({ title: `${last.icon} ${last.label} blocked`, body: "Focus protected.", tone: "bad" });
      if (state.settings.tickSound) ambient.cue("phase");
    }
  }, [state.blockedLog, push, state.settings.tickSound]);

  // Focus Guard / planner reminders surface as toasts (and native notifications)
  const reminderCount = useRef(state.reminders.length);
  useEffect(() => {
    if (state.reminders.length > reminderCount.current) {
      const last = state.reminders[state.reminders.length - 1];
      reminderCount.current = state.reminders.length;
      push({
        title: last.title,
        body: last.body,
        tone: last.kind === "planner" ? "good" : "info",
      });
      if (state.settings.tickSound) ambient.cue("phase");
    }
  }, [state.reminders, push, state.settings.tickSound]);

  // pomodoro phase change chime
  const phaseRef = useRef(state.active?.phase);
  useEffect(() => {
    const phase = state.active?.phase;
    if (phase && phaseRef.current && phase !== phaseRef.current && state.settings.tickSound) {
      ambient.cue(phase === "focus" ? "phase" : "complete");
    }
    phaseRef.current = phase;
  }, [state.active?.phase, state.settings.tickSound]);

  // stop music when the session ends
  useEffect(() => {
    if (!isFocusActive && !state.settings.musicTrack) ambient.stop();
  }, [isFocusActive, state.settings.musicTrack]);

  // ---------------------------- keyboard shortcuts ---------------------------
  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    };

    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      const current = stateRef.current;

      if (event.key === "Escape") {
        if (guardOpenRef.current) {
          event.preventDefault();
          actions.dismissGuard();
        }
        return;
      }

      if (event.key === " ") {
        event.preventDefault();
        if (current.active?.running) actions.pauseSession();
        else if (current.active) actions.resumeSession();
        else actions.startSession({ mode: "countdown", plannedSec: 25 * 60, label: "Quick focus" });
        return;
      }

      if (event.key.toLowerCase() === "m") {
        const track = current.settings.musicTrack;
        const sound = SOUNDS.find((s) => s.id === track);
        if (sound && (!sound.pro || current.settings.pro)) {
          if (ambient.current()) ambient.stop();
          else ambient.play(sound.kind, current.settings.musicVolume);
        }
        return;
      }

      if (event.key === "?") {
        event.preventDefault();
        setShowShortcuts(true);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions]);

  // native notifications emitted by the Rust core land as toasts
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listenSafe<{ title: string; body: string }>("regain-notify", (payload) => {
      push({ title: payload.title, body: payload.body });
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [push]);

  // keep the tab title in sync — useful when the window is minimised
  useEffect(() => {
    const base = "Regain — Focus & Digital Wellbeing";
    document.title = isFocusActive
      ? `${Math.floor(elapsedSec / 60)}:${String(Math.floor(elapsedSec % 60)).padStart(2, "0")} · focusing`
      : base;
  }, [isFocusActive, elapsedSec]);

  const welcome = !state.seenWelcome;
  const soundOptions = useMemo(() => SOUNDS.filter((s) => !s.pro || state.settings.pro), [state.settings.pro]);

  function navigate(id: PageId) {
    setPage(id);
    if (window.location.hash !== `#${id}`) {
      window.history.replaceState(null, "", `#${id}`);
    }
  }

  return (
    <>
      <Shell page={page} onNavigate={navigate} toasts={node}>
        <Page id={page} />
      </Shell>
      <FocusGuard />

      <Modal
        open={welcome}
        onClose={actions.markWelcomeSeen}
        title="Welcome to Regain for PC 👋"
        wide
        footer={
          <button className="btn primary" onClick={actions.markWelcomeSeen}>
            Start focusing
          </button>
        }
      >
        <p className="small muted" style={{ lineHeight: 1.7 }}>
          Regain is a focus and digital-wellbeing app: strict app blocking, Pomodoro timers,
          multiplayer study rooms, screen-time tracking, and Reels/Shorts blocking that still allows
          educational content.
        </p>
        <div className="grid cols-2" style={{ gap: 12, marginTop: 16 }}>
          {[
            { icon: "⏱️", title: "Focus Timer", body: "Study, stopwatch and countdown sessions with live blocking." },
            { icon: "🍅", title: "Pomodoro", body: "Adjustable focus and break cycles." },
            { icon: "🚫", title: "Block apps & sites", body: "Distractions are minimised the moment they appear." },
            { icon: "👥", title: "Study rooms", body: "Focus with friends on a shared leaderboard." },
          ].map((c) => (
            <div key={c.title} className="list-row" style={{ border: "none", padding: "6px 0" }}>
              <div className="icon">{c.icon}</div>
              <div className="meta">
                <div className="title">{c.title}</div>
                <div className="sub">{c.body}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="grid cols-2" style={{ gap: 12, marginTop: 16 }}>
          <label>
            <div className="stat-label" style={{ marginBottom: 6 }}>Your name</div>
            <input
              className="input"
              value={state.settings.nickname}
              onChange={(e) => actions.updateSettings({ nickname: e.target.value })}
            />
          </label>
          <label>
            <div className="stat-label" style={{ marginBottom: 6 }}>Daily focus goal (minutes)</div>
            <input
              className="input"
              type="number"
              min={30}
              max={600}
              step={15}
              value={state.settings.dailyGoalMinutes}
              onChange={(e) => actions.updateSettings({ dailyGoalMinutes: Number(e.target.value) })}
            />
          </label>
        </div>

        <div className="row" style={{ gap: 12, marginTop: 14 }}>
          <div className="stat-label">Default soundscape</div>
          <select
            className="select"
            style={{ width: 220 }}
            value={state.settings.musicTrack}
            onChange={(e) => actions.updateSettings({ musicTrack: e.target.value })}
          >
            <option value="">None</option>
            {soundOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.icon} {s.name}
              </option>
            ))}
          </select>
        </div>
      </Modal>

      <Modal
        open={showShortcuts}
        onClose={() => setShowShortcuts(false)}
        title="Keyboard shortcuts"
      >
        <div className="grid" style={{ gap: 10 }}>
          {[
            ["Space", "Start a quick 25 min session, pause or resume"],
            ["M", "Toggle your soundscape on and off"],
            ["Esc", "Dismiss the Focus Guard overlay"],
            ["?", "Show this list"],
          ].map(([keys, what]) => (
            <div className="row" key={keys} style={{ gap: 12 }}>
              <span className="chip accent mono" style={{ minWidth: 74, justifyContent: "center" }}>
                {keys}
              </span>
              <span className="small">{what}</span>
            </div>
          ))}
        </div>
        <p className="small muted" style={{ marginTop: 14 }}>
          Shortcuts are ignored while you are typing in a field, so they never eat your session notes.
        </p>
      </Modal>
    </>
  );
}

/* ------------------------- dedicated blocker window --------------------- */

function BlockerWindow() {
  const { state, actions, elapsedSec, remainingSec, canStop } = useStore();
  const active = state.active;
  const [payload, setPayload] = useState<{ app: string; title: string } | null>(null);

  // The main window pushes the offending app into this overlay window.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listenSafe<{ app: string; title: string }>("blocker-payload", setPayload).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  return (
    <div className="guard" style={{ position: "fixed" }}>
      <div>
        <div className="big">🛡️</div>
        <h2>Focus Guard</h2>
        <p className="muted">
          {payload
            ? `${payload.app} is blocked${payload.title ? ` — “${payload.title}”` : ""}.`
            : "A distraction was intercepted."}{" "}
          {state.blockedLog.length} today.
        </p>
        <div className="hero-time" style={{ fontSize: 54, margin: "14px 0" }}>
          {active ? fmtClock(active.plannedSec > 0 ? remainingSec : elapsedSec) : "--:--"}
        </div>
        <div className="row" style={{ justifyContent: "center", gap: 12 }}>
          <button className="btn primary lg" onClick={() => actions.dismissGuard()}>
            Back to studying
          </button>
          <button
            className="btn lg danger"
            disabled={!canStop || !active}
            onClick={() => actions.stopSession("gave-up")}
          >
            End session
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const isBlocker = typeof window !== "undefined" && window.location.hash === "#blocker";
  return (
    <AppStoreProvider>
      {isBlocker ? <BlockerWindow /> : <AppContent />}
    </AppStoreProvider>
  );
}
