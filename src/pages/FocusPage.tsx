import { useMemo, useState } from "react";
import { useStore } from "../store/AppStore";
import { Bar, Card, Chip, Empty, Ring, Segmented, Stat, Toggle } from "../components/ui";
import { fmtClock, fmtShort, fmtDate, pickRandom } from "../lib/utils";
import { recommendSession } from "../lib/recommend";
import { SOUNDS } from "../lib/defaults";
import { ambient } from "../lib/audio";
import type { TimerMode } from "../lib/types";

const PRESETS = [15, 25, 45, 50, 60, 90, 120];
const SUBJECTS = ["Maths", "Physics", "Chemistry", "Biology", "Computer Science", "English", "Revision", "General"];
const PROMPTS = [
  "Start with the hardest problem first — momentum follows.",
  "Phone in another room. Distance beats willpower.",
  "One topic, one session. No tab-hopping.",
  "Write the goal in one line before you press start.",
  "Discomfort at minute 8 is where the session actually begins.",
];

export function FocusPage() {
  const {
    state,
    elapsedSec,
    remainingSec,
    isFocusActive,
    isPaused,
    strictActive,
    canStop,
    todayFocusedSec,
    todaySessions,
    currentWindow,
    actions,
  } = useStore();

  const active = state.active;
  const [mode, setMode] = useState<TimerMode>("study");
  const [label, setLabel] = useState("");
  const [subject, setSubject] = useState("Maths");
  const [minutes, setMinutes] = useState(50);
  const [strict, setStrict] = useState(state.settings.strictMode);
  const [laps, setLaps] = useState<number[]>([]);

  const lastSession = useMemo(() => {
    const list = [...state.sessions].sort((a, b) => b.endedAt - a.endedAt);
    return list[0] ?? null;
  }, [state.sessions]);

  const unrated = lastSession && !lastSession.rating && Date.now() - lastSession.endedAt < 12 * 3600_000;
  const suggestion = useMemo(() => recommendSession(state.sessions), [state.sessions]);
  const goalSec = state.settings.dailyGoalMinutes * 60;

  const start = () => {
    actions.startSession({
      mode,
      label,
      subject,
      plannedSec: mode === "study" || mode === "stopwatch" ? 0 : minutes * 60,
      strict,
    });
    setLaps([]);
  };

  const selectSound = (id: string) => {
    const sound = SOUNDS.find((s) => s.id === id);
    if (!sound) return;
    if (sound.pro && !state.settings.pro) return;
    actions.updateSettings({ musicTrack: id });
    ambient.play(sound.kind, state.settings.musicVolume);
  };

  return (
    <div className="grid cols-2" style={{ alignItems: "start" }}>
      <div className="grid" style={{ gap: 16 }}>
        <Card className="tight">
          <div className="row wrap" style={{ justifyContent: "space-between", marginBottom: 16 }}>
            <Segmented<TimerMode>
              value={active ? active.mode : mode}
              onChange={(v) => !active && setMode(v)}
              options={[
                { value: "study", label: "Study" },
                { value: "stopwatch", label: "Stopwatch" },
                { value: "countdown", label: "Countdown" },
              ]}
            />
            {active && (
              <Chip tone={active.running ? "good" : "warn"}>
                {active.running ? "● in session" : "❚❚ paused"}
              </Chip>
            )}
          </div>

          <div className="row" style={{ justifyContent: "center", padding: "8px 0 4px" }}>
            <Ring
              size={280}
              stroke={14}
              progress={
                active
                  ? active.plannedSec > 0
                    ? Math.min(1, elapsedSec / active.plannedSec)
                    : Math.min(1, todayFocusedSec / Math.max(1, goalSec))
                  : Math.min(1, todayFocusedSec / Math.max(1, goalSec))
              }
              colour={
                !active
                  ? "var(--accent)"
                  : active.plannedSec > 0
                    ? "var(--accent)"
                    : "var(--accent-2)"
              }
            >
              <div>
                <div className="hero-time">
                  {active
                    ? active.plannedSec > 0
                      ? fmtClock(remainingSec)
                      : fmtClock(elapsedSec)
                    : fmtClock(mode === "countdown" ? minutes * 60 : 0)}
                </div>
                <div className="small muted" style={{ marginTop: 8 }}>
                  {active
                    ? active.mode === "pomodoro"
                      ? `${active.label} · ${active.phase}`
                      : `${active.label} · ${active.subject}`
                    : mode === "stopwatch"
                      ? "Counts up · laps enabled"
                      : mode === "countdown"
                        ? `${minutes} minute block`
                        : "Open-ended study"}
                </div>
                {active && (
                  <div className="row" style={{ justifyContent: "center", gap: 6, marginTop: 10 }}>
                    {strictActive && <Chip tone="bad">🔒 strict</Chip>}
                    {active.blocked > 0 && <Chip tone="warn">🚫 {active.blocked} blocked</Chip>}
                    {active.distractions > 0 && <Chip>👀 {active.distractions} slips</Chip>}
                  </div>
                )}
              </div>
            </Ring>
          </div>

          <div className="row wrap" style={{ justifyContent: "center", gap: 10, marginTop: 14 }}>
            {!active && (
              <button className="btn primary lg" onClick={start}>
                ▶ Start {mode === "countdown" ? `${minutes} min` : mode}
              </button>
            )}
            {active && isFocusActive && (
              <button className="btn lg" onClick={actions.pauseSession}>
                ❚❚ Pause
              </button>
            )}
            {active && isPaused && (
              <button className="btn primary lg" onClick={actions.resumeSession}>
                ▶ Resume
              </button>
            )}
            {active && mode === "stopwatch" && (
              <button className="btn lg" onClick={() => setLaps((l) => [...l, Math.round(elapsedSec)])}>
                🏁 Lap
              </button>
            )}
            {active && (
              <button
                className="btn danger lg"
                disabled={!canStop}
                onClick={() => actions.stopSession("user")}
              >
                {canStop ? "⏹ End session" : "🔒 Locked by Strict Mode"}
              </button>
            )}
          </div>

          {active && active.plannedSec > 0 && (
            <div style={{ marginTop: 16 }}>
              <Bar value={elapsedSec} max={active.plannedSec} />
            </div>
          )}

          {laps.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div className="stat-label" style={{ marginBottom: 6 }}>Laps</div>
              <div className="row wrap" style={{ gap: 6 }}>
                {laps.map((l, i) => (
                  <Chip key={i}>
                    #{i + 1} · {fmtClock(l - (laps[i - 1] ?? 0))}
                  </Chip>
                ))}
              </div>
            </div>
          )}
        </Card>

        {unrated && lastSession && (
          <Card head="How did that session feel?" hint={`${fmtDate(lastSession.endedAt)} · ${fmtShort(lastSession.actualSec)} of ${lastSession.subject}`}>
            <div className="row wrap" style={{ gap: 10 }}>
              <button
                className="btn good"
                onClick={() => actions.rateSession(lastSession.id, "like")}
              >
                👍 Like — do this again
              </button>
              <button
                className="btn danger"
                onClick={() => actions.rateSession(lastSession.id, "dislike")}
              >
                👎 Dislike — avoid this pattern
              </button>
              <div className="spacer" />
              <span className="small muted">
                Ratings tune your suggestions on the Progress page.
              </span>
            </div>
          </Card>
        )}

        <Card head="Session setup" hint="Applied when you press start">
          <div className="grid" style={{ gap: 14 }}>
            <div className="grid cols-2" style={{ gap: 12 }}>
              <label>
                <div className="stat-label" style={{ marginBottom: 6 }}>What are you working on?</div>
                <input
                  className="input"
                  placeholder="e.g. Integration practice"
                  value={label}
                  disabled={Boolean(active)}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </label>
              <label>
                <div className="stat-label" style={{ marginBottom: 6 }}>Subject</div>
                <select
                  className="select"
                  value={subject}
                  disabled={Boolean(active)}
                  onChange={(e) => setSubject(e.target.value)}
                >
                  {SUBJECTS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>

            <div>
              <div className="row">
                <span className="stat-label">Countdown length</span>
                <div className="spacer" />
                <span className="small mono">{minutes} min</span>
              </div>
              <input
                type="range"
                min={5}
                max={180}
                step={5}
                value={minutes}
                disabled={Boolean(active)}
                onChange={(e) => setMinutes(Number(e.target.value))}
                style={{ marginTop: 8 }}
              />
              <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    className={`btn sm ${minutes === p ? "primary" : ""}`}
                    disabled={Boolean(active)}
                    onClick={() => setMinutes(p)}
                  >
                    {p}m
                  </button>
                ))}
              </div>
            </div>

            <div className="row" style={{ gap: 12 }}>
              <Toggle on={strict} onChange={setStrict} disabled={Boolean(active)} label="Strict Mode for this session" />
              <div>
                <div style={{ fontWeight: 560, fontSize: 13.5 }}>Strict Mode for this session</div>
                <div className="small muted">
                  {state.settings.pro || strict === false
                    ? `Level ${state.settings.strictLevel} — early exit is blocked or logged.`
                    : "Strict Mode is a Pro feature — unlock it on the Regain Pro page."}
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid" style={{ gap: 16 }}>
        <Card head="Live focus guard" hint="What Regain sees right now">
          <div className="list">
            <div className="list-row">
              <div className="icon">🖥️</div>
              <div className="meta">
                <div className="title">{currentWindow?.process_name ?? "Waiting for the desktop monitor…"}</div>
                <div className="sub">
                  {currentWindow?.window_title || "Run the Tauri build on Windows for native foreground detection."}
                </div>
              </div>
              {currentWindow && (
                <Chip tone="good">{state.settings.blockDuringFocus && isFocusActive ? "guarded" : "observed"}</Chip>
              )}
            </div>
            <div className="list-row">
              <div className="icon">🛡️</div>
              <div className="meta">
                <div className="title">
                  {isFocusActive ? "Blocking is active" : "Blocking is on standby"}
                </div>
                <div className="sub">
                  {state.appRules.filter((r) => r.enabled).length} apps ·{" "}
                  {state.webRules.filter((r) => r.enabled).length} sites ·{" "}
                  {state.settings.blockReelsShorts ? "Reels/Shorts blocked" : "Reels/Shorts allowed"}
                </div>
              </div>
              <Chip tone={isFocusActive ? "good" : ""}>{isFocusActive ? "ON" : "IDLE"}</Chip>
            </div>
          </div>
          {state.blockedLog.filter((b) => b.duringFocus).slice(-3).reverse().map((b) => (
            <div key={b.id} className="row" style={{ marginTop: 8, gap: 8 }}>
              <span>{b.icon}</span>
              <span className="small">
                Blocked <strong>{b.label}</strong>
              </span>
              <div className="spacer" />
              <span className="tiny muted">{new Date(b.at).toLocaleTimeString()}</span>
            </div>
          ))}
        </Card>

        <Card head="Today">
          <div className="grid cols-2" style={{ gap: 16 }}>
            <Stat label="Focused" value={fmtShort(todayFocusedSec)} icon="⏱️" />
            <Stat label="Sessions" value={todaySessions.length} icon="✅" />
            <Stat label="Goal" value={`${Math.min(100, Math.round((todayFocusedSec / 60 / Math.max(1, state.settings.dailyGoalMinutes)) * 100))}%`} icon="🎯" sub={`of ${state.settings.dailyGoalMinutes} min`} />
            <Stat label="Streak" value={`${state.streak.current}d`} icon="🔥" sub={`best ${state.streak.best}d`} />
          </div>
        </Card>

        {suggestion && (
          <Card head="Regain suggests" hint={suggestion.reason}>
            <div className="row" style={{ gap: 12 }}>
              <div className="icon" style={{ width: 44, height: 44, fontSize: 20, borderRadius: 13, display: "grid", placeItems: "center", background: "rgba(255,255,255,.07)" }}>
                🎯
              </div>
              <div>
                <div style={{ fontWeight: 600 }}>{suggestion.title}</div>
                <div className="small muted">{suggestion.body}</div>
              </div>
            </div>
            <div className="row" style={{ marginTop: 14, gap: 10 }}>
              <button
                className="btn primary"
                onClick={() => {
                  setMode(suggestion.mode);
                  setMinutes(suggestion.minutes);
                  setSubject(suggestion.subject);
                  setLabel(`${suggestion.mode} block`);
                  actions.startSession({
                    mode: suggestion.mode,
                    subject: suggestion.subject,
                    label: `${suggestion.minutes} min block`,
                    plannedSec: suggestion.minutes * 60,
                  });
                }}
              >
                ▶ Start this session
              </button>
              <span className="small muted">Built from your 👍 / 👎 ratings.</span>
            </div>
          </Card>
        )}

        <Card head="Soundscape" hint="Plays while you focus">
          <div className="row wrap" style={{ gap: 8 }}>
            {SOUNDS.slice(0, 6).map((s) => {
              const locked = s.pro && !state.settings.pro;
              const activeSound = state.settings.musicTrack === s.id;
              return (
                <button
                  key={s.id}
                  className={`btn sm ${activeSound ? "primary" : ""}`}
                  onClick={() => selectSound(s.id)}
                  disabled={locked}
                  title={locked ? "Regain Pro sound" : s.blurb}
                >
                  {s.icon} {s.name} {locked ? "🔒" : ""}
                </button>
              );
            })}
          </div>
          <div className="row" style={{ marginTop: 14, gap: 12 }}>
            <span className="small muted">Volume</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={state.settings.musicVolume}
              onChange={(e) => {
                const v = Number(e.target.value);
                actions.updateSettings({ musicVolume: v });
                ambient.setVolume(v);
              }}
            />
            <button className="btn sm" onClick={() => ambient.stop()}>
              ⏹ Stop
            </button>
          </div>
        </Card>

        <Card head="Quick notes">
          <div className="small muted" style={{ lineHeight: 1.7 }}>
            {pickRandom(PROMPTS)}
            <div style={{ marginTop: 10 }}>
              <Empty icon="🧠" title="No notes yet" body="Session notes appear on the Screen Time page after each session." />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
