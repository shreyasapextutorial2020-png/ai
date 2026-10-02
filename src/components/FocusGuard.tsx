import { useEffect } from "react";
import { useStore } from "../store/AppStore";
import { fmtClock } from "../lib/utils";

/**
 * Full-screen interception overlay — shown when a distraction is caught during
 * a focus session. In the packaged desktop app this renders inside the
 * dedicated always-on-top `blocker` window; in the browser preview it renders
 * over the current page.
 */
export function FocusGuard() {
  const { guard, state, elapsedSec, remainingSec, actions, canStop } = useStore();
  const active = state.active;

  useEffect(() => {
    if (!guard) return;
    void import("../lib/audio").then(({ ambient }) => ambient.cue("warn"));
  }, [guard]);

  if (!guard) return null;

  return (
    <div className="guard">
      <div>
        <div className="big">{guard.icon}</div>
        <h2>{guard.label} is blocked</h2>
        <p className="muted" style={{ maxWidth: 560, margin: "0 auto 4px" }}>
          {guard.title
            ? `Regain caught "${guard.title}" during your focus session.`
            : "Regain caught a distraction during your focus session."}
        </p>
        <p className="muted small" style={{ maxWidth: 520, margin: "0 auto 18px" }}>
          Nothing was read from your screen — the window title and process name only. That is
          attempt #{state.blockedLog.length} today.
        </p>

        {active && (
          <div style={{ margin: "0 auto 20px" }}>
            <div className="stat-label">
              {active.plannedSec > 0 ? "Time remaining" : "Focusing for"}
            </div>
            <div className="hero-time" style={{ fontSize: 46, marginTop: 6 }}>
              {fmtClock(active.plannedSec > 0 ? remainingSec : elapsedSec)}
            </div>
          </div>
        )}

        <div className="row" style={{ justifyContent: "center", gap: 12 }}>
          <button className="btn primary lg" onClick={actions.dismissGuard}>
            ✅ Back to studying
          </button>
          <button className="btn lg" onClick={actions.clearGuardAndReturn} disabled={!active}>
            ⏱️ Restart a focus session
          </button>
          <button
            className="btn lg danger"
            disabled={!active || !canStop}
            title={canStop ? "" : "Strict level 3 ends only when the timer hits zero"}
            onClick={() => actions.stopSession("gave-up")}
          >
            🏳️ End session early
          </button>
        </div>

        <p className="tiny muted" style={{ marginTop: 22 }}>
          {state.settings.strictMode && active?.strict
            ? "Strict Mode is on — ending early is logged and shown on your Progress page."
            : "Tip: turn on Strict Mode to make quitting early impossible."}
        </p>
      </div>
    </div>
  );
}
