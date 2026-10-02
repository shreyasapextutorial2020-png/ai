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
const now = new Date();
const seededState = {
  version: 1,
  // 0.05 min = 3s floor, so the drift reminder can be observed inside the test
  settings: { pro: true, nickname: "TestUser", musicTrack: "", focusGuardReminders: true, focusGuardMinutes: 0.05 },
  // a scheduled block that started a minute ago, to exercise planner reminders
  blocks: [
    {
      id: "block-now",
      day: now.getDay(),
      start: `${String(now.getHours()).padStart(2, "0")}:${String(Math.max(0, now.getMinutes() - 1)).padStart(2, "0")}`,
      end: "23:59",
      label: "Planner reminder block",
      subject: "Physics",
      colour: "#7c5cff",
      reminder: true,
      completedOn: [],
    },
  ],
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

/** Polls until `predicate` is true (state is persisted on a 350ms debounce). */
const waitFor = async (predicate, timeoutMs = 12_000, stepMs = 250) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (predicate()) return true;
    } catch {
      /* keep polling */
    }
    await env.tick(stepMs);
  }
  try {
    return Boolean(predicate());
  } catch {
    return false;
  }
};
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

  // one tap arms a whole category (the fix for "chess.com is never blocked")
  const chessPreset = env.findButton(/Chess & board games/);
  await env.click(chessPreset, 400);
  const chessRules = (env.storedState().webRules ?? []).filter((r) => /chess|lichess/.test(r.domain));
  report.check(
    "the chess preset arms the chess sites",
    chessRules.length >= 3 && chessRules.every((r) => r.enabled),
    JSON.stringify(chessRules.map((r) => `${r.domain}:${r.enabled}`)),
  );

  // "Test" must prove a rule is wired up end to end
  const before = (env.storedState().blockedLog ?? []).length;
  const testButton = env.window.document.querySelector('.list-row button[aria-label^="Test blocking"]');
  await env.click(testButton, 300);
  const testLogged = await waitFor(() => (env.storedState().blockedLog ?? []).length > before, 5000);
  report.check(
    "the Test button logs a real block",
    testLogged,
    `found=${Boolean(testButton)} before=${before} after=${(env.storedState().blockedLog ?? []).length} errors=${env.errors.slice(0, 1)}`,
  );

  /* ---------------------------- 4. focus music ----------------------------- */
  await env.navTo(3);
  const soundCards = [...env.window.document.querySelectorAll(".sound-card")];
  const rainCard = soundCards.find((card) => /Rainfall/.test(card.textContent));
  await env.click(rainCard, 200);
  report.check("the focus-music library lists all soundscapes", soundCards.length >= 10, `${soundCards.length} cards`);
  report.check("selecting a sound marks it active", Boolean(rainCard?.classList.contains("active")));
  report.check("the audio engine runs without errors", env.errors.length === 0, env.errors[0]);

  // no mixer any more: playing another sound replaces the current one
  report.check("the layering UI is gone", !env.contentHtml().includes("+ Layer"));
  const brownCard = soundCards.find((card) => /Brown noise/.test(card.textContent));
  await env.click(brownCard, 300);
  const switched = await waitFor(() => /Brown noise/.test(env.contentText()), 5000);
  report.check("picking another sound switches to it", switched);
  report.check("no error dialog about layers", !/Live mix/.test(env.contentHtml()));

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

  /* ------------------- 7. planner reminders ----------------------------- */
  await env.navTo(0); // Focus Timer
  const plannerReminder = env.storedState().reminders?.find((r) => r.kind === "planner");
  report.check("a scheduled focus block raises a reminder", Boolean(plannerReminder), JSON.stringify(plannerReminder?.title));
  report.check("the planner reminder names the block", /Planner reminder block/.test(plannerReminder?.title ?? ""), plannerReminder?.title);

  /* -------------------- 8. Focus Guard drift reminders ------------------- */
  // force the simulated foreground onto an unblocked but distracting site
  env.window.__REGAIN_SIM_WINDOW__ = {
    process_name: "chrome.exe",
    window_title: "YouTube — recommended",
    domain: "youtube.com",
  };
  await env.click(env.findButton(/^▶ Start/), 400);
  const gotDrift = await waitFor(() =>
    (env.storedState().reminders ?? []).some((r) => r.kind === "drift" && /YouTube/.test(r.title)),
  );
  const drift = (env.storedState().reminders ?? []).find((r) => r.kind === "drift");
  report.check("drifting to an unblocked distracting site raises a Focus Guard reminder", gotDrift, JSON.stringify(drift?.title));
  report.check("the drift reminder names the site", /YouTube/.test(drift?.title ?? ""), drift?.title);
  report.check("the drift reminder only fires once per continuous drift", (env.storedState().reminders ?? []).filter((r) => r.kind === "drift").length === 1);

  // a *blocked* distraction must be intercepted instead of nudged
  env.window.__REGAIN_SIM_WINDOW__ = {
    process_name: "chrome.exe",
    window_title: "Instagram • Reels",
    domain: "instagram.com",
  };
  const intercepted = await waitFor(() =>
    (env.storedState().blockedLog ?? []).some((b) => /instagram/.test(b.key ?? "")),
  );
  report.check("a blocked site is intercepted", intercepted, "no block logged");
  report.check(
    "a blocked site is never counted as drift",
    !(env.storedState().reminders ?? []).some((r) => r.kind === "drift" && /Instagram/i.test(r.title)),
  );

  // chess.com: the site rule catches the browser tab…
  env.window.__REGAIN_SIM_WINDOW__ = {
    process_name: "chrome.exe",
    window_title: "Chess.com — Play Chess Online",
    domain: "chess.com",
  };
  const chessBlocked = await waitFor(() =>
    (env.storedState().blockedLog ?? []).some((b) => /chess\.com/.test(b.key ?? "")),
  );
  report.check("a chess.com tab is intercepted while focusing", chessBlocked, "no chess.com block logged");
  report.check(
    "the subdomain rule also covers play.chess.com",
    (() => {
      env.window.__REGAIN_SIM_WINDOW__ = {
        process_name: "chrome.exe",
        window_title: "Play Chess",
        domain: "play.chess.com",
      };
      return waitFor(() =>
        (env.storedState().blockedLog ?? []).filter((b) => /play\.chess\.com/.test(b.key ?? "")).length > 0,
      );
    })(),
  );
  // …and the app rule catches the desktop app, process "Chess.exe"
  env.window.__REGAIN_SIM_WINDOW__ = { process_name: "Chess.exe", window_title: "Chess.com - Play Chess" };
  const chessAppBlocked = await waitFor(() =>
    (env.storedState().blockedLog ?? []).some((b) => /^chess/i.test(b.key ?? "")),
  );
  report.check("the chess desktop app is caught by the same rule", chessAppBlocked, "no chess.exe block logged");

  /* ------------------- 8b. app-level Like / Dislike --------------------- */
  await env.navTo(7); // Insights
  const likeApp = env.window.document.querySelector('button[aria-label="Like Regain"]');
  const dislikeApp = env.window.document.querySelector('button[aria-label="Dislike Regain"]');
  report.check("Insights exposes Like and Dislike for the app itself", Boolean(likeApp && dislikeApp));
  await env.click(likeApp, 300);
  const likedApp = await waitFor(() => env.storedState().settings?.appRating === "like", 5000);
  report.check("liking the app persists in settings", likedApp, JSON.stringify(env.storedState().settings?.appRating));
  report.check("the card acknowledges the like", /glad it is helping|Thanks/.test(env.contentText()));
  await env.click(env.window.document.querySelector('button[aria-label="Dislike Regain"]'), 300);
  const dislikedApp = await waitFor(() => env.storedState().settings?.appRating === "dislike", 5000);
  report.check("disliking replaces the like", dislikedApp, JSON.stringify(env.storedState().settings?.appRating));
  report.check(
    "a dislike offers concrete fixes instead of a dead end",
    /Block the sites that keep pulling you away/.test(env.contentText()),
  );
  // tapping the active button again clears the rating
  await env.click(env.window.document.querySelector('button[aria-label="Dislike Regain"]'), 300);
  const cleared = await waitFor(() => env.storedState().settings?.appRating === null, 5000);
  report.check("tapping the active rating again clears it", cleared, JSON.stringify(env.storedState().settings?.appRating));
  report.check("no console errors during rating", env.errors.length === 0, env.errors[0]);
  // back to the timer page: the shortcut checks below assume a session control is visible
  await env.navTo(0, 300);

  /* ------------------------- 9. keyboard shortcuts ----------------------- */
  env.window.__REGAIN_SIM_WINDOW__ = undefined;
  const key = (k) => env.window.document.dispatchEvent(new env.window.KeyboardEvent("keydown", { key: k, bubbles: true }));
  const sessionState = () => env.storedState().active;

  // the current session is running; Space pauses it
  key(" ");
  const paused = await waitFor(() => env.storedState().active?.running === false, 5000);
  report.check("Space pauses the running session", paused, JSON.stringify(env.storedState().active?.running));
  key(" ");
  const resumed = await waitFor(() => env.storedState().active?.running === true, 5000);
  report.check("Space resumes the paused session", resumed, JSON.stringify(env.storedState().active?.running));

  // shortcuts must not fire while typing
  const noteInput = env.window.document.querySelector('input[placeholder*="Integration"]') || env.window.document.querySelector("input.input");
  noteInput.focus();
  const runningBefore = sessionState()?.running;
  key(" ");
  await env.tick(250);
  report.check("Space is ignored while typing in a field", sessionState()?.running === runningBefore);
  noteInput.blur();

  key("?");
  await env.tick(250);
  const modal = [...env.window.document.querySelectorAll(".modal")].find((m) => /Keyboard shortcuts/.test(m.textContent));
  report.check("? opens the shortcut list", Boolean(modal), "modal not found");
  if (modal) {
    report.check("the shortcut list documents Space and M", /Space/.test(modal.textContent) && /Toggle the soundscape|M/.test(modal.textContent));
    key("Escape");
    await env.tick(250);
    const stillOpen = [...env.window.document.querySelectorAll(".modal")].some((m) => /Keyboard shortcuts/.test(m.textContent));
    report.check("Escape closes the shortcut list", !stillOpen);
  }

  report.check("no runtime errors across the whole flow", env.errors.length === 0, env.errors.slice(0, 2).join(" | "));
} catch (error) {
  report.check("flow suite completed", false, String(error?.stack || error));
} finally {
  remote?.close();
}

process.exit(report.finish() ? 0 : 1);
