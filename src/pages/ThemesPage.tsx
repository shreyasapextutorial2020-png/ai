import { useStore } from "../store/AppStore";
import { ACCENTS, THEMES, WALLPAPERS } from "../lib/defaults";
import { Card, Chip } from "../components/ui";

export function ThemesPage() {
  const { state, actions } = useStore();
  const settings = state.settings;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <Card head="Themes" hint="Applies instantly across the whole app">
        <div className="grid cols-3" style={{ gap: 14 }}>
          {THEMES.map((t) => {
            const locked = t.pro && !settings.pro;
            const active = settings.theme === t.id;
            return (
              <button
                key={t.id}
                className={`theme-card ${active ? "active" : ""}`}
                onClick={() => !locked && actions.updateSettings({ theme: t.id })}
                style={locked ? { opacity: 0.62 } : undefined}
              >
                <div
                  className="theme-preview"
                  style={{
                    background: `linear-gradient(140deg, ${t.swatch[1]}, ${t.swatch[0]})`,
                  }}
                >
                  <div className="side" />
                  <div style={{ padding: 12 }}>
                    <div
                      style={{
                        height: 12,
                        width: "70%",
                        borderRadius: 6,
                        background: t.swatch[2],
                        opacity: 0.9,
                      }}
                    />
                    <div
                      style={{
                        height: 8,
                        width: "45%",
                        borderRadius: 6,
                        background: "rgba(255,255,255,.35)",
                        marginTop: 8,
                      }}
                    />
                    <div className="row" style={{ gap: 6, marginTop: 14 }}>
                      {[0, 1, 2].map((i) => (
                        <div
                          key={i}
                          className="theme-swatch"
                          style={{ background: i === 0 ? t.swatch[2] : "rgba(255,255,255,.22)" }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                <div className="row" style={{ padding: 12, gap: 8 }}>
                  <strong style={{ fontSize: 13.5 }}>{t.name}</strong>
                  {t.pro && <Chip tone={locked ? "warn" : "accent"}>{locked ? "🔒 Pro" : "Pro"}</Chip>}
                  {active && <Chip tone="good">active</Chip>}
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="grid cols-2" style={{ gap: 16, alignItems: "start" }}>
        <Card head="Accent colour" hint="Used for buttons, rings and highlights">
          <div className="row wrap" style={{ gap: 10 }}>
            {ACCENTS.map((c) => (
              <button
                key={c}
                onClick={() => actions.updateSettings({ accent: c })}
                aria-label={`Use accent colour ${c}`}
                title={c}
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 13,
                  background: c,
                  cursor: "pointer",
                  border: settings.accent === c ? "3px solid #fff" : "1px solid var(--border)",
                }}
              />
            ))}
          </div>
          <div className="row" style={{ marginTop: 16, gap: 10 }}>
            <button
              className="btn primary"
              onClick={() => actions.updateSettings({ accent: settings.accent })}
            >
              Apply accent
            </button>
            <span className="small muted">Accent is live — pick one and it sticks instantly.</span>
          </div>
        </Card>

        <Card head="Wallpaper" hint="Backdrop behind the app panels">
          <div className="grid cols-2" style={{ gap: 10 }}>
            {WALLPAPERS.map((w) => {
              const active = settings.wallpaper === w.id;
              return (
                <button
                  key={w.id}
                  className={`sound-card ${active ? "active" : ""}`}
                  onClick={() => actions.updateSettings({ wallpaper: w.id })}
                  style={{ padding: 0, overflow: "hidden" }}
                >
                  <div style={{ height: 74, background: w.css, backgroundColor: "#0a0a14" }} />
                  <div className="row" style={{ padding: 10, gap: 8 }}>
                    <span className="small" style={{ fontWeight: 560 }}>{w.name}</span>
                    {active && <Chip tone="good">set</Chip>}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      </div>

      <Card head="Personalisation" hint="Small things that make long study days nicer">
        <div className="grid cols-3" style={{ gap: 16 }}>
          <div>
            <div style={{ fontSize: 22 }}>🖼️</div>
            <div style={{ fontWeight: 600, marginTop: 6 }}>Focus wallpaper per session</div>
            <div className="small muted" style={{ marginTop: 4 }}>
              Nature and lo-fi backdrops dim the interface while a session runs, so the timer is the
              only bright thing on screen.
            </div>
          </div>
          <div>
            <div style={{ fontSize: 22 }}>🔔</div>
            <div style={{ fontWeight: 600, marginTop: 6 }}>Completion chimes</div>
            <div className="small muted" style={{ marginTop: 4 }}>
              Soft synth chimes mark phase changes instead of jarring alarms. Turn them off in
              Settings.
            </div>
          </div>
          <div>
            <div style={{ fontSize: 22 }}>🌈</div>
            <div style={{ fontWeight: 600, marginTop: 6 }}>Colour-coded subjects</div>
            <div className="small muted" style={{ marginTop: 4 }}>
              Every subject keeps its colour across the planner, charts and session history.
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
