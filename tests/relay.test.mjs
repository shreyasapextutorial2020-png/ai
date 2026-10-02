/**
 * Relay protocol test: hello → presence, progress fan-out, chat, reactions, bye.
 * Speaks raw RFC 6455 so it also proves the hand-rolled server is spec-correct.
 *
 *   node tests/relay.test.mjs
 */
import { connect as wsConnect } from "./helpers/ws.mjs";

const PORT = Number(process.env.REGAIN_RELAY_PORT || 8790);
const HOST = "127.0.0.1";

const connect = (name) => wsConnect(PORT, HOST, name);
/** Fresh room per run so leftover members from earlier runs cannot interfere. */
const ROOM = `T${Date.now().toString(36).slice(-6).toUpperCase()}`;

const results = [];
const check = (label, ok, extra = "") => {
  results.push({ label, ok, extra });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
};

const member = (id, name, minutes = 0) => ({
  id,
  name,
  avatar: "🦊",
  minutes,
  targetMinutes: 120,
  focusing: true,
  sessionSec: 600,
  distractions: 0,
});

try {
  const a = await connect("A");
  const b = await connect("B");

  a.send({ t: "hello", room: ROOM, member: member("member-a", "Aarav", 0) });
  const stateA = await a.next((m) => m.t === "state");
  check("A joins room and receives state", stateA.members.some((m) => m.id === "member-a"));
  check("new room starts with exactly one member", stateA.members.length === 1, `members=${stateA.members.length}`);

  a.send({ t: "progress", member: { ...member("member-a", "Aarav"), minutes: 42 } });
  await new Promise((r) => setTimeout(r, 200));

  b.send({ t: "hello", room: ROOM, member: member("member-b", "Meera", 5) });
  const stateB = await b.next((m) => m.t === "state" && m.members.length === 2);
  const relayed = stateB.members.find((m) => m.id === "member-a");
  check("second client sees both members", stateB.members.length === 2, `members=${stateB.members.map((m) => m.name).join(",")}`);
  check("progress is relayed (A shows 42 focused minutes)", relayed?.minutes === 42, `minutes=${relayed?.minutes}`);

  const stateA2 = await a.next((m) => m.t === "state" && m.members.length === 2);
  check("first client is notified when B joins", stateA2.members.length === 2);

  a.send({
    t: "chat",
    text: "Starting integration practice — 50 minutes.",
    member: { ...member("member-a", "Aarav"), name: "Aarav" },
  });
  const chatB = await b.next((m) => m.t === "state" && m.chat.length > 0);
  check("chat fans out to other members", chatB.chat[0]?.text?.startsWith("Starting integration"), chatB.chat[0]?.text);
  check("chat carries author identity", chatB.chat[0]?.name === "Aarav" && chatB.chat[0]?.avatar === "🦊");

  b.send({ t: "reaction", emoji: "🔥", member: member("member-b", "Meera") });
  const reactA = await a.next((m) => m.t === "state" && m.members.some((x) => x.reactions));
  const reactionMember = reactA.members.find((m) => m.id === "member-b");
  check("reactions are counted per member", reactionMember?.reactions?.["🔥"] === 1, JSON.stringify(reactionMember?.reactions));

  b.send({ t: "bye", member: member("member-b", "Meera") });
  const byeA = await a.next((m) => m.t === "state" && m.members.length === 1);
  check("leaving removes the member from the room", byeA.members.length === 1 && byeA.members[0].id === "member-a");

  const health = await fetch(`http://${HOST}:${PORT}/health`).then((r) => r.json());
  check("health endpoint reports live rooms", health.ok === true && health.rooms >= 1, JSON.stringify(health));
  check("health counts the remaining member", health.members >= 1, JSON.stringify(health));

  a.close();
  b.close();
} catch (error) {
  check("relay test suite", false, String(error));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} relay checks passed`);
process.exit(failed.length ? 1 : 0);
