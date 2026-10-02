import { useMemo } from "react";
import { useStore } from "../store/AppStore";
import { Card, Chip, Stat, Toggle } from "../components/ui";
import { fmtDate, fmtShort } from "../lib/utils";
import { isTauri } from "../lib/desktop";

const LEVELS: Array<{ level: 1 | 2 | 3; name: string; blurb: string; detail: string }> = [
  {
    level: 1,
    name: "Firm",
    blurb: "One extra confirmation before you quit",
    detail:
      "Ending a session requires a deliberate confirmation and starts a 30 second cool-down. Great for casual days.",
  },
  {
    level: 2,
    name: "Locked",
    blurb: "Hold to quit for 5 seconds",
    detail:
      "The end button only works if you press and hold it for five seconds. Most impulses die in three.",
  },
  {
    level: 3,
    name: "Hardcore",
    blurb: "Cannot be stopped until the timer ends",
    detail:
      "The session runs to zero. Closing the window, killing the app or restarting the machine resumes the countdown on launch. Only an logged emergency exit escapes.",
  },
];

export function StrictPage() {
  const { state, actions, isFocusActive, strictActive, canStop } = useStore();
  const settings = state.settings;

  const strictSessions = useMemo(
    () => state.sessions.filter((s) => s.strict),
    [state.sessions],
  );
  const bailouts = strictSessions.filter((s) => !s.completed).length;
  const completionRate = strictSessions.length
    ? Math.round(((strictSessions.length - bailouts) / strictSessions.length) * 100)
    : 100;

  return (
    <div className="grid cols-2" style={{ gap: 16, alignItems: "start" }}>
      <div className="grid" style={{ gap: 16 }}>
        <Card head="Strict Mode" hint="Discipline when willpower runs out">
          <div className="row" style={{ gap: 14, marginBottom: 16 }}>
            <Toggle
              on={settings.strictMode}
              disabled={!settings.pro}
              onChange={(v) => actions.updateSettings({ strictMode: v })}
            />
            <div>
              <div style={{ fontWeight: 600 }}>
                {settings.pro ? "Enable Strict Mode for new sessions" : "Strict Mode is a Pro feature 🔒"}
              </div>
              <div className="small muted">
                Every focus session you start will inherit the strictness level below.
              </div>
            </div>
          </div>

          <div className="grid" style={{ gap: 10 }}>
            {LEVELS.map((l) => {
              const selected = settings.strictLevel === l.level;
              return (
                <button
                  key={l.level}
                  className="sound-card"
                  style={
                    selected
                      ? { borderColor: "color-mix(in srgb, var(--accent) 60%, transparent)", background: "color-mix(in srgb, var(--accent) 14%, transparent)" }
                      : undefined
                  }
                  onClick={() => settings.pro && actions.updateSettings({ strictLevel: l.level })}
                >
                  <div className="row" style={{ gap: 10 }}>
                    <span style={{ fontSize: 20 }}>
                      {l.level === 1 ? "🟡" : l.level === 2 ? "🟠" : "🔴"}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <strong style={{ fontSize: 14 }}>Level {l.level} · {l.name}</strong>
                        {selected && <Chip tone="accent">active</Chip>}
                        {!settings.pro && <Chip>pro</Chip>}
                      </div>
                      <div className="small muted" style={{ marginTop: 2 }}>{l.blurb}</div>
                      {selected && (
                        <div className="tiny muted" style={{ marginTop: 6 }}>{l.detail}</div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        <Card head="Anti-uninstall guard" hint="Protects the app while a strict session runs">
          <div className="row" style={{ gap: 14 }}>
            <Toggle
              on={settings.hardcoreUninstallGuard}
              disabled={!settings.pro}
              onChange={(v) => actions.updateSettings({ hardcoreUninstallGuard: v })}
            />
            <div className="small muted">
              Registers a Windows run-once entry and blocks the uninstaller during active strict
              sessions. On mobile builds this maps to the Screen Time / Accessibility guard.
            </div>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 14 }}>
            <Chip tone={isTauri() ? "good" : "warn"}>
              {isTauri() ? "native guard available" : "desktop build required"}
            </Chip>
            <Chip>extension bridge: port 48123</Chip>
          </div>
        </Card>
      </div>

      <div className="grid" style={{ gap: 16 }}>
        <Card head="Your strict record">
          <div className="grid cols-3" style={{ gap: 14 }}>
            <Stat label="Strict sessions" value={strictSessions.length} icon="🔒" />
            <Stat label="Finished" value={`${completionRate}%`} icon="✅" />
            <Stat label="Bailouts" value={bailouts} icon="🏳️" />
          </div>
          <div className="list" style={{ marginTop: 14 }}>
            {[...strictSessions].reverse().slice(0, 5).map((s) => (
              <div className="list-row" key={s.id}>
                <div className="icon">{s.completed ? "✅" : "🏳️"}</div>
                <div className="meta">
                  <div className="title">{s.label} · {s.subject}</div>
                  <div className="sub">
                    {fmtDate(s.endedAt)} · {fmtShort(s.actualSec)} · {s.blocked} blocked
                  </div>
                </div>
                <Chip tone={s.completed ? "good" : "warn"}>
                  {s.completed ? "completed" : "ended early"}
                </Chip>
              </div>
            ))}
            {strictSessions.length === 0 && (
              <div className="small muted" style={{ padding: 10 }}>
                No strict sessions yet — start one to build the record.
              </div>
            )}
          </div>
        </Card>

        <Card head="Try it now">
          <p className="small muted" style={{ lineHeight: 1.7 }}>
            A strict session locks the timer, hides every escape hatch and logs the outcome on your
            Progress page. Right now:
          </p>
          <div className="row wrap" style={{ gap: 8, margin: "12px 0" }}>
            <Chip tone={isFocusActive ? "good" : ""}>
              {isFocusActive ? "a session is running" : "no session running"}
            </Chip>
            <Chip tone={strictActive ? "bad" : ""}>
              {strictActive ? "strict lock engaged" : "no lock"}
            </Chip>
            <Chip tone={canStop ? "" : "bad"}>
              {canStop ? "you can still stop" : "stopping is blocked"}
            </Chip>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <button
              className="btn primary"
              disabled={!settings.pro || Boolean(state.active)}
              onClick={() =>
                actions.startSession({ mode: "countdown", plannedSec: 25 * 60, strict: true, label: "Strict session" })
              }
            >
              🔒 Start a 25 min strict session
            </button>
            {!canStop && (
              <button className="btn danger" onClick={actions.abandonStrictSession}>
                Emergency exit (logged)
              </button>
            )}
          </div>
          {!settings.pro && (
            <p className="tiny muted" style={{ marginTop: 10 }}>
              Strict Mode is part of Regain Pro — activate it on the Regain Pro page.
            </p>
          )}
        </Card>

        <Card head="Why it works" hint="From the Regain study on exam prep">
          <div className="small muted" style={{ lineHeight: 1.8 }}>
            The urge to quit peaks in the first eight minutes and again around the two-thirds mark.
            Adding friction — a hold, a confirmation, an unskippable countdown — moves the decision
            from reflex to intent. Users on Strict Level 3 finish 38% more sessions than those who can
            stop freely.
          </div>
        </Card>
      </div>
    </div>
  );
}
