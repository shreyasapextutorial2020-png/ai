import { useEffect, useRef, useState } from "react";
import { useStore } from "../store/AppStore";
import { Card, Chip, Stat } from "../components/ui";
import { SOUNDS, SOUND_CATEGORY_LABELS, type SoundCategory } from "../lib/defaults";
import { ambient, type SoundKind } from "../lib/audio";
import { fmtShort } from "../lib/utils";

/**
 * jsdom (used by the test suites) has no media stack: calling play()/pause()
 * there logs "Not implemented" errors that the suites rightly treat as failures.
 * Real browsers always report a normal user agent, so this detects the real
 * environment once and skips the calls when playback is impossible.
 */
const CAN_PLAY_MEDIA =
  typeof window !== "undefined" &&
  typeof window.HTMLMediaElement !== "undefined" &&
  !/jsdom/i.test(window.navigator?.userAgent ?? "");

interface LocalTrack {
  id: string;
  name: string;
  url: string;
}

export function MusicPage() {
  const { state, actions, isFocusActive } = useStore();
  const [playing, setPlaying] = useState<SoundKind | null>(ambient.current());
  const isPro = state.settings.pro;

  // "Your music": play original tracks from your own machine.
  const [tracks, setTracks] = useState<LocalTrack[]>([]);
  const [trackIndex, setTrackIndex] = useState(-1);
  const [localPlaying, setLocalPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  // release object URLs when leaving the page
  useEffect(
    () => () => {
      tracks.forEach((t) => URL.revokeObjectURL(t.url));
      if (CAN_PLAY_MEDIA) audioRef.current?.pause();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const toggle = (id: string, kind: SoundKind, locked: boolean) => {
    if (locked) return;
    actions.updateSettings({ musicTrack: id });
    if (ambient.current() === kind) {
      ambient.stop();
      setPlaying(null);
    } else {
      stopLocal(); // only one source at a time
      ambient.play(kind, state.settings.musicVolume);
      setPlaying(kind);
    }
  };

  const stopAll = () => {
    ambient.stop();
    setPlaying(null);
    stopLocal();
  };

  /* ------------------------------ your music ---------------------------- */

  function stopLocal() {
    if (CAN_PLAY_MEDIA) audioRef.current?.pause();
    setLocalPlaying(false);
  }

  function playTrack(index: number) {
    const track = tracks[index];
    if (!track) return;
    ambient.stop();
    setPlaying(null);
    setTrackIndex(index);
    const audio = audioRef.current;
    if (!audio || !CAN_PLAY_MEDIA) {
      // no media stack (tests): keep the UI state honest without pretending
      setLocalPlaying(false);
      return;
    }
    audio.src = track.url;
    audio.volume = state.settings.musicVolume;
    void audio.play().then(
      () => setLocalPlaying(true),
      () => setLocalPlaying(false),
    );
  }

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const added: LocalTrack[] = [...files]
      .filter((file) => file.type.startsWith("audio/") || /\.(mp3|m4a|ogg|wav|flac|aac|opus)$/i.test(file.name))
      .map((file) => ({
        id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
        name: file.name.replace(/\.[^.]+$/, ""),
        url: URL.createObjectURL(file),
      }));
    if (!added.length) return;
    setTracks((prev) => {
      const next = [...prev, ...added];
      if (trackIndex < 0) window.setTimeout(() => playTrack(0), 0);
      return next;
    });
  }

  const focusedWithMusic = state.sessions.reduce((a, s) => a + s.actualSec, 0);

  const grouped: Array<[SoundCategory, typeof SOUNDS]> = (() => {
    const map = new Map<SoundCategory, typeof SOUNDS>();
    for (const sound of SOUNDS) {
      const list = map.get(sound.category) ?? [];
      list.push(sound as (typeof SOUNDS)[number]);
      map.set(sound.category, list);
    }
    return [...map.entries()];
  })();

  return (
    <div className="grid" style={{ gap: 16 }}>
      <Card
        head="Now playing"
        hint="Original compositions and ambience, generated live in the app — clean, no noise under the music"
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
              {localPlaying ? "🎵" : (SOUNDS.find((s) => s.kind === playing)?.icon ?? "🎧")}
            </div>
            <div>
              <div style={{ fontWeight: 620 }}>
                {localPlaying
                  ? (tracks[trackIndex]?.name ?? "Your music")
                  : (SOUNDS.find((s) => s.kind === playing)?.name ?? "Silence")}
              </div>
              <div className="small muted">
                {localPlaying ? "Playing from your own files" : "Single soundscape"}
                {playing || localPlaying ? ` · ${Math.round(state.settings.musicVolume * 100)}% volume` : ""}
              </div>
            </div>
          </div>
          <div className="spacer" />
          <div className="row wrap" style={{ gap: 18 }}>
            <Stat label="Library" value={`${SOUNDS.length} sounds`} />
            <Stat label="Your tracks" value={String(tracks.length)} />
            <Stat label="Focused with music" value={fmtShort(focusedWithMusic)} />
          </div>
        </div>

        <div className="row wrap" style={{ gap: 12, marginTop: 16 }}>
          <label className="row" style={{ gap: 10, flex: 1, minWidth: 240 }}>
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
                if (audioRef.current) audioRef.current.volume = v;
              }}
              aria-label="Volume"
              style={{ flex: 1 }}
            />
          </label>
        </div>
      </Card>

      <Card
        head="Your music"
        hint="Play your own original tracks — files never leave your machine and are never uploaded"
        actions={
          <div className="row" style={{ gap: 8 }}>
            <button className="btn sm" onClick={() => fileInputRef.current?.click()}>
              + Add audio files
            </button>
            {tracks.length > 0 && (
              <button className="btn sm ghost" onClick={() => setTracks([])} title="Clear the playlist">
                Clear
              </button>
            )}
          </div>
        }
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.mp3,.m4a,.ogg,.wav,.flac,.aac,.opus"
          multiple
          style={{ display: "none" }}
          aria-label="Add audio files from your computer"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <audio
          ref={audioRef}
          onEnded={() => {
            if (trackIndex + 1 < tracks.length) playTrack(trackIndex + 1);
            else setLocalPlaying(false);
          }}
          onPause={() => setLocalPlaying(false)}
          onPlay={() => setLocalPlaying(true)}
        />
        {tracks.length === 0 ? (
          <p className="small muted" style={{ margin: 0, lineHeight: 1.7 }}>
            No tracks yet. Add MP3, M4A, WAV, FLAC or OGG files and they play here — looping through your own
            playlist. The built-in library below stays available at the same time.
          </p>
        ) : (
          <div className="list">
            {tracks.map((track, index) => (
              <div className="list-row" key={track.id}>
                <div className="icon">{index === trackIndex && localPlaying ? "▶️" : "🎵"}</div>
                <div className="meta">
                  <div className="title">{track.name}</div>
                  <div className="sub mono">local file · {index + 1} of {tracks.length}</div>
                </div>
                <button
                  className="btn sm"
                  aria-label={index === trackIndex && localPlaying ? `Pause ${track.name}` : `Play ${track.name}`}
                  onClick={() =>
                    index === trackIndex && localPlaying
                      ? stopLocal()
                      : playTrack(index)
                  }
                >
                  {index === trackIndex && localPlaying ? "⏸ Pause" : "▶ Play"}
                </button>
                <button
                  className="btn sm ghost"
                  aria-label={`Remove ${track.name}`}
                  title="Remove from the playlist"
                  onClick={() => {
                    URL.revokeObjectURL(track.url);
                    setTracks((prev) => prev.filter((t) => t.id !== track.id));
                    if (index === trackIndex) stopLocal();
                  }}
                >
                  🗑️
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {grouped.map(([category, sounds]) => (
        <Card
          key={category}
          head={SOUND_CATEGORY_LABELS[category]}
          hint={
            category === "music"
              ? "Original compositions — chord progressions, bass and drums written here, not sampled"
              : category === "nature"
                ? "Weather and wildlife, synthesised from filtered noise"
                : undefined
          }
        >
          <div className="grid cols-3" style={{ gap: 12 }}>
            {sounds.map((s) => {
              const locked = s.pro && !isPro;
              const isPrimary = playing === s.kind && !localPlaying;
              return (
                <div
                  key={s.id}
                  className={`card tight sound-card ${isPrimary ? "active" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${isPrimary ? "Stop" : "Play"} ${s.name}`}
                  style={{ padding: 14 }}
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
                    {s.pro && (
                      <Chip tone={isPro ? "accent" : "warn"} className="tiny">
                        {isPro ? "Pro" : "🔒 Pro"}
                      </Chip>
                    )}
                  </div>
                  <div className="row" style={{ gap: 8, marginTop: 10 }}>
                    <button
                      className={`btn sm ${isPrimary ? "primary" : ""}`}
                      disabled={locked}
                      title={locked ? "Unlock Pro to play this soundscape" : `Play ${s.name}`}
                      aria-label={`${isPrimary ? "Stop" : "Play"} ${s.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggle(s.id, s.kind, locked);
                      }}
                    >
                      {isPrimary ? "⏸ Stop" : "▶ Play"}
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
