import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store/AppStore";
import { Bar, Card, Chip, Empty, Stat } from "../components/ui";
import { fmtClock, fmtShort, minutesToClock } from "../lib/utils";
import { roomLink } from "../lib/rooms";

const REACTIONS = ["👍", "🔥", "🎯", "👏", "☕", "🧠"];

export function RoomsPage() {
  const { state, actions, roomStatus, isFocusActive, todayFocusedSec, elapsedSec } = useStore();
  const room = state.room;

  const [name, setName] = useState("Late-night revision club");
  const [goal, setGoal] = useState(120);
  const [bots, setBots] = useState(3);
  const [code, setCode] = useState("");
  const [chatText, setChatText] = useState("");
  const [copied, setCopied] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());

  // keep relative timestamps fresh
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 20000);
    return () => window.clearInterval(id);
  }, []);

  // deep link: #room=CODE
  useEffect(() => {
    if (room) return;
    const match = /#room=([A-Z0-9]{4,8})/i.exec(window.location.hash);
    if (match) setCode(match[1].toUpperCase());
  }, [room]);

  const leaderboard = useMemo(() => {
    if (!room) return [];
    return [...room.members].sort((a, b) => b.minutes - a.minutes);
  }, [room]);

  const self = room?.members.find((m) => m.isSelf);
  const myMinutes = self?.minutes ?? Math.floor(todayFocusedSec / 60);
  const roomTotal = room ? room.members.reduce((a, m) => a + m.minutes, 0) : 0;
  const focusingCount = room ? room.members.filter((m) => m.focusing).length : 0;

  if (!room) {
    return (
      <div className="grid cols-2" style={{ gap: 16, alignItems: "start" }}>
        <Card head="Start a focus room" hint="Everyone studies together, live">
          <div className="grid" style={{ gap: 14 }}>
            <label>
              <div className="stat-label" style={{ marginBottom: 6 }}>Room name</div>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <div>
              <div className="row">
                <span className="stat-label">Session goal</span>
                <div className="spacer" />
                <span className="small mono">{minutesToClock(goal)}</span>
              </div>
              <input
                type="range"
                min={30}
                max={360}
                step={15}
                value={goal}
                onChange={(e) => setGoal(Number(e.target.value))}
                style={{ marginTop: 8 }}
              />
            </div>
            <div>
              <div className="row">
                <span className="stat-label">Study buddies to fill the leaderboard</span>
                <div className="spacer" />
                <span className="small mono">{bots}</span>
              </div>
              <input
                type="range"
                min={0}
                max={6}
                value={bots}
                onChange={(e) => setBots(Number(e.target.value))}
                style={{ marginTop: 8 }}
              />
              <div className="tiny muted" style={{ marginTop: 6 }}>
                Buddies keep the board alive while you wait for friends — real members replace them
                as they join over the relay.
              </div>
            </div>
            <button
              className="btn primary lg block"
              onClick={() => actions.createRoom({ name, goalMinutes: goal, bots })}
            >
              👥 Create room
            </button>
          </div>
        </Card>

        <div className="grid" style={{ gap: 16 }}>
          <Card head="Join with a code" hint="Friends share a 6-character code or a link">
            <div className="row" style={{ gap: 8 }}>
              <input
                className="input mono"
                placeholder="ABC123"
                style={{ textTransform: "uppercase" }}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <button
                className="btn primary"
                disabled={code.trim().length < 4}
                onClick={() => actions.joinRoom(code, { name: `Room ${code}`, goalMinutes: 120 })}
              >
                Join
              </button>
            </div>
            <p className="small muted" style={{ marginTop: 12 }}>
              Rooms sync through the Regain relay (<span className="mono">server/room-server.mjs</span>).
              When no relay is reachable the room still runs locally with simulated buddies.
            </p>
          </Card>

          <Card head="How multiplayer works">
            <div className="small muted" style={{ lineHeight: 1.8 }}>
              <ul style={{ paddingLeft: 18, margin: 0 }}>
                <li>Everyone sees the same live leaderboard of focused minutes.</li>
                <li>Room chat and reactions keep accountability social, not distracting.</li>
                <li>Starting a session inside a room tags it with the room code.</li>
                <li>Only focus minutes sync — nothing from your screen is uploaded.</li>
              </ul>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <Card className="tight">
        <div className="row wrap" style={{ gap: 12 }}>
          <div className="brand-mark" style={{ width: 42, height: 42 }}>
            👥
          </div>
          <div>
            <div style={{ fontWeight: 650 }}>{room.name}</div>
            <div className="small muted">
              Code <span className="mono">{room.code}</span> · goal {minutesToClock(room.goalMinutes)} ·
              created {new Date(room.createdAt).toLocaleTimeString()}
            </div>
          </div>
          <Chip tone={roomStatus === "online" ? "good" : roomStatus === "connecting" ? "warn" : ""}>
            {roomStatus === "online" ? "● relay connected" : roomStatus === "connecting" ? "◌ connecting" : "◌ local mode"}
          </Chip>
          <Chip tone="good">{focusingCount} focusing now</Chip>
          <div className="spacer" />
          <button
            className="btn sm"
            onClick={() => {
              void navigator.clipboard?.writeText(roomLink(room.code));
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? "✅ Copied" : "🔗 Copy invite link"}
          </button>
          <button className="btn sm danger" onClick={actions.leaveRoom}>
            Leave room
          </button>
        </div>
      </Card>

      <div className="grid cols-3" style={{ gap: 16 }}>
        <Card className="tight"><Stat label="Room total" value={minutesToClock(roomTotal)} icon="👥" sub={`${room.members.length} members`} /></Card>
        <Card className="tight"><Stat label="Your focus today" value={minutesToClock(myMinutes)} icon="⏱️" sub={isFocusActive ? `live ${fmtClock(elapsedSec)}` : "not in a session"} /></Card>
        <Card className="tight">
          <Stat
            label="Room goal"
            value={`${room.goalMinutes ? Math.min(100, Math.round((roomTotal / (room.goalMinutes * room.members.length)) * 100)) : 0}%`}
            icon="🎯"
            sub={minutesToClock(room.goalMinutes * room.members.length) + " combined"}
          />
        </Card>
      </div>

      <div className="grid cols-2" style={{ gap: 16, alignItems: "start" }}>
        <Card
          head="Live leaderboard"
          hint="Updates while everyone studies"
          actions={
            !isFocusActive ? (
              <button
                className="btn sm primary"
                onClick={() => actions.startSession({ mode: "study", label: `Room ${room.code}` })}
              >
                ▶ Focus with the room
              </button>
            ) : (
              <Chip tone="good">● you are focusing</Chip>
            )
          }
        >
          <div className="podium" style={{ marginBottom: 16 }}>
            {leaderboard.slice(0, 3).map((m, i) => {
              const heights = [150, 118, 96];
              return (
                <div
                  key={m.id}
                  className="place"
                  style={{
                    height: heights[i],
                    background:
                      i === 0
                        ? "linear-gradient(180deg, rgba(245,158,11,.5), rgba(255,255,255,.04))"
                        : i === 1
                          ? "linear-gradient(180deg, rgba(56,189,248,.4), rgba(255,255,255,.04))"
                          : "linear-gradient(180deg, rgba(124,92,255,.4), rgba(255,255,255,.04))",
                  }}
                >
                  <div style={{ fontSize: 24 }}>{m.avatar}</div>
                  <div className="small" style={{ fontWeight: 620 }}>{m.name}</div>
                  <div className="tiny mono">{minutesToClock(m.minutes)}</div>
                </div>
              );
            })}
          </div>

          <div className="list">
            {leaderboard.map((m, i) => (
              <div className={`member ${m.isSelf ? "self" : ""}`} key={m.id} style={{ marginBottom: 8 }}>
                <div className="ava">
                  {m.avatar}
                  <span className={`dot ${m.focusing ? "on" : ""}`} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <strong style={{ fontSize: 13.5 }}>
                      #{i + 1} {m.name} {m.isSelf ? "(you)" : ""}
                    </strong>
                    {m.isBot && <Chip className="tiny">buddy</Chip>}
                    {m.focusing ? <Chip tone="good">focusing {fmtClock(m.sessionSec)}</Chip> : <Chip tone="warn">on a break</Chip>}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <Bar value={m.minutes} max={room.goalMinutes} />
                  </div>
                  <div className="tiny muted" style={{ marginTop: 4 }}>
                    {minutesToClock(m.minutes)} of {minutesToClock(m.targetMinutes)} · {m.distractions} slips ·{" "}
                    joined {Math.max(0, Math.round((nowTick - m.joinedAt) / 60000))} min ago
                  </div>
                </div>
                <div className="row" style={{ gap: 4 }}>
                  {m.reactions &&
                    Object.entries(m.reactions)
                      .slice(-2)
                      .map(([emoji, count]) => (
                        <Chip key={emoji} className="tiny">
                          {emoji} {count}
                        </Chip>
                      ))}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <div className="grid" style={{ gap: 16 }}>
          <Card head="Room chat" hint="Accountability, not scroll">
            <div className="chat">
              {room.chat.slice(-30).map((msg) => (
                <div key={msg.id} className={`chat-msg ${msg.memberId === self?.id ? "self" : ""}`}>
                  <div className="avatar">{msg.avatar}</div>
                  <div>
                    <div className="chat-name">
                      {msg.name} ·{" "}
                      {new Date(msg.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                    <div className="chat-bubble">{msg.text}</div>
                  </div>
                </div>
              ))}
              {room.chat.length === 0 && <Empty icon="💬" title="Say hi to your study buddies" />}
            </div>
            <div className="row" style={{ gap: 8, marginTop: 14 }}>
              <input
                className="input"
                placeholder="Typing a message…"
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    actions.sendChat(chatText);
                    setChatText("");
                  }
                }}
              />
              <button
                className="btn primary"
                onClick={() => {
                  actions.sendChat(chatText);
                  setChatText("");
                }}
              >
                Send
              </button>
            </div>
            <div className="row wrap" style={{ gap: 6, marginTop: 12 }}>
              {REACTIONS.map((emoji) => (
                <button key={emoji} className="btn sm" onClick={() => actions.sendReaction(emoji)}>
                  {emoji}
                </button>
              ))}
            </div>
          </Card>

          <Card head="Session with the room">
            <div className="small muted" style={{ lineHeight: 1.8 }}>
              Your last room session:{" "}
              {state.sessions.filter((s) => s.roomId === room.code).length} logged. Everyone's blocked
              distractions are counted privately — only aggregated minutes are shared.
            </div>
            <div className="row" style={{ gap: 8, marginTop: 12 }}>
              <Chip tone="accent">{focusingCount} focusing</Chip>
              <Chip>{room.members.length - focusingCount} on break</Chip>
              <Chip>streak-safe</Chip>
            </div>
            <button className="btn block" style={{ marginTop: 14 }} onClick={() => actions.sendReaction("🎯")}>
              🎯 Nudge everyone to focus
            </button>
            <p className="tiny muted" style={{ marginTop: 10 }}>
              Room total today: {fmtShort(roomTotal * 60)}.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
