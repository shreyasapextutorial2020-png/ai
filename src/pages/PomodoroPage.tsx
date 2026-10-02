import { useStore } from "../store/AppStore";
import { Card, Chip, Ring, Stat, Toggle } from "../components/ui";
import { fmtClock, fmtShort } from "../lib/utils";

const PHASE_LABEL: Record<string, string> = {
  focus: "Focus",
  short: "Short break",
  long: "Long break",
};

export function PomodoroPage() {
  const { state, elapsedSec, remainingSec, actions, isFocusActive, canStop, todaySessions } = useStore();
  const cfg = state.pomodoro;
  const active = state.active && state.active.mode === "pomodoro" ? state.active : null;

  const focusSec = todaySessions
    .filter((s) => s.mode === "pomodoro")
    .reduce((a, s) => a + s.actualSec, 0);
  const roundsToday = todaySessions.filter((s) => s.mode === "pomodoro").length;
  const cycleLength = cfg.focusMin + (cfg.roundsBeforeLong > 1 ? cfg.shortMin : cfg.longMin);

  const phaseProgress = active && active.plannedSec > 0 ? elapsedSec / active.plannedSec : 0;

  return (
    <div className="grid cols-2" style={{ alignItems: "start" }}>
      <div className="grid" style={{ gap: 16 }}>
        <Card className="tight">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <div>
              <h2 className="section" style={{ marginBottom: 2 }}>
                {active ? PHASE_LABEL[active.phase] : "Pomodoro"}
              </h2>
              <div className="small muted">
                {active
                  ? `Round ${active.round} of ${cfg.roundsBeforeLong} before a long break`
                  : `${cfg.focusMin} min focus · ${cfg.shortMin} min short · ${cfg.longMin} min long`}
              </div>
            </div>
            <Chip tone={active?.phase === "focus" ? "accent" : "good"}>
              {active ? (active.running ? "● running" : "❚❚ paused") : "ready"}
            </Chip>
          </div>

          <div className="row" style={{ justifyContent: "center", padding: "10px 0" }}>
            <Ring
              size={260}
              stroke={14}
              progress={active ? phaseProgress : 0}
              colour={active?.phase === "focus" ? "var(--accent)" : "var(--good)"}
            >
              <div>
                <div className="hero-time">
                  {active ? fmtClock(remainingSec) : fmtClock(cfg.focusMin * 60)}
                </div>
                <div className="small muted" style={{ marginTop: 6 }}>
                  {active ? PHASE_LABEL[active.phase] : "Press start to begin"}
                </div>
              </div>
            </Ring>
          </div>

          <div className="row" style={{ justifyContent: "center", gap: 8 }}>
            {Array.from({ length: cfg.roundsBeforeLong }).map((_, i) => {
              const done = active ? i < (active.round - 1) % cfg.roundsBeforeLong : false;
              const current = active && active.phase === "focus" && i === (active.round - 1) % cfg.roundsBeforeLong;
              return (
                <div
                  key={i}
                  title={`Round ${i + 1}`}
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: done ? "var(--good)" : current ? "var(--accent)" : "rgba(255,255,255,.12)",
                    boxShadow: current ? "0 0 12px var(--accent)" : "none",
                  }}
                />
              );
            })}
          </div>

          <div className="row wrap" style={{ justifyContent: "center", gap: 10, marginTop: 18 }}>
            {!active && (
              <button
                className="btn primary lg"
                disabled={!state.settings.pro}
                title={state.settings.pro ? "" : "Pomodoro is a Pro feature"}
                onClick={() => actions.startSession({ mode: "pomodoro" })}
              >
                ▶ Start pomodoro {state.settings.pro ? "" : "🔒"}
              </button>
            )}
            {active && isFocusActive && (
              <button className="btn lg" onClick={actions.pauseSession}>❚❚ Pause</button>
            )}
            {active && !isFocusActive && (
              <button className="btn primary lg" onClick={actions.resumeSession}>▶ Resume</button>
            )}
            {active && (
              <button
                className="btn danger lg"
                disabled={!canStop}
                onClick={() => actions.stopSession("user")}
              >
                {canStop ? "⏹ End cycle" : "🔒 Locked"}
              </button>
            )}
          </div>

          {!state.settings.pro && !active && (
            <p className="small muted" style={{ textAlign: "center", marginTop: 12 }}>
              Pomodoro mode including automatic break cycles is part of Regain Pro.
            </p>
          )}
        </Card>

        <Card head="Today's pomodoros">
          <div className="grid cols-3" style={{ gap: 16 }}>
            <Stat label="Rounds" value={roundsToday} icon="🍅" />
            <Stat label="Focused" value={fmtShort(focusSec)} icon="⏱️" />
            <Stat
              label="Avg round"
              value={roundsToday ? fmtShort(focusSec / roundsToday) : "—"}
              icon="📏"
            />
          </div>
        </Card>
      </div>

      <div className="grid" style={{ gap: 16 }}>
        <Card head="Cycle settings" hint="Tune the classic Pomodoro technique">
          <div className="grid" style={{ gap: 16 }}>
            <SliderRow
              label="Focus length"
              value={cfg.focusMin}
              min={5}
              max={90}
              step={5}
              suffix="min"
              onChange={(v) => actions.updatePomodoro({ focusMin: v })}
            />
            <SliderRow
              label="Short break"
              value={cfg.shortMin}
              min={1}
              max={20}
              step={1}
              suffix="min"
              onChange={(v) => actions.updatePomodoro({ shortMin: v })}
            />
            <SliderRow
              label="Long break"
              value={cfg.longMin}
              min={5}
              max={45}
              step={5}
              suffix="min"
              onChange={(v) => actions.updatePomodoro({ longMin: v })}
            />
            <SliderRow
              label="Rounds before long break"
              value={cfg.roundsBeforeLong}
              min={2}
              max={8}
              step={1}
              suffix="rounds"
              onChange={(v) => actions.updatePomodoro({ roundsBeforeLong: v })}
            />
            <div className="row" style={{ gap: 12 }}>
              <Toggle
                on={cfg.autoStartBreaks}
                label="Auto-start breaks"
                onChange={(v) => actions.updatePomodoro({ autoStartBreaks: v })}
              />
              <div>
                <div style={{ fontWeight: 560, fontSize: 13.5 }}>Auto-start breaks</div>
                <div className="small muted">Jump straight into the break when a round ends.</div>
              </div>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Toggle
                on={cfg.autoStartFocus}
                label="Auto-start next focus round"
                onChange={(v) => actions.updatePomodoro({ autoStartFocus: v })}
              />
              <div>
                <div style={{ fontWeight: 560, fontSize: 13.5 }}>Auto-start next focus round</div>
                <div className="small muted">Good for exam sprints — no decision fatigue.</div>
              </div>
            </div>
          </div>
        </Card>

        <Card head="How it works">
          <div className="small muted" style={{ lineHeight: 1.75 }}>
            A full cycle is <strong>{cfg.focusMin} min focus</strong>, then a{" "}
            <strong>{cfg.shortMin} min break</strong>. After{" "}
            <strong>{cfg.roundsBeforeLong} rounds</strong> you earn a{" "}
            <strong>{cfg.longMin} min long break</strong>. One complete cycle takes about{" "}
            {fmtShort(cycleLength * cfg.roundsBeforeLong * 60)}.
            <div style={{ marginTop: 10 }}>
              Each completed focus round is logged on the Screen Time page, where you can 👍 or 👎
              it so Regain learns your ideal block length.
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="row">
        <span className="stat-label">{label}</span>
        <div className="spacer" />
        <span className="small mono">
          {value} {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ marginTop: 8 }}
      />
    </div>
  );
}
