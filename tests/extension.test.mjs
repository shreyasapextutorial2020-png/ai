/**
 * Extension validation.
 *
 * Manifest V3 fails silently and confusingly in the browser (missing file,
 * undeclared permission, inline script blocked by CSP), so this suite checks
 * the package statically:
 *   manifest ↔ files exist, permissions ↔ chrome.* usage agree,
 *   host_permissions cover the content-script matches and DNR targets,
 *   no inline scripts / eval that MV3 would refuse to run.
 *
 *   node tests/extension.test.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extDir = path.join(root, "regain-extension");

let passed = 0;
const failures = [];
const check = (label, ok, extra = "") => {
  if (ok) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failures.push(`${label}${extra ? ` — ${extra}` : ""}`);
    console.log(`FAIL  ${label}${extra ? ` — ${extra}` : ""}`);
  }
};

const read = (file) => fs.readFileSync(path.join(extDir, file), "utf8");
const exists = (file) => fs.existsSync(path.join(extDir, file));

let manifest;
try {
  manifest = JSON.parse(read("manifest.json"));
  check("manifest.json parses", true);
} catch (error) {
  check("manifest.json parses", false, String(error));
  console.log(`\nextension: ${passed} passed, ${failures.length} failed`);
  process.exit(1);
}

check("uses manifest version 3", manifest.manifest_version === 3, String(manifest.manifest_version));
check("has a name, version and description", Boolean(manifest.name && manifest.version && manifest.description));
check("version is semver-ish", /^\d+\.\d+\.\d+$/.test(manifest.version), manifest.version);
check("declares a service worker background", Boolean(manifest.background?.service_worker), JSON.stringify(manifest.background));

/* ------------------------- referenced files exist ------------------------ */

const referenced = new Set();
if (manifest.background?.service_worker) referenced.add(manifest.background.service_worker);
if (manifest.action?.default_popup) referenced.add(manifest.action.default_popup);
for (const script of manifest.content_scripts ?? []) {
  (script.js ?? []).forEach((f) => referenced.add(f));
  (script.css ?? []).forEach((f) => referenced.add(f));
}
for (const file of referenced) {
  check(`referenced file exists: ${file}`, exists(file));
}

/* --------------------------- permissions vs usage ------------------------ */

const jsFiles = fs.readdirSync(extDir).filter((f) => f.endsWith(".js"));
const allJs = jsFiles.map((f) => read(f)).join("\n");
const htmlFiles = fs.readdirSync(extDir).filter((f) => f.endsWith(".html"));
const allHtml = htmlFiles.map((f) => read(f)).join("\n");

// chrome.runtime and chrome.i18n are always available; everything else needs
// a declared permission (chrome.action comes from the "action" manifest key).
const API_PERMISSIONS = {
  storage: "storage",
  alarms: "alarms",
  declarativeNetRequest: "declarativeNetRequest",
  scripting: "scripting",
  tabs: "tabs",
  notifications: "notifications",
  cookies: "cookies",
  webRequest: "webRequest",
  contextMenus: "contextMenus",
  bookmarks: "bookmarks",
};

const usedApis = new Set();
for (const api of Object.keys(API_PERMISSIONS)) {
  if (new RegExp(`chrome\\.${api}\\b`).test(allJs)) usedApis.add(api);
}
const declared = new Set(manifest.permissions ?? []);

for (const api of usedApis) {
  const needed = API_PERMISSIONS[api];
  const satisfied =
    declared.has(needed) || (needed === "scripting" && (manifest.host_permissions ?? []).length > 0);
  check(`declares "${needed}" for chrome.${api} usage`, satisfied, `permissions: ${[...declared].join(", ")}`);
}
check("declares the tabs API used for the active-domain report", !allJs.includes("chrome.tabs") || declared.has("tabs") || declared.has("activeTab"));

/* ------------------------- host permissions cover ------------------------ */

