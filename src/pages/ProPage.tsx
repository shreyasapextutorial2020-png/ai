import { useState } from "react";
import { useStore } from "../store/AppStore";
import { Card, Chip } from "../components/ui";

const PLANS: Array<{
  id: "monthly" | "yearly" | "lifetime";
  name: string;
  price: string;
  per: string;
  blurb: string;
  featured?: boolean;
}> = [
  { id: "monthly", name: "Monthly", price: "₹149", per: "/month", blurb: "Cancel anytime" },
  { id: "yearly", name: "Yearly", price: "₹899", per: "/year", blurb: "Save 50% · most popular", featured: true },
  { id: "lifetime", name: "Lifetime", price: "₹2,499", per: "once", blurb: "Pay once, yours forever" },
];

const FEATURES: Array<[string, string, string]> = [
  ["Unlimited focus sessions", "✅", "✅"],
  ["Basic timer (study / stopwatch / countdown)", "✅", "✅"],
  ["App blocking (5 apps)", "✅", "✅"],
  ["Screen-time tracking & insights", "✅", "✅"],
  ["Focus Planner", "✅", "✅"],
  ["Multiplayer study rooms", "✅", "✅"],
  ["Pomodoro mode with auto breaks", "—", "✅"],
  ["Strict Mode (levels 1-3)", "—", "✅"],
  ["Anti-uninstall guard", "—", "✅"],
  ["Focus music & soundscapes", "Basic", "All 10"],
  ["Premium themes & wallpapers", "2 themes", "All 7"],
  ["Block Reels, Shorts & adult sites", "—", "✅"],
  ["YouTube Study Mode (channel allow-list)", "—", "✅"],
  ["Focus Guard reminders", "—", "✅"],
  ["Unlimited custom block lists", "10 items", "Unlimited"],
];

export function ProPage() {
  const { state, actions } = useStore();
  const [selected, setSelected] = useState<(typeof PLANS)[number]["id"]>("yearly");

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="pro-hero">
        <div className="row wrap" style={{ gap: 16 }}>
          <div style={{ fontSize: 46 }}>✨</div>
          <div>
            <h2 style={{ margin: 0, fontSize: 26 }}>Regain Pro</h2>
            <p className="muted" style={{ margin: "6px 0 0", maxWidth: 620 }}>
              Everything that makes quitting hard: Strict Mode, Pomodoro cycles, every focus
              soundscape, premium themes, and full Reels/Shorts + adult-site blocking with YouTube
              Study Mode.
            </p>
          </div>
          <div className="spacer" />
          <div style={{ textAlign: "right" }}>
            <Chip tone={state.settings.pro ? "good" : "accent"}>
              {state.settings.pro ? `Pro active · ${state.settings.proPlan}` : "Free plan"}
            </Chip>
            {state.settings.pro && (
              <div style={{ marginTop: 10 }}>
                <button className="btn sm" onClick={() => actions.updateSettings({ pro: false })}>
                  Switch back to Free
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid cols-3" style={{ gap: 16 }}>
        {PLANS.map((p) => (
          <button
            key={p.id}
            className={`price-card ${p.featured ? "featured" : ""}`}
            style={{
              textAlign: "left",
              cursor: "pointer",
              borderColor: selected === p.id ? "var(--accent)" : undefined,
            }}
            onClick={() => setSelected(p.id)}
          >
            <div className="row">
              <strong style={{ fontSize: 15 }}>{p.name}</strong>
              <div className="spacer" />
              {p.featured && <Chip tone="accent">popular</Chip>}
            </div>
            <div style={{ marginTop: 10, fontSize: 26, fontWeight: 700 }}>
              {p.price}
              <span className="small muted" style={{ fontWeight: 400 }}> {p.per}</span>
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>{p.blurb}</div>
            {selected === p.id && (
              <div className="chip accent" style={{ marginTop: 12 }}>selected</div>
            )}
          </button>
        ))}
      </div>

      <div className="row wrap" style={{ gap: 12 }}>
        <button
          className="btn primary lg"
          onClick={() => actions.updateSettings({ pro: true, proPlan: selected })}
        >
          {state.settings.pro ? "Update plan" : "Activate Pro"}
        </button>
        <span className="small muted">
          Demo activation — no payment is processed in this build. Wire it to the Play Store / App
          Store billing or Razorpay in production.
        </span>
      </div>

      <Card head="Free vs Pro" hint="Exactly what you get on each plan">
        <table className="plain">
          <thead>
            <tr>
              <th>Feature</th>
              <th style={{ width: 110 }}>Free</th>
              <th style={{ width: 130 }}>Pro</th>
            </tr>
          </thead>
          <tbody>
            {FEATURES.map(([name, free, pro]) => (
              <tr key={name}>
                <td>{name}</td>
                <td className={free === "—" ? "muted" : ""}>{free}</td>
                <td style={{ fontWeight: 560 }}>{pro}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid cols-3" style={{ gap: 16 }}>
        {[
          { icon: "🔒", title: "Strict Mode", body: "Level 3 sessions cannot be stopped. Combine with the anti-uninstall guard for exam season." },
          { icon: "🍅", title: "Pomodoro cycles", body: "Auto-starting breaks and focus rounds, with long breaks every N rounds." },
          { icon: "🎧", title: "Focus music", body: "Rain, ocean, fireplace, forest, café, lo-fi and 40 Hz deep-focus drone." },
        ].map((c) => (
          <Card key={c.title} className="tight">
            <div style={{ fontSize: 24 }}>{c.icon}</div>
            <div style={{ fontWeight: 620, marginTop: 8 }}>{c.title}</div>
            <div className="small muted" style={{ marginTop: 4 }}>{c.body}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
