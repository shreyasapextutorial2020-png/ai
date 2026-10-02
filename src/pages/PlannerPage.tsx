import { useMemo, useState } from "react";
import { useStore } from "../store/AppStore";
import { Card, Chip, Modal, Stat, Toggle } from "../components/ui";
import { clockToMinutes, fmtShort, minutesToClockStr, todayKey, weekdayShort } from "../lib/utils";
import { uid } from "../lib/defaults";
import type { FocusBlock } from "../lib/types";

const COLOURS = ["#7c5cff", "#38bdf8", "#2fbf8f", "#f59e0b", "#fb7185", "#e879f9"];
const SUBJECTS = ["Maths", "Physics", "Chemistry", "Biology", "Computer Science", "English", "Revision", "All"];

const blank = (day: number): FocusBlock => ({
  id: uid(),
  day,
  start: "19:00",
  end: "20:30",
  label: "Focus block",
  subject: "Maths",
  colour: COLOURS[0],
  reminder: true,
  completedOn: [],
});

export function PlannerPage() {
  const { state, actions, today } = useStore();
  const [editing, setEditing] = useState<FocusBlock | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);

  const weekDates = useMemo(() => {
    const base = new Date();
    base.setDate(base.getDate() + weekOffset * 7);
    const start = new Date(base);
    start.setDate(base.getDate() - base.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [weekOffset]);

  const todayIdx = new Date().getDay();
  const plannedMinutesWeek = state.blocks.reduce((acc, b) => {
    const [sh, sm] = b.start.split(":").map(Number);
    const [eh, em] = b.end.split(":").map(Number);
    return acc + Math.max(0, eh * 60 + em - (sh * 60 + sm));
  }, 0);

  const doneThisWeek = state.blocks.reduce(
    (acc, b) => acc + b.completedOn.filter((d) => weekDates.some((w) => todayKey(w) === d)).length,
    0,
  );

  const upNext = useMemo(() => {
    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
    const todays = state.blocks
      .filter((b) => b.day === todayIdx)
      .sort((a, b) => clockToMinutes(a.start) - clockToMinutes(b.start));
    return (
      todays.find((b) => clockToMinutes(b.end) >= nowMinutes) ?? todays[todays.length - 1] ?? null
    );
  }, [state.blocks, todayIdx]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="grid cols-3" style={{ gap: 16 }}>
        <Card className="tight">
          <Stat label="Planned this week" value={fmtShort(plannedMinutesWeek * 60)} icon="🗓️" sub={`${state.blocks.length} blocks`} />
        </Card>
        <Card className="tight">
          <Stat label="Completed" value={doneThisWeek} icon="✅" sub="ticked off in this week" />
        </Card>
        <Card className="tight">
          <Stat
            label="Next up"
            value={upNext ? upNext.start : "—"}
            icon="⏭️"
            sub={upNext ? `${upNext.label} · ${upNext.subject}` : "nothing scheduled today"}
          />
        </Card>
      </div>

      <Card
        head="Weekly focus plan"
        hint="Click any block to edit it, or press + to add one"
        actions={
          <div className="row" style={{ gap: 8 }}>
            <button className="btn sm" onClick={() => setWeekOffset((w) => w - 1)}>
              ◀
            </button>
            <button className="btn sm" onClick={() => setWeekOffset(0)}>
              This week
            </button>
            <button className="btn sm" onClick={() => setWeekOffset((w) => w + 1)}>
              ▶
            </button>
            <button className="btn sm primary" onClick={() => setEditing(blank(todayIdx))}>
              + Add block
            </button>
          </div>
        }
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
            gap: 10,
          }}
        >
          {weekDates.map((date, i) => {
            const key = todayKey(date);
            const isToday = key === today;
            const dayBlocks = state.blocks
              .filter((b) => b.day === i)
              .sort((a, b) => clockToMinutes(a.start) - clockToMinutes(b.start));
            return (
              <div
                key={key}
                style={{
                  borderRadius: 14,
                  border: `1px solid ${isToday ? "color-mix(in srgb, var(--accent) 55%, transparent)" : "var(--border)"}`,
                  background: isToday ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "rgba(255,255,255,.03)",
                  padding: 10,
                  minHeight: 220,
                }}
              >
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div>
                    <div className="small" style={{ fontWeight: 620 }}>
                      {weekdayShort(i)}
                    </div>
                    <div className="tiny muted">{date.getDate()}</div>
                  </div>
                  <button
                    className="btn sm ghost"
                    title="Add block"
                    onClick={() => setEditing(blank(i))}
                  >
                    +
                  </button>
                </div>
                <div className="grid" style={{ gap: 8, marginTop: 10 }}>
                  {dayBlocks.map((b) => {
                    const done = b.completedOn.includes(key);
                    return (
                      <button
                        key={b.id}
                        onClick={() => setEditing(b)}
                        style={{
                          textAlign: "left",
                          border: `1px solid ${b.colour}55`,
                          borderLeft: `3px solid ${b.colour}`,
                          background: done ? "rgba(47,191,143,.14)" : `${b.colour}1f`,
                          borderRadius: 10,
                          padding: "7px 9px",
                          cursor: "pointer",
                          opacity: done ? 0.75 : 1,
                        }}
                      >
                        <div className="tiny mono" style={{ fontWeight: 620 }}>
                          {b.start}–{b.end} {done ? "✅" : ""}
                        </div>
                        <div style={{ fontSize: 12.4, fontWeight: 560, marginTop: 2 }}>
                          {b.label}
                        </div>
                        <div className="tiny muted">{b.subject}</div>
                      </button>
                    );
                  })}
                  {dayBlocks.length === 0 && (
                    <div className="tiny muted" style={{ padding: "12px 4px", textAlign: "center" }}>
                      free
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card head="Today's routine" hint="Tick blocks off as you finish them">
        <div className="list">
          {state.blocks
            .filter((b) => b.day === todayIdx)
            .sort((a, b) => clockToMinutes(a.start) - clockToMinutes(b.start))
            .map((b) => {
              const done = b.completedOn.includes(today);
              return (
                <div className="list-row" key={b.id}>
                  <span
                    style={{
                      width: 6,
                      height: 38,
                      borderRadius: 4,
                      background: b.colour,
                      display: "inline-block",
                    }}
                  />
                  <div className="meta">
                    <div className="title">
                      {b.start}–{b.end} · {b.label}
                    </div>
                    <div className="sub">
                      {b.subject} · {fmtShort((clockToMinutes(b.end) - clockToMinutes(b.start)) * 60)}
                      {b.reminder ? " · reminder on" : ""}
                    </div>
                  </div>
                  {done && <Chip tone="good">done</Chip>}
                  <button className="btn sm" onClick={() => actions.toggleBlockDone(b.id, today)}>
                    {done ? "↩ Undo" : "✅ Mark done"}
                  </button>
                  <button
                    className="btn sm primary"
                    onClick={() =>
                      actions.startSession({
                        mode: "countdown",
                        label: b.label,
                        subject: b.subject,
                        plannedSec: Math.max(5, clockToMinutes(b.end) - clockToMinutes(b.start)) * 60,
                      })
                    }
                  >
                    ▶ Start
                  </button>
                </div>
              );
            })}
          {state.blocks.filter((b) => b.day === todayIdx).length === 0 && (
            <div className="small muted" style={{ padding: 12 }}>
              Nothing scheduled for {weekdayShort(todayIdx)} yet — add a block above.
            </div>
          )}
        </div>
      </Card>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Edit focus block" : "New focus block"}
        footer={
          <>
            {editing && state.blocks.some((b) => b.id === editing.id) && (
              <button
                className="btn danger"
                onClick={() => {
                  actions.deleteBlock(editing.id);
                  setEditing(null);
                }}
              >
                Delete
              </button>
            )}
            <button
              className="btn primary"
              onClick={() => {
                if (!editing) return;
                actions.saveBlock(editing);
                setEditing(null);
              }}
            >
              Save block
            </button>
          </>
        }
      >
        {editing && (
          <div className="grid" style={{ gap: 14 }}>
            <label>
              <div className="stat-label" style={{ marginBottom: 6 }}>Label</div>
              <input
                className="input"
                value={editing.label}
                onChange={(e) => setEditing({ ...editing, label: e.target.value })}
              />
            </label>
            <div className="grid cols-2" style={{ gap: 12 }}>
              <label>
                <div className="stat-label" style={{ marginBottom: 6 }}>Start</div>
                <input
                  className="input"
                  type="time"
                  value={editing.start}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      start: e.target.value,
                      end: minutesToClockStr(clockToMinutes(e.target.value) + 90),
                    })
                  }
                />
              </label>
              <label>
                <div className="stat-label" style={{ marginBottom: 6 }}>End</div>
                <input
                  className="input"
                  type="time"
                  value={editing.end}
                  onChange={(e) => setEditing({ ...editing, end: e.target.value })}
                />
              </label>
            </div>
            <div className="grid cols-2" style={{ gap: 12 }}>
              <label>
                <div className="stat-label" style={{ marginBottom: 6 }}>Day</div>
                <select
                  className="select"
                  value={editing.day}
                  onChange={(e) => setEditing({ ...editing, day: Number(e.target.value) })}
                >
                  {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                    <option key={d} value={d}>
                      {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <div className="stat-label" style={{ marginBottom: 6 }}>Subject</div>
                <select
                  className="select"
                  value={editing.subject}
                  onChange={(e) => setEditing({ ...editing, subject: e.target.value })}
                >
                  {SUBJECTS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <div className="stat-label" style={{ marginBottom: 8 }}>Colour</div>
              <div className="row" style={{ gap: 8 }}>
                {COLOURS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setEditing({ ...editing, colour: c })}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 9,
                      background: c,
                      border: editing.colour === c ? "2px solid #fff" : "1px solid var(--border)",
                      cursor: "pointer",
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Toggle
                on={editing.reminder}
                label="Remind me when this block starts"
                onChange={(v) => setEditing({ ...editing, reminder: v })}
              />
              <div>
                <div style={{ fontWeight: 560, fontSize: 13.5 }}>Remind me when it starts</div>
                <div className="small muted">Uses the Focus Guard toast + a system notification.</div>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