const hosts = manifest.host_permissions ?? [];
const hostMatches = (pattern) => {
  // turn "*://*.youtube.com/*" into a domain suffix test
  const domain = pattern.replace(/^\*:\/\//, "").replace(/\/\*$/, "").replace(/^\*\./, "");
  return hosts.some((h) => h.includes(domain));
};

for (const script of manifest.content_scripts ?? []) {
  for (const match of script.matches ?? []) {
    check(`host_permissions cover content script match ${match}`, hostMatches(match), hosts.join(", "));
  }
}

// the DNR rules redirect to extension Path, so the page must ship
check("the blocked page used by declarativeNetRequest ships", exists("blocked.html"));
check("background.js redirects to blocked.html", /blocked\.html/.test(read("background.js")));

/* ------------------------------- MV3 CSP -------------------------------- */

check("no inline <script> bodies that MV3 would refuse", !/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(allHtml));
check("no eval / new Function in extension code", !/\beval\s*\(|new\s+Function\s*\(/.test(allJs));
check("no remote script sources (extension must be self-contained)", !/<script[^>]+src=["']https?:/i.test(allHtml));
check("no javascript: URLs (blocked by the MV3 CSP)", !/href=["']javascript:/i.test(allHtml));

/* --------------------------- behaviour sanity --------------------------- */

const background = read("background.js");
check("background connects to the desktop bridge port 48123", /48123/.test(background));
check("background reconnects when the bridge drops", /onclose/.test(background) && /setTimeout\(connectBridge/.test(background));
check("background keeps working without the desktop app", /chrome\.storage\.local\.get/.test(background));
check("dynamic rules are rebuilt rather than duplicated", /removeRuleIds/.test(background) && /updateDynamicRules/.test(background));

const content = read("content.js");
check("content script handles YouTube SPA navigation", /yt-navigate-finish/.test(content));
check("content script intercepts shorts URLs", /\/shorts\//.test(content));
check("content script defaults to passive without the desktop app", /focusModeActive\s*=\s*Boolean\(res\?\.focusModeActive\)/.test(content));

const css = read("youtube.css") + read("instagram.css");
check("short-form shields are gated on the focus attribute", /data-regain-reels="blocked"/.test(css));
check("study-mode rules are gated on the study-mode attribute", /data-regain-study-mode="true"/.test(css));

const manifestJson = JSON.stringify(manifest);
check("extension never asks for screen or camera access", !/desktopCapture|tabCapture|camera|microphone/.test(manifestJson + allJs));


/* --------------------- site blocking really blocks sites ----------------- */

check("rules are anchored to the domain, not a prefix", /urlFilter:\s*`\|\|\$\{rule\.domain\}\^`/.test(background), "urlFilter must be ||domain^ so chess.com does not match chess.community");
check("matching is case-insensitive", /isUrlFilterCaseSensitive:\s*false/.test(background));
check("sub-frames and pop-ups are covered too", /resourceTypes:\s*\["main_frame",\s*"sub_frame"\]/.test(background));
check("always-rules outrank focus-rules", /priority:\s*rule\.always\s*\?\s*3\s*:\s*1/.test(background));
check("focus rules only apply while a session runs", /rules\.filter\(\(rule\) => rule\.always\)/.test(background));
check("the extension keeps its own always-blocked list", /localDomains/.test(background) && /ADD_DOMAIN/.test(background));
check("a site can be blocked from the popup in one click", /BLOCK_ACTIVE_TAB/.test(background) && /Block this site/.test(read("popup.html")));
check("popup lists and removes local domains", /REMOVE_DOMAIN/.test(read("popup.js")) && /local-list/.test(read("popup.html")));
check("popup reports whether the desktop app is connected", /Desktop app connected/.test(read("popup.js")));
check("popup normalises whatever the user types", /function normalize/.test(read("popup.js")));
check("the block screen distinguishes always from focus rules", /always-blocked list/.test(read("blocked.js")) && /focus session is running/.test(read("blocked.js")));
check("the block screen shows the remaining session time", /left in this session/.test(read("blocked.js")));
check("the app-provided rules are preferred over the flat domain list", /Array\.isArray\(state\.rules\)/.test(background));
check("the badge counts the rules that are live right now", /setBadgeText/.test(background) && /activeRules\(state\)/.test(background));
check("the extension never ships page content anywhere", !/fetch\(|XMLHttpRequest/.test(read("background.js") + read("content.js") + read("popup.js")));
check("manifest version reflects the blocking rewrite", /^1\.[2-9]\d*\.\d+$/.test(manifest.version), manifest.version);


/* -------------------- blocked tabs can actually be closed ---------------- */

const blockedJs = read("blocked.js");
const blockedHtml = read("blocked.html");
check("the block page has a real Close button, not a link to a missing file", /id="close-tab"/.test(blockedHtml) && /<button[^>]*id="close-tab"/.test(blockedHtml));
check("no dead index.html link remains on the block page", !/href="index\.html"/.test(blockedHtml), "index.html does not exist in the extension");
check("closing goes through the background worker, not window.close alone", /CLOSE_TAB/.test(blockedJs) && /chrome\.tabs\.remove/.test(background));
check("window.close() and history.back() remain as fallbacks", /window\.close\(\)/.test(blockedJs) && /history\.back\(\)/.test(blockedJs));
check("the user is told the shortcut when the browser refuses to close", /Ctrl\+W/.test(blockedJs));
check("blocked tabs can auto-close on load", /BLOCKED_PAGE_LOADED/.test(blockedJs) && /autoCloseBlocked/.test(background));
check("the last tab is never closed, which would kill the window", /siblings\.length > 1/.test(background) && /lastTab/.test(background));
check("auto-close is a visible, user-controlled toggle", /id="auto-close"/.test(blockedHtml) && /id="auto-close"/.test(read("popup.html")));
check("a local rule can be undone straight from the block page", /REMOVE_DOMAIN/.test(blockedJs) && /canUnblock/.test(blockedJs));
check("app-pushed rules are not silently removable from the block page", /This rule comes from the Regain desktop app/.test(blockedJs));
check("the block page offers Go back as an escape hatch", /id="go-back"/.test(blockedHtml) && /about:blank/.test(blockedJs));
check("the block page reports the remaining session time", /left in this session/.test(blockedJs));


/* -------------------- block everything except the allowlist ------------- */

check("the background understands the strict mode", /blockAll/.test(background) && /allowlist/.test(background));
check("strict mode uses one rule with the allowlist excluded", /excludedRequestDomains/.test(background) && /id: 10000/.test(background));
check("strict mode only arms during a session", /if \(!state\.focusModeActive \|\| !state\.blockAll\) return null;/.test(background));
check("strict mode outranks the ordinary blocklist rules", /priority: 10/.test(background));
check("strict mode never blocks the block page itself", /\/blocked\.html\?mode=strict/.test(background));
check("the popup explains the strict mode", /Every site blocked except/.test(read("popup.js")));
check("the block page tells the user why everything is closed", /Block everything else/.test(read("blocked.js")));
check("the badge shows the strict state", /setBadgeText\(\{ text: "ALL" \}\)/.test(background));

console.log(`\nextension: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  ✗ ${f}`);
process.exit(failures.length ? 1 : 0);
