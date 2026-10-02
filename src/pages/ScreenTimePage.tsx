import { useMemo, useState } from "react";
import { useStore } from "../store/AppStore";
import { Bar, Card, Chip, Empty, Stat } from "../components/ui";
import { CATEGORY_COLOURS, CATEGORY_LABELS } from "../lib/defaults";
import {
  dailyBuckets,
  distractionFreePercent,
  fmtDay,
  fmtDate,
  fmtShort,
  lastNDays,
  usageForDate,
} from "../lib/utils";

type Tab = "overview" | "apps" | "websites" | "blocked" | "sessions";

export function ScreenTimePage() {
  const { state, actions, todayFocusedSec, isFocusActive } = useStore();
  const days = useMemo(() => lastNDays(10).reverse(), []);
  const [day, setDay] = useState(days[0]);
  const [tab, setTab] = useState<Tab>("overview");

  const appUsage = useMemo(() => usageForDate(state.usage, day, "app"), [state.usage, day]);
  const webUsage = useMemo(() => usageForDate(state.usage, day, "web"), [state.usage, day]);
  const totalScreen = useMemo(
    () => [...appUsage, ...webUsage].reduce((a, u) => a + u.seconds, 0),
    [appUsage, webUsage],
  );
  const sessionsToday = useMemo(
    () => state.sessions.filter((s) => new Date(s.endedAt).toISOString().slice(0, 10) === day),
    [state.sessions, day],
  );
  const focusedToday = sessionsToday.reduce((a, s) => a + s.actualSec, 0);
  const blockedThisDay = state.blockedLog.filter(
    (b) => new Date(b.at).toISOString().slice(0, 10) === day,
  );

  const categoryTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of [...appUsage, ...webUsage]) {
      map.set(u.category, (map.get(u.category) ?? 0) + u.seconds);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [appUsage, webUsage]);

  const buckets = dailyBuckets(state.sessions, 14);
  const peak = Math.max(1, ...buckets.map((b) => b.focusedSec));
  const productiveSec =
    categoryTotals.find(([c]) => c === "study")?.[1] ?? 0;
  const distractingSec = categoryTotals
    .filter(([c]) => c === "social" || c === "video" || c === "games")
    .reduce((a, [, v]) => a + v, 0);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <Card className="tight">
        <div className="row wrap" style={{ gap: 10 }}>
          <span className="stat-label">Day</span>
          {days.map((d) => (
            <button
              key={d}
              className={`btn sm ${day === d ? "primary" : ""}`}
              onClick={() => setDay(d)}
            >
              {d === days[0] ? "Today" : fmtDay(d)}
            </button>
          ))}
          <div className="spacer" />
          {isFocusActive && <Chip tone="good">● tracking live</Chip>}
        </div>
      </Card>

      <div className="grid cols-4" style={{ gap: 16 }}>
        <Card className="tight">
          <Stat label="Screen time" value={fmtShort(totalScreen)} icon="🖥️" sub={`${appUsage.length} apps · ${webUsage.length} sites`} />
        </Card>
        <Card className="tight">
          <Stat
            label="Focus time"
            value={fmtShort(day === days[0] ? Math.max(focusedToday, todayFocusedSec) : focusedToday)}
            icon="⏱️"
            sub={`${sessionsToday.length} sessions`}
          />
        </Card>
        <Card className="tight">
          <Stat
            label="Distraction-free"
            value={`${distractionFreePercent(sessionsToday)}%`}
            icon="🧘"
            sub="sessions with zero slips"
          />
        </Card>
        <Card className="tight">
          <Stat label="Blocked" value={blockedThisDay.length} icon="🚫" sub="interception attempts" />
        </Card>
      </div>

      <div className="tabs">
        {(
          [
            ["overview", "📈 Overview"],
            ["apps", "🖥️ Apps"],
            ["websites", "🌐 Websites"],
            ["blocked", "🚫 Blocked"],
            ["sessions", "🗂️ Sessions & ratings"],
          ] as Array<[Tab, string]>
        ).map(([id, label]) => (
          <button key={id} className={`tab ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid cols-2" style={{ gap: 16 }}>
          <Card head="Focus per day" hint="Last 14 days">
            <div className="row" style={{ alignItems: "flex-end", gap: 6, height: 170 }}>
              {buckets.map((b) => (
                <div key={b.date} style={{ flex: 1, textAlign: "center" }} title={`${fmtDay(b.date)} · ${fmtShort(b.focusedSec)}`}>
                  <div
                    style={{
                      height: `${(b.focusedSec / peak) * 130}px`,
                      minHeight: 3,
                      borderRadius: 6,
                      background:
                        b.date === days[0]
                          ? "linear-gradient(180deg, var(--accent), var(--accent-2))"
                          : "rgba(255,255,255,.16)",
                    }}
                  />
                  <div className="tiny muted" style={{ marginTop: 6 }}>
                    {fmtDay(b.date).split(" ")[0]}
                  </div>
                </div>
              ))}
            </div>
            <div className="row" style={{ marginTop: 14, gap: 18 }}>
              <div>
                <div className="stat-label">Peak day</div>
                <div style={{ fontWeight: 620 }}>{fmtShort(peak)}</div>
              </div>
              <div>
                <div className="stat-label">Productive vs distracting</div>
                <div style={{ fontWeight: 620 }}>
                  {fmtShort(productiveSec)} <span className="muted">vs</span> {fmtShort(distractingSec)}
                </div>
              </div>
            </div>
          </Card>

          <Card head="Where the time goes" hint="Usage split by category">
            <Donut data={categoryTotals} total={totalScreen} />
            <div className="list" style={{ marginTop: 16 }}>
              {categoryTotals.slice(0, 6).map(([cat, sec]) => (
                <div className="row" key={cat} style={{ gap: 10 }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 3,
                      background: CATEGORY_COLOURS[cat] ?? "#64748b",
                    }}
                  />
                  <span className="small" style={{ width: 90 }}>{CATEGORY_LABELS[cat] ?? cat}</span>
                  <div style={{ flex: 1 }}>
                    <Bar value={sec} max={totalScreen} colour={CATEGORY_COLOURS[cat]} />
                  </div>
                  <span className="small mono" style={{ width: 62, textAlign: "right" }}>
                    {fmtShort(sec)}
                  </span>
                </div>
              ))}
              {categoryTotals.length === 0 && (
                <Empty icon="📊" title="Nothing recorded for this day" body="Start the desktop app or a focus session and data appears here." />
              )}
            </div>
          </Card>
        </div>
      )}

      {tab === "apps" && (
        <Card head="App usage" hint="Foreground time per process">
          <UsageList items={appUsage} total={totalScreen} />
        </Card>
      )}

      {tab === "websites" && (
        <Card head="Website usage" hint="Domains seen in the active browser tab">
          <UsageList items={webUsage} total={totalScreen} />
        </Card>
      )}

      {tab === "blocked" && (
        <Card head="Blocked attempts" hint="What Regain stopped you from opening">
          {blockedThisDay.length === 0 ? (
            <Empty icon="🛡️" title="No interceptions this day" body="Nice — either you were disciplined or blocking was off." />
          ) : (
            <div className="list">
              {[...blockedThisDay].reverse().map((b) => (
                <div className="list-row" key={b.id}>
                  <div className="icon">{b.icon}</div>
                  <div className="meta">
                    <div className="title">{b.label}</div>
                    <div className="sub mono">{b.key}</div>
                  </div>
                  {b.duringFocus ? <Chip tone="bad">during focus</Chip> : <Chip>outside focus</Chip>}
                  <span className="tiny muted">{new Date(b.at).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === "sessions" && (
        <Card head="Sessions & ratings" hint="👍 / 👎 any session to teach Regain your best pattern">
          {sessionsToday.length === 0 ? (
            <Empty icon="🗂️" title="No sessions on this day" />
          ) : (
            <div className="list">
              {[...sessionsToday].reverse().map((s) => (
                <div className="list-row" key={s.id}>
                  <div className="icon">
                    {s.mode === "pomodoro" ? "🍅" : s.mode === "countdown" ? "⏳" : s.mode === "stopwatch" ? "⏲️" : "📚"}
                  </div>
                  <div className="meta">
                    <div className="title">
                      {s.label} · {s.subject}
                    </div>
                    <div className="sub">
                      {fmtDate(s.endedAt)} · {fmtShort(s.actualSec)}
                      {s.plannedSec > 0 && ` of ${fmtShort(s.plannedSec)}`} ·{" "}
                      {s.blocked} blocked · {s.distractions} slips
                    </div>
                  </div>
                  {s.strict && <Chip tone="bad">strict</Chip>}
                  {s.completed ? <Chip tone="good">completed</Chip> : <Chip tone="warn">stopped early</Chip>}
                  <button
                    className={`btn sm ${s.rating === "like" ? "good" : ""}`}
                    onClick={() => actions.rateSession(s.id, "like")}
                  >
                    👍
                  </button>
                  <button
                    className={`btn sm ${s.rating === "dislike" ? "danger" : ""}`}
                    onClick={() => actions.rateSession(s.id, "dislike")}
                  >
                    👎
                  </button>
                  <button className="btn sm ghost" onClick={() => actions.deleteSession(s.id)}>
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          )}
          {state.demoData && (
            <p className="tiny muted" style={{ marginTop: 14 }}>
              Includes illustrative sample history so the charts are meaningful on a fresh install.
              Clear it in Settings → Data.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}

function UsageList({
  items,
  total,
}: {
  items: Array<{ key: string; label: string; icon: string; seconds: number; category: string }>;
  total: number;
}) {
  if (!items.length) {
    return <Empty icon="🕳️" title="No usage recorded" body="Usage lands here once the desktop monitor or extension reports activity." />;
  }
  return (
    <div className="list">
      {items.map((u) => (
        <div className="list-row" key={u.key}>
          <div className="icon">{u.icon}</div>
          <div className="meta">
            <div className="title">{u.label}</div>
            <div className="sub mono">{u.key}</div>
          </div>
          <div style={{ width: 160 }}>
            <Bar value={u.seconds} max={total} colour={CATEGORY_COLOURS[u.category]} />
          </div>
          <span className="small mono" style={{ width: 66, textAlign: "right" }}>
            {fmtShort(u.seconds)}
          </span>
          <Chip className="tiny">{CATEGORY_LABELS[u.category] ?? u.category}</Chip>
        </div>
      ))}
    </div>
  );
}

function Donut({ data, total }: { data: Array<[string, number]>; total: number }) {
  const size = 168;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="row" style={{ gap: 18 }}>
      <svg width={size} height={size} className="ring">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} stroke="rgba(255,255,255,.07)" />
        {data.map(([cat, sec]) => {
          const frac = total <= 0 ? 0 : sec / total;
          const dash = frac * c;
          const el = (
            <circle
              key={cat}
              cx={size / 2}
              cy={size / 2}
              r={r}
              strokeWidth={stroke}
              stroke={CATEGORY_COLOURS[cat] ?? "#64748b"}
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
            />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div>
        <div className="stat-label">Total tracked</div>
        <div className="stat-value">{fmtShort(total)}</div>
        <div className="small muted" style={{ marginTop: 6 }}>
          {data.length ? `Top: ${CATEGORY_LABELS[data[0][0]] ?? data[0][0]} (${fmtShort(data[0][1])})` : "No data yet"}
        </div>
      </div>
    </div>
  );
}
