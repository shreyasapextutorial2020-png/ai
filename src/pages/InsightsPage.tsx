import { useMemo } from "react";
import { useStore } from "../store/AppStore";
import { Bar, Card, Chip, Stat } from "../components/ui";
import {
  bestDay,
  dailyBuckets,
  distractionFreePercent,
  fmtDay,
  fmtShort,
  subjectBreakdown,
  totalFocus,
  trend,
} from "../lib/utils";
import { recommendSession } from "../lib/recommend";
import { CATEGORY_COLOURS } from "../lib/defaults";

export function InsightsPage() {
  const { state, actions } = useStore();
  const sessions = state.sessions;

  const heat = useMemo(() => dailyBuckets(sessions, 70), [sessions]);
  const peak = Math.max(1, ...heat.map((h) => h.focusedSec));
  const subjects = useMemo(() => subjectBreakdown(sessions), [sessions]);
  const best = useMemo(() => bestDay(sessions), [sessions]);
  const trendPct = useMemo(() => trend(sessions, 7), [sessions]);

  const liked = sessions.filter((s) => s.rating === "like");
  const disliked = sessions.filter((s) => s.rating === "dislike");
  const avgLiked = liked.length ? liked.reduce((a, s) => a + s.actualSec, 0) / liked.length : 0;
  const avgDisliked = disliked.length
    ? disliked.reduce((a, s) => a + s.actualSec, 0) / disliked.length
    : 0;
  const avgSession = sessions.length ? totalFocus(sessions) / sessions.length : 0;
  const suggestion = recommendSession(sessions);
  const strictDone = sessions.filter((s) => s.strict && s.completed).length;

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="grid cols-4" style={{ gap: 16 }}>
        <Card className="tight">
          <Stat label="Streak" value={`${state.streak.current} days`} icon="🔥" sub={`best ${state.streak.best} days`} />
        </Card>
        <Card className="tight">
          <Stat label="All-time focus" value={fmtShort(totalFocus(sessions))} icon="⏱️" sub={`${sessions.length} sessions`} />
        </Card>
        <Card className="tight">
          <Stat
            label="Last 7 days"
            value={`${trendPct >= 0 ? "+" : ""}${trendPct}%`}
            icon={trendPct >= 0 ? "📈" : "📉"}
            sub="vs the week before"
          />
        </Card>
        <Card className="tight">
          <Stat label="Discipline" value={`${distractionFreePercent(sessions)}%`} icon="🧘" sub="sessions with no slips" />
        </Card>
      </div>

      <Card head="Consistency map" hint="Last 10 weeks of focused time">
        <div className="heat" style={{ gridTemplateColumns: "repeat(14, minmax(0,1fr))" }}>
          {heat.map((h) => {
            const intensity = h.focusedSec / peak;
            return (
              <i
                key={h.date}
                title={`${fmtDay(h.date)} · ${fmtShort(h.focusedSec)}`}
                style={{
                  background:
                    h.focusedSec === 0
                      ? "rgba(255,255,255,.06)"
                      : `color-mix(in srgb, var(--accent) ${Math.max(18, Math.round(intensity * 100))}%, transparent)`,
                }}
              />
            );
          })}
        </div>
        <div className="row" style={{ marginTop: 14, gap: 16 }}>
          <span className="tiny muted">Less</span>
          <div className="row" style={{ gap: 4 }}>
            {[0.15, 0.35, 0.6, 0.85, 1].map((i) => (
              <i
                key={i}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 4,
                  display: "block",
                  background: `color-mix(in srgb, var(--accent) ${i * 100}%, transparent)`,
                }}
              />
            ))}
          </div>
          <span className="tiny muted">More</span>
          <div className="spacer" />
          <span className="small muted">
            Best day: {fmtDay(best.date)} · {fmtShort(best.focusedSec)}
          </span>
        </div>
      </Card>

      <div className="grid cols-2" style={{ gap: 16, alignItems: "start" }}>
        <Card head="Subject balance" hint="Where your focus time actually goes">
          {subjects.length === 0 ? (
            <div className="small muted">No sessions logged yet.</div>
          ) : (
            <div className="grid" style={{ gap: 12 }}>
              {subjects.map((s, i) => (
                <div key={s.subject}>
                  <div className="row">
                    <span className="small" style={{ fontWeight: 560 }}>{s.subject}</span>
                    <div className="spacer" />
                    <span className="small mono">{fmtShort(s.seconds)}</span>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <Bar
                      value={s.seconds}
                      max={subjects[0].seconds}
                      colour={Object.values(CATEGORY_COLOURS)[i % Object.values(CATEGORY_COLOURS).length]}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card head="What your ratings say" hint="👍 / 👎 drives every suggestion">
          <div className="grid cols-2" style={{ gap: 14 }}>
            <Stat label="Liked" value={liked.length} icon="👍" sub={avgLiked ? `avg ${fmtShort(avgLiked)}` : "—"} />
            <Stat label="Disliked" value={disliked.length} icon="👎" sub={avgDisliked ? `avg ${fmtShort(avgDisliked)}` : "—"} />
            <Stat label="Avg session" value={fmtShort(avgSession)} icon="📏" />
            <Stat label="Strict finishes" value={strictDone} icon="🔒" />
          </div>
          <div className="small muted" style={{ marginTop: 14, lineHeight: 1.7 }}>
            {liked.length === 0 && disliked.length === 0
              ? "Rate a session with 👍 or 👎 on the Focus page and Regain starts tailoring block length, mode and time of day."
              : `You finish ${
                  avgLiked > avgDisliked ? "longer" : "shorter"
                } sessions that you rate highly, which suggests ${
                  avgLiked > avgDisliked ? "your ideal block is longer than average — push the countdown up." : "shorter sprints keep you engaged — try 25 minute rounds."
                }`}
          </div>
          {suggestion && (
            <div className="row" style={{ marginTop: 14, gap: 10 }}>
              <button
                className="btn primary"
                onClick={() =>
                  actions.startSession({
                    mode: suggestion.mode,
                    subject: suggestion.subject,
                    label: `${suggestion.minutes} min suggested block`,
                    plannedSec: suggestion.minutes * 60,
                  })
                }
              >
                ▶ Run suggestion
              </button>
              <Chip tone="accent">{suggestion.title}</Chip>
            </div>
          )}
        </Card>
      </div>

      <Card head="Session quality" hint="Completion rate and blocked distractions over time">
        <div className="grid cols-3" style={{ gap: 16 }}>
          <div>
            <div className="stat-label">Completed sessions</div>
            <div className="stat-value">
              {sessions.length
                ? Math.round((sessions.filter((s) => s.completed).length / sessions.length) * 100)
                : 0}
              %
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>
              {sessions.filter((s) => s.completed).length} of {sessions.length} finished to the end.
            </div>
          </div>
          <div>
            <div className="stat-label">Blocked attempts</div>
            <div className="stat-value">{sessions.reduce((a, s) => a + s.blocked, 0)}</div>
            <div className="small muted" style={{ marginTop: 6 }}>
              Every interception is one avoided scroll hole.
            </div>
          </div>
          <div>
            <div className="stat-label">Total XP</div>
            <div className="stat-value">{state.streak.xp}</div>
            <div className="small muted" style={{ marginTop: 6 }}>
              One XP per focused minute.
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
