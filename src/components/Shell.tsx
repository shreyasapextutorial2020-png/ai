import type { ReactNode } from "react";
import { NAV, navItem, type PageId } from "../lib/nav";
import { useStore } from "../store/AppStore";
import { fmtClock, fmtShort } from "../lib/utils";
import { Chip } from "./ui";

function GlobalSessionBar() {
  const { state, elapsedSec, isFocusActive, actions, strictActive, canStop } = useStore();
  const active = state.active;
  if (!active) return null;
  const planned = active.plannedSec;
  const progress = planned > 0 ? elapsedSec / planned : 0;

  return (
    <div className="row" style={{ gap: 10 }}>
      <Chip tone={active.phase === "focus" || active.mode !== "pomodoro" ? "accent" : "good"}>
        {isFocusActive ? "●" : "❚❚"} {active.mode === "pomodoro" ? `${active.phase} · r${active.round}` : active.mode}
      </Chip>
      <span className="mono" style={{ fontSize: 16, fontWeight: 650 }}>
        {planned > 0 ? fmtClock(Math.max(0, planned - elapsedSec)) : fmtClock(elapsedSec)}
      </span>
      {strictActive && <Chip tone="bad">🔒 strict</Chip>}
      {isFocusActive ? (
        <button className="btn sm" onClick={actions.pauseSession}>
          Pause
        </button>
      ) : (
        <button className="btn sm primary" onClick={actions.resumeSession}>
          Resume
        </button>
      )}
      <button
        className="btn sm danger"
        disabled={!canStop}
        title={canStop ? "End session" : "Strict level 3 blocks stopping until the timer ends"}
        onClick={() => actions.stopSession("user")}
      >
        {canStop ? "End" : "Locked"}
      </button>
      {planned > 0 && (
        <div className="bar" style={{ width: 90 }}>
          <span style={{ width: `${Math.min(100, progress * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

export function Shell({
  page,
  onNavigate,
  children,
  toasts,
}: {
  page: PageId;
  onNavigate: (id: PageId) => void;
  children: ReactNode;
  toasts?: ReactNode;
}) {
  const { state, todayFocusedSec, actions, isFocusActive } = useStore();
  const item = navItem(page);
  const goalPct = Math.min(
    100,
    Math.round((todayFocusedSec / 60 / Math.max(1, state.settings.dailyGoalMinutes)) * 100),
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">⏳</div>
          <div className="brand-text">
            <div className="brand-name">Regain</div>
            <div className="brand-sub">for PC</div>
          </div>
        </div>

        {NAV.map((group) => (
          <div key={group.label}>
            <div className="nav-group-label">{group.label}</div>
            {group.items.map((nav) => (
              <button
                key={nav.id}
                className={`nav-item ${page === nav.id ? "active" : ""}`}
                onClick={() => onNavigate(nav.id)}
                title={nav.label}
              >
                <span className="nav-icon">{nav.icon}</span>
                <span className="nav-label">{nav.label}</span>
                {nav.pro && !state.settings.pro && <span className="nav-badge">PRO</span>}
              </button>
            ))}
          </div>
        ))}

        <div className="sidebar-footer">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span>Today</span>
            <strong className="mono">{fmtShort(todayFocusedSec)}</strong>
          </div>
          <div className="bar" style={{ margin: "8px 0 6px" }}>
            <span style={{ width: `${goalPct}%` }} />
          </div>
          <div className="tiny">
            {goalPct}% of {fmtShort(state.settings.dailyGoalMinutes * 60)} goal · 🔥 {state.streak.current}d streak
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <h1>{item.title}</h1>
            <div className="sub">{item.subtitle}</div>
          </div>
          <div className="topbar-spacer" />
          <GlobalSessionBar />
          {!isFocusActive && (
            <button className="btn sm primary" onClick={() => actions.startSession({ mode: "study" })}>
              ▶ Start focus
            </button>
          )}
          {state.settings.pro ? (
            <Chip tone="accent">✨ Pro</Chip>
          ) : (
            <button className="btn sm" onClick={() => onNavigate("pro")}>
              ✨ Go Pro
            </button>
          )}
        </header>
        <main className="content">{children}</main>
      </div>
      {toasts}
    </div>
  );
}
