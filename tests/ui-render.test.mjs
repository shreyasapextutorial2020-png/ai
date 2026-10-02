/**
 * Render smoke test: boots the real React tree in jsdom, walks every sidebar
 * route and fails on any console error, uncaught exception or empty page.
 *
 *   node tests/ui-render.test.mjs
 */
import fs from "node:fs";
import { createAppDom, createReporter } from "./helpers/env.mjs";

const bundlePath = process.env.REGAIN_APP_BUNDLE;
if (!bundlePath) {
  console.error("REGAIN_APP_BUNDLE is not set — run this suite through `npm test`.");
  process.exit(1);
}
const bundle = fs.readFileSync(bundlePath, "utf8");

const ROUTES = [
  "focus",
  "pomodoro",
  "planner",
  "music",
  "blocking",
  "strict",
  "screentime",
  "insights",
  "rooms",
  "themes",
  "settings",
  "pro",
];

const env = createAppDom();
const report = createReporter("ui-render");

try {
  new env.window.Function(bundle).call(env.window);
  await env.tick(250);

  const root = env.window.document.getElementById("root");
  report.check(
    "app boots and renders",
    Boolean(root && root.innerHTML.length > 500),
    `${root ? root.innerHTML.length : 0} bytes of DOM`,
  );

  const welcomeButton = env.findButton(/Start focusing/i);
  if (welcomeButton) {
    await env.click(welcomeButton, 120);
    report.check("welcome modal can be dismissed", true);
  } else {
    report.check("welcome modal can be dismissed", false, "button not found");
  }

  const navButtons = [...env.window.document.querySelectorAll(".nav-item")];
  report.check(`sidebar exposes all ${ROUTES.length} routes`, navButtons.length === ROUTES.length, `found ${navButtons.length}`);

  for (const [index, route] of ROUTES.entries()) {
    const before = env.errors.length;
    await env.navTo(index, 140);
    const newErrors = env.errors.slice(before);
    const html = env.contentHtml();
    if (newErrors.length) {
      report.check(`route "${route}" renders without errors`, false, newErrors[0].slice(0, 160));
    } else if (html.length < 400) {
      report.check(`route "${route}" renders content`, false, `${html.length} bytes`);
    } else {
      report.check(`route "${route}" renders (${html.length} bytes)`, true);
    }
  }

  const startButton = env.findButton(/^▶ Start/);
  if (startButton) {
    await env.click(startButton, 200);
    const topbar = env.window.document.querySelector(".topbar")?.textContent ?? "";
    report.check("starting a session updates the global session bar", /End|Locked|strict/.test(topbar));
  } else {
    report.check("starting a session updates the global session bar", false, "start button not found");
  }

  report.check("no runtime errors across all routes", env.errors.length === 0, env.errors.slice(0, 2).join(" | "));
} catch (error) {
  report.check("render suite completed", false, String(error?.stack || error));
}

process.exit(report.finish() ? 0 : 1);
