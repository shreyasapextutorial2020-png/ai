#!/usr/bin/env node
/**
 * Regain PC test runner.
 *
 *   npm test
 *
 * What it does:
 *   1. bundles src/lib/*.ts (engine) and src/main.tsx (UI) with esbuild,
 *   2. makes sure the room relay is reachable (starts one if needed),
 *   3. runs four suites: engine, relay protocol, UI render, UI flow.
 *
 * No browser binary is required — the UI suites render the real React app in
 * jsdom and talk to the real relay over WebSocket.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const relayPort = Number(process.env.REGAIN_RELAY_PORT || 8790);

const workDir = mkdtempSync(path.join(tmpdir(), "regain-tests-"));
const libDir = path.join(workDir, "lib");
const appBundle = path.join(workDir, "app.js");

const run = (command, args, options = {}) =>
  spawnSync(command, args, { stdio: "inherit", cwd: root, ...options });

console.log("▶ building bundles with esbuild…\n");
const libBuild = run(path.join(root, "node_modules/.bin/esbuild"), [
  "src/lib/utils.ts",
  "src/lib/recommend.ts",
  "src/lib/demo.ts",
  "src/lib/rooms.ts",
  "src/lib/persist.ts",
  "src/lib/defaults.ts",
  "src/lib/blocking.ts",
  "--bundle",
  "--format=cjs",
  `--outdir=${libDir}`,
  "--log-level=warning",
]);
const appBuild = run(path.join(root, "node_modules/.bin/esbuild"), [
  "src/main.tsx",
  "--bundle",
  "--format=iife",
  "--loader:.css=empty",
  '--define:process.env.NODE_ENV="development"',
  `--outfile=${appBundle}`,
  "--log-level=warning",
]);
if (libBuild.status !== 0 || appBuild.status !== 0) {
  console.error("bundle step failed");
  process.exit(1);
}

/* --------------------------- relay availability --------------------------- */

async function relayHealthy() {
  try {
    const response = await fetch(`http://127.0.0.1:${relayPort}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

let relayChild = null;
if (!(await relayHealthy())) {
  console.log(`▶ starting the room relay on :${relayPort}…\n`);
  relayChild = spawn(process.execPath, ["server/room-server.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: String(relayPort) },
    stdio: "ignore",
  });
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && !(await relayHealthy())) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!(await relayHealthy())) {
    console.error("could not start the room relay");
    relayChild?.kill();
    process.exit(1);
  }
} else {
  console.log(`▶ using the room relay already listening on :${relayPort}\n`);
}

/* ------------------------------- suites ---------------------------------- */

const suites = [
  { name: "engine", file: "tests/engine.test.mjs", env: { REGAIN_LIB_DIR: libDir } },
  { name: "extension", file: "tests/extension.test.mjs", env: {} },
  { name: "icons", file: "tests/icons.test.mjs", env: {} },
  { name: "relay", file: "tests/relay.test.mjs", env: { REGAIN_RELAY_PORT: String(relayPort) } },
  { name: "ui-render", file: "tests/ui-render.test.mjs", env: { REGAIN_APP_BUNDLE: appBundle } },
  { name: "ui-resilience", file: "tests/ui-resilience.test.mjs", env: { REGAIN_APP_BUNDLE: appBundle } },
  { name: "ui-flow", file: "tests/ui-flow.test.mjs", env: { REGAIN_APP_BUNDLE: appBundle, REGAIN_RELAY_PORT: String(relayPort) } },
];

const results = [];
for (const suite of suites) {
  console.log(`\n──────── ${suite.name} ────────`);
  const result = spawnSync(process.execPath, [suite.file], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...suite.env },
    timeout: 180_000,
  });
  results.push({ name: suite.name, ok: result.status === 0 });
}

relayChild?.kill();
rmSync(workDir, { recursive: true, force: true });

console.log("\n════════ summary ════════");
for (const result of results) {
  console.log(`${result.ok ? "✅" : "❌"}  ${result.name}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} suite(s) failed` : "\nall suites passed");
process.exit(failed ? 1 : 0);
