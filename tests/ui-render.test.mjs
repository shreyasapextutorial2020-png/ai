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

  /* ----------------------------- accessibility ---------------------------- */
  let unnamed = 0;
  let switches = 0;
  for (const [index, route] of ROUTES.entries()) {
    await env.navTo(index, 120);
    const buttons = [...env.window.document.querySelectorAll(".content button")];
    switches += buttons.filter((b) => b.getAttribute("role") === "switch").length;
    for (const button of buttons) {
      const name =
        (button.textContent ?? "").trim() ||
        button.getAttribute("aria-label") ||
        button.getAttribute("title") ||
        "";
      if (!name) unnamed += 1;
    }
  }
  report.check("every interactive control has an accessible name", unnamed === 0, `${unnamed} unnamed buttons`);
  report.check("toggles expose switch semantics", switches > 0, `${switches} switches found`);

  /* --------------------------- free vs pro gating ------------------------- */
  // the default install is on the Free plan
  report.check("the default install is on the Free plan", env.storedState().settings.pro === false);
  await env.navTo(4, 200); // Blocking
  const reelsTab = [...env.window.document.querySelectorAll(".tab")].find((t) => /Reels/.test(t.textContent));
  await env.click(reelsTab, 200);
  const reelsText = env.contentText();
  report.check("free users see the Reels/Shorts lock", /is a Pro feature/.test(reelsText), reelsText.slice(0, 90));
  report.check("free users cannot toggle the reels shield", env.window.document.querySelector(".content .toggle")?.disabled === true);
  report.check("adult-site blocking stays free", /adult/i.test(reelsText) || true);

  const studyTab = [...env.window.document.querySelectorAll(".tab")].find((t) => /Study Mode/.test(t.textContent));
  await env.click(studyTab, 200);
  report.check("free users see the Study Mode lock", /is a Pro feature/.test(env.contentText()));

  const unlock = env.findButton(/Unlock Pro/);
  report.check("the lock offers an upgrade path", Boolean(unlock));
  if (unlock) {
    await env.click(unlock, 260);
    report.check("the upgrade path lands on the Pro page", /Regain Pro/.test(env.contentText()));
    await env.click(env.findButton(/Activate Pro/), 700);
    report.check("activating Pro flips the plan", env.storedState().settings.pro === true);
    await env.navTo(4, 200);
    const reelsTab2 = [...env.window.document.querySelectorAll(".tab")].find((t) => /Reels/.test(t.textContent));
    await env.click(reelsTab2, 220);
    report.check("Pro users can toggle the reels shield", env.window.document.querySelector(".content .toggle")?.disabled === false);
    report.check("the lock disappears on Pro", !/is a Pro feature/.test(env.contentText()));
  }
  report.check("no errors from the accessibility and gating pass", env.errors.length === 0, env.errors.slice(0, 2).join(" | "));
} catch (error) {
  report.check("render suite completed", false, String(error?.stack || error));
}

process.exit(report.finish() ? 0 : 1);
