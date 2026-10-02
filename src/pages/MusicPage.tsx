import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store/AppStore";
import { Card, Chip, Stat } from "../components/ui";
import { SOUNDS, SOUND_CATEGORY_LABELS, type SoundCategory } from "../lib/defaults";
import { ambient, type SoundKind } from "../lib/audio";
import { fmtShort } from "../lib/utils";

const MAX_LAYERS = 3;

export function MusicPage() {
  const { state, actions, isFocusActive } = useStore();
  const [playing, setPlaying] = useState<SoundKind | null>(ambient.current());
  const [mix, setMix] = useState<SoundKind[]>(ambient.currentMix());
  const isPro = state.settings.pro;
  const extraLayerIds = state.settings.musicLayers ?? [];

  useEffect(() => {
    // follow external stops (page switches / session end)
    const id = window.setInterval(() => {
      setPlaying(ambient.current());
      setMix(ambient.currentMix());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (isFocusActive && state.settings.musicTrack) {
      const layers = (state.settings.musicLayers ?? []).filter((id) => SOUNDS.some((s) => s.id === id));
      actions.playSoundMix(state.settings.musicTrack, layers);
    }
    return () => {
      if (isFocusActive) ambient.stop();
    };
  }, [isFocusActive, state.settings.musicTrack, state.settings.musicVolume, actions]);

  const grouped = useMemo(() => {
    const map = new Map<SoundCategory, typeof SOUNDS>();
    for (const sound of SOUNDS) {
      const list = map.get(sound.category) ?? [];
      list.push(sound);
      map.set(sound.category, list);
    }
    return [...map.entries()];
  }, []);

  const toggle = (id: string, kind: SoundKind, locked: boolean) => {
    if (locked) return;
    actions.updateSettings({ musicTrack: id });
    if (ambient.current() === kind) {
      ambient.stop();
      setPlaying(null);
      setMix([]);
    } else {
      actions.playSoundMix(id, extraLayerIds);
      setPlaying(kind);
      setMix(ambient.currentMix());
    }
  };

  const toggleLayer = (id: string) => {
    const next = extraLayerIds.includes(id)
      ? extraLayerIds.filter((x) => x !== id)
      : extraLayerIds.length >= MAX_LAYERS
        ? extraLayerIds
        : [...extraLayerIds, id];
    actions.updateSettings({ musicLayers: next });
    actions.playSoundMix(state.settings.musicTrack, next);
    setMix(ambient.currentMix());
  };

  const stopAll = () => {
    ambient.stop();
    setPlaying(null);
    setMix([]);
  };

  const focusedWithMusic = state.sessions.reduce((a, s) => a + s.actualSec, 0);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <Card
        head="Now playing"
        hint="Every soundscape is synthesised live in the app — nothing to download, works offline"
        actions={
          <div className="row" style={{ gap: 10 }}>
            <button className="btn sm" onClick={stopAll}>
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
                {mix.length > 1
                  ? `Mixed with ${mix.length - 1} layer${mix.length > 2 ? "s" : ""}`
                  : "Single soundscape"}
                {playing ? ` · ${Math.round(state.settings.musicVolume * 100)}% volume` : ""}
              </div>
            </div>
          </div>
          <div className="spacer" />
          <div className="row wrap" style={{ gap: 18 }}>
            <Stat label="Library" value={`${SOUNDS.length} sounds`} />
            <Stat label="Mixed with music" value={fmtShort(focusedWithMusic)} />
            <Stat label="Layers" value={`${mix.length}/${MAX_LAYERS + 1}`} />
          </div>
        </div>

        <div className="row wrap" style={{ gap: 12, marginTop: 16 }}>
          <label className="row" style={{ gap: 10, flex: 1, minWidth: 220 }}>
            <span className="stat-label">Volume</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={state.settings.musicVolume}
              onChange={(e) => {
                const v = Number(e.target.value);
                actions.updateSettings({ musicVolume: v });
                ambient.setVolume(v);
              }}
              aria-label="Master volume"
              style={{ flex: 1 }}
            />
          </label>
          <label className="row" style={{ gap: 10, flex: 1, minWidth: 220 }}>
            <span className="stat-label">Layer level</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={state.settings.musicLayerVolume ?? 0.5}
              onChange={(e) => {
                const v = Number(e.target.value);
                actions.updateSettings({ musicLayerVolume: v });
                for (let i = 1; i < ambient.currentMix().length; i++) ambient.setLayerVolume(i, v);
              }}
              aria-label="Layer volume"
              style={{ flex: 1 }}
            />
          </label>
        </div>
      </Card>

      {mix.length > 0 && (
        <Card head="Live mix" hint={`Up to ${MAX_LAYERS} extra layers on top of the primary sound`}>
          <div className="row wrap" style={{ gap: 10 }}>
            {mix.map((kind, index) => {
              const def = SOUNDS.find((s) => s.kind === kind);
              return (
                <span className="chip" key={`${kind}-${index}`}>
                  {def?.icon} {def?.name ?? kind}
                  {index === 0 ? " · primary" : " · layer"}
                </span>
              );
            })}
          </div>
        </Card>
      )}

      {grouped.map(([category, sounds]) => (
        <Card
          key={category}
          head={SOUND_CATEGORY_LABELS[category]}
          hint={
            category === "music"
              ? "Generated chord progressions and drum patterns — no lyrics, no licensing"
              : category === "nature"
                ? "Weather and wildlife, synthesised from filtered noise"
                : undefined
          }
        >
          <div className="grid cols-3" style={{ gap: 12 }}>
            {sounds.map((s) => {
              const locked = s.pro && !isPro;
              const isPrimary = playing === s.kind;
              const isLayer = extraLayerIds.includes(s.id);
              return (
                <div
                  key={s.id}
                  className={`card tight sound-card ${isPrimary ? "active" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${isPrimary ? "Stop" : "Play"} ${s.name}`}
                  style={{
                    padding: 14,
                    borderColor: isPrimary ? "var(--accent)" : undefined,
                    boxShadow: isPrimary ? "0 0 0 1px var(--accent) inset" : undefined,
                  }}
                  onClick={() => toggle(s.id, s.kind, locked)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggle(s.id, s.kind, locked);
                    }
                  }}
                >
                  <div className="row" style={{ gap: 10 }}>
                    <div className="icon" style={{ fontSize: 20 }}>{s.icon}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 580, fontSize: 13.5 }}>{s.name}</div>
                      <div className="tiny muted">{s.blurb}</div>
                    </div>
                    {s.pro && <Chip tone={isPro ? "accent" : "warn"} className="tiny">{isPro ? "Pro" : "🔒 Pro"}</Chip>}
                  </div>
                  <div className="row" style={{ gap: 8, marginTop: 10 }}>
                    <button
                      className={`btn sm ${isPrimary ? "primary" : ""}`}
                      disabled={locked}
                      title={locked ? "Unlock Pro to play this soundscape" : `Play ${s.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggle(s.id, s.kind, locked);
                      }}
                    >
                      {isPrimary ? "⏸ Stop" : "▶ Play"}
                    </button>
                    <button
                      className={`btn sm ghost ${isLayer ? "primary" : ""}`}
                      disabled={locked}
                      title={
                        locked
                          ? "Unlock Pro to mix this sound"
                          : isLayer
                            ? `Remove ${s.name} from the mix`
                            : `Layer ${s.name} under the current sound`
                      }
                      aria-label={isLayer ? `Remove ${s.name} layer` : `Add ${s.name} layer`}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!playing) {
                          // no primary yet: start this one, then layer it
                          toggle(s.id, s.kind, locked);
                          return;
                        }
                        toggleLayer(s.id);
                      }}
                    >
                      {isLayer ? "✓ Layer" : "+ Layer"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}
