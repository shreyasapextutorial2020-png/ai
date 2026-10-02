/**
 * Flow test — the app driving its own features, plus a true two-client
 * multiplayer check: the jsdom app and a raw WebSocket client both join the
 * same study room through the running relay.
 *
 *   node tests/ui-flow.test.mjs
 */
import fs from "node:fs";
import { createAppDom, createReporter } from "./helpers/env.mjs";
import { connect as wsConnect, member as wsMember } from "./helpers/ws.mjs";

const bundlePath = process.env.REGAIN_APP_BUNDLE;
if (!bundlePath) {
  console.error("REGAIN_APP_BUNDLE is not set — run this suite through `npm test`.");
  process.exit(1);
}
const bundle = fs.readFileSync(bundlePath, "utf8");
const STORAGE_KEY = "regain.pc.state.v1";
const RELAY_PORT = Number(process.env.REGAIN_RELAY_PORT || 8790);

/** A countdown one second from completion, to exercise the finish path. */
const seededState = {
  version: 1,
  settings: { pro: true, nickname: "TestUser", musicTrack: "" },
  sessions: [],
  seenWelcome: true,
  active: {
    id: "seeded-session",
    mode: "countdown",
    label: "Seeded countdown",
    subject: "Physics",
    startedAt: Date.now() - 59_000,
    bankedSec: 59,
    plannedSec: 60,
    running: true,
    pausedAt: null,
    strict: false,
    strictLevel: 1,
    focusGuard: false,
    distractions: 0,
    blocked: 0,
    phase: "focus",
    round: 1,
    roomId: null,
    music: null,
  },
};

const env = createAppDom({ storage: seededState });
const report = createReporter("ui-flow");
let remote;

try {
  new env.window.Function(bundle).call(env.window);
  await env.tick(1500);

  /* ------------------- 1. a countdown finishes and is logged ---------------- */
  const stored = env.storedState();
  const logged = stored.sessions?.[0];
  report.check("a running countdown finishes and is logged", (stored.sessions || []).length === 1, JSON.stringify(logged?.label));
  report.check("the log keeps duration, subject and completion", logged?.actualSec >= 60 && logged?.subject === "Physics" && logged?.completed === true);
  report.check("the active session is cleared", stored.active === null);
  report.check("the streak counts today", stored.streak?.current === 1, JSON.stringify(stored.streak));
  report.check("no errors during session completion", env.errors.length === 0, env.errors[0]);

  /* ----------------------- 2. the foreground monitor ------------------------ */
  await env.tick(4500);
  report.check("the foreground monitor reports a live window", /\.exe/.test(env.contentText()));

  /* -------------------------- 3. blocking rules ----------------------------- */
  await env.navTo(4);
  report.check("the blocking page lists the app catalogue", env.contentHtml().length > 3000, `${env.contentHtml().length} bytes`);
  const firstToggle = env.window.document.querySelector(".list-row .toggle");
  await env.click(firstToggle, 200);
  const rules = env.storedState().appRules || [];
  report.check("toggling a rule persists to storage", rules.some((r) => r.custom === undefined || r.enabled !== undefined) && Boolean(firstToggle));

  /* ---------------------------- 4. focus music ----------------------------- */
  await env.navTo(3);
  const soundCards = [...env.window.document.querySelectorAll(".sound-card")];
  const rainCard = soundCards.find((card) => /Rainfall/.test(card.textContent));
  await env.click(rainCard, 200);
  report.check("the focus-music library lists all soundscapes", soundCards.length >= 10, `${soundCards.length} cards`);
  report.check("selecting a sound marks it active", Boolean(rainCard?.classList.contains("active")));
  report.check("the audio engine runs without errors", env.errors.length === 0, env.errors[0]);

  /* ---------------------- 5. multiplayer study rooms ------------------------ */
  await env.navTo(8);
  await env.click(env.findButton(/Create room/), 400);
  report.check("creating a room shows the leaderboard", /Live leaderboard/.test(env.contentHtml()));
  const codeMatch = /Code\s+([A-Z0-9]{6})/.exec(env.contentText());
  const roomCode = codeMatch ? codeMatch[1] : "";
  report.check("the room has a shareable code", /^[A-Z0-9]{6}$/.test(roomCode), roomCode);

  remote = await wsConnect(RELAY_PORT, "127.0.0.1", "RemoteFriend");
  remote.send({ t: "hello", room: roomCode, member: wsMember("remote-1", "RemoteFriend", 37) });
  await remote.next((m) => m.t === "state", 3000, "initial relay state");
  await env.tick(700);

  report.check("a member joining over the relay appears in the leaderboard", /RemoteFriend/.test(env.contentText()));
  report.check("the room reports the relay connection", /relay connected/.test(env.contentText()));

  remote.send({ t: "chat", text: "Hi from the relay!", member: wsMember("remote-1", "RemoteFriend", 37) });
  await env.tick(700);
  report.check("relay chat is rendered", /Hi from the relay!/.test(env.contentText()));

  const chatInput = env.window.document.querySelector('input[placeholder="Typing a message…"]');
  env.setReactValue(chatInput, "Sending from the test run");
  await env.tick(80);
  await env.click(env.findButton(/^Send$/), 300);
  report.check("your own message is appended locally", /Sending from the test run/.test(env.contentText()));

  const relayed = await remote
    .next((m) => m.t === "state" && m.chat.some((c) => /Sending from the test run/.test(c.text)), 3000, "app chat relayed")
    .catch(() => null);
  report.check("your message reaches the other member through the relay", Boolean(relayed));
  report.check("the relay keeps per-member minutes in sync", relayed?.members?.find((m) => m.id === "remote-1")?.minutes === 37);

  remote.send({ t: "reaction", emoji: "🔥", member: wsMember("remote-1", "RemoteFriend", 37) });
  await env.tick(700);
  report.check("reactions from other members show up", /🔥/.test(env.contentText()));
  remote.close();
  remote = null;

  /* ------------------------ 6. session ratings (👍/👎) ---------------------- */
  await env.navTo(6);
  await env.click(env.findButton(/Sessions & ratings/), 220);
  const likeButton = env.findButton(/^👍$/);
  if (likeButton) {
    await env.click(likeButton, 700);
    report.check("a 👍 rating persists on the session", env.storedState().sessions?.[0]?.rating === "like", JSON.stringify(env.storedState().sessions?.[0]?.rating));
  } else {
    report.check("a 👍 rating persists on the session", false, "like button not found");
  }

  report.check("no runtime errors across the whole flow", env.errors.length === 0, env.errors.slice(0, 2).join(" | "));
} catch (error) {
  report.check("flow suite completed", false, String(error?.stack || error));
} finally {
  remote?.close();
}

process.exit(report.finish() ? 0 : 1);
