/**
 * Resilience test — regression guard for a real bug found by this suite:
 * when no relay is reachable the room transport used to re-enter its own error
 * handler and blow the stack. Now it must degrade to local mode, keep the UI
 * alive and report no errors.
 *
 * Port 9 (discard) is used as a guaranteed-closed relay.
 *
 *   node tests/ui-resilience.test.mjs
 */
import fs from "node:fs";
import { createAppDom, createReporter } from "./helpers/env.mjs";

const bundlePath = process.env.REGAIN_APP_BUNDLE;
if (!bundlePath) {
  console.error("REGAIN_APP_BUNDLE is not set — run this suite through `npm test`.");
  process.exit(1);
}
const bundle = fs.readFileSync(bundlePath, "utf8");

const env = createAppDom({
  url: "http://localhost:1420/#rooms",
  storage: {
    version: 1,
    seenWelcome: true,
    settings: { pro: true, nickname: "Offline user", roomServerUrl: "ws://127.0.0.1:9" },
    sessions: [],
  },
});
const report = createReporter("ui-resilience");

try {
  new env.window.Function(bundle).call(env.window);
  await env.tick(400);

  report.check("the app still boots without a relay", env.contentHtml().length > 400);
  report.check("no errors on startup without a relay", env.errors.length === 0, env.errors[0]);

  await env.click(env.findButton(/Create room/), 600);
  report.check("a room can still be created offline", /Live leaderboard/.test(env.contentHtml()));

  // give the failing socket plenty of time to misbehave
  await env.tick(4000);
  report.check("the transport degrades to local mode", /local mode|relay connected/.test(env.contentText()));
  report.check("no stack overflow or unhandled error while offline", env.errors.length === 0, env.errors.slice(0, 2).join(" | "));

  const stored = env.storedState();
  report.check("offline rooms still simulate study buddies", (stored.room?.members?.length ?? 0) > 1, `${stored.room?.members?.length} members`);

  const chatInput = env.window.document.querySelector('input[placeholder="Typing a message…"]');
  env.setReactValue(chatInput, "offline chat still works");
  await env.tick(80);
  await env.click(env.findButton(/^Send$/), 300);
  report.check("chat still works in local mode", /offline chat still works/.test(env.contentText()));

  // switching pages after a failed connection must stay clean
  await env.navTo(0, 200);
  await env.navTo(6, 200);
  report.check("other pages stay error-free after the failed connection", env.errors.length === 0, env.errors.slice(0, 2).join(" | "));
} catch (error) {
  report.check("resilience suite completed", false, String(error?.stack || error));
}

process.exit(report.finish() ? 0 : 1);
