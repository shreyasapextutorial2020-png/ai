import { useEffect, useState } from "react";
import { useStore } from "../store/AppStore";
import { Card, Chip, Stat } from "../components/ui";
import { SOUNDS } from "../lib/defaults";
import { ambient, type SoundKind } from "../lib/audio";
import { fmtShort } from "../lib/utils";

export function MusicPage() {
  const { state, actions, isFocusActive, elapsedSec } = useStore();
  const [playing, setPlaying] = useState<SoundKind | null>(ambient.current());

  useEffect(() => {
    // follow external stops (page switches / session end)
    const id = window.setInterval(() => setPlaying(ambient.current()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (isFocusActive && state.settings.musicTrack) {
      const sound = SOUNDS.find((s) => s.id === state.settings.musicTrack);
      if (sound && ambient.current() !== sound.kind) {
        ambient.play(sound.kind, state.settings.musicVolume);
        setPlaying(sound.kind);
      }
    }
    return () => {
      if (isFocusActive) ambient.stop();
    };
  }, [isFocusActive, state.settings.musicTrack, state.settings.musicVolume]);

  const toggle = (id: string, kind: SoundKind, locked: boolean) => {
    if (locked) return;
    actions.updateSettings({ musicTrack: id });
    if (ambient.current() === kind) {
      ambient.stop();
      setPlaying(null);
    } else {
      ambient.play(kind, state.settings.musicVolume);
      setPlaying(kind);
    }
  };

  const focusedWithMusic = state.sessions.filter((s) => s.mode).reduce((a, s) => a + s.actualSec, 0);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <Card
        head="Now playing"
        hint="Every soundscape is synthesised live in the app — nothing to download"
        actions={
          <div className="row" style={{ gap: 10 }}>
            <button className="btn sm" onClick={() => ambient.stop()}>
              ⏹ Stop
            </button>
            <button
              className="btn sm primary"
              disabled={Boolean(state.active)}
              onClick={() =>
                actions.startSession({
                  mode: "countdown",
                  plannedSec: 50 * 60,
                  label: "Music focus block",
                  subject: "Revision",
                })
              }
            >
              ▶ Focus with music
            </button>
          </div>
        }
      >
        <div className="row wrap" style={{ gap: 20 }}>
          <div className="row" style={{ gap: 12 }}>
            <div className="brand-mark" style={{ width: 52, height: 52, fontSize: 24 }}>
              {SOUNDS.find((s) => s.kind === playing)?.icon ?? "🎧"}
            </div>
            <div>
              <div style={{ fontWeight: 620 }}>
                {SOUNDS.find((s) => s.kind === playing)?.name ?? "Silence"}
              </div>
              <div className="small muted">
                {playing
                  ? `${SOUNDS.find((s) => s.kind === playing)?.blurb}`
                  : "Pick a soundscape below — it fades in over a second."}
              </div>
            </div>
            {playing && (
              <span className="eq" style={{ color: "var(--accent)" }}>
                <i />
                <i />
                <i />
                <i />
              </span>
            )}
          </div>
          <div className="spacer" />
          <div className="row" style={{ gap: 10, minWidth: 240 }}>
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
            <span className="small mono">{Math.round(state.settings.musicVolume * 100)}%</span>
          </div>
        </div>
      </Card>

      <div className="grid cols-4" style={{ gap: 16 }}>
        <Card className="tight"><Stat label="Session time" value={isFocusActive ? fmtShort(elapsedSec) : "—"} icon="⏱️" /></Card>
        <Card className="tight"><Stat label="All-time focus" value={fmtShort(focusedWithMusic)} icon="🎼" /></Card>
        <Card className="tight"><Stat label="Library" value={`${SOUNDS.length} sounds`} icon="🎚️" /></Card>
        <Card className="tight"><Stat label="Default" value={SOUNDS.find((s) => s.id === state.settings.musicTrack)?.name ?? "—"} icon="⭐" /></Card>
      </div>

      <div className="grid cols-3" style={{ gap: 14 }}>
        {SOUNDS.map((s) => {
          const locked = s.pro && !state.settings.pro;
          const isActive = playing === s.kind;
          return (
            <button
              key={s.id}
              className={`sound-card ${isActive ? "active" : ""}`}
              onClick={() => toggle(s.id, s.kind, locked)}
              style={locked ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
            >
              <div className="row" style={{ gap: 10 }}>
                <span style={{ fontSize: 22 }}>{s.icon}</span>
                <div style={{ flex: 1 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <strong style={{ fontSize: 13.8 }}>{s.name}</strong>
                    {s.pro && <Chip tone={locked ? "warn" : "accent"}>{locked ? "🔒 pro" : "pro"}</Chip>}
                  </div>
                  <div className="small muted" style={{ marginTop: 3 }}>{s.blurb}</div>
                </div>
                {isActive && (
                  <span className="eq" style={{ color: "var(--accent-2)" }}>
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <Card head="Why sound helps" hint="What the research says">
        <div className="grid cols-3" style={{ gap: 16 }}>
          {[
            { icon: "🌧️", title: "Steady masking", body: "Constant noise like rain raises the threshold for sudden sounds that break attention." },
            { icon: "🟤", title: "Low-frequency calm", body: "Brown noise emphasises low frequencies and is associated with lower arousal and steadier heart rate." },
            { icon: "🎧", title: "No lyrics, no loops", body: "Generated pads never repeat a hook, so there is no anticipation of the next line to distract you." },
          ].map((c) => (
            <div key={c.title}>
              <div style={{ fontSize: 22 }}>{c.icon}</div>
              <div style={{ fontWeight: 600, marginTop: 6 }}>{c.title}</div>
              <div className="small muted" style={{ marginTop: 4 }}>{c.body}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
