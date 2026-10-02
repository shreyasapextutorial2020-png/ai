/**
 * Popup UI: live session status plus local always-blocked domains.
 *
 * Domains added here live in chrome.storage.local and are enforced by the
 * background worker directly, so site blocking works even when the Regain
 * desktop app is not running.
 */

const DEFAULTS = {
  focusModeActive: false,
  strict: false,
  domains: [],
  rules: [],
  localDomains: [],
  reelsBlocked: true,
  studyMode: false,
  remainingSec: 0,
  bridgeConnected: false,
};

const $ = (id) => document.getElementById(id);

function normalize(input) {
  let value = String(input || "").trim().toLowerCase();
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.split(/[/?#]/)[0].split(":")[0].replace(/\.+$/, "").replace(/^www\./, "");
  return value;
}

function render(state) {
  const pill = $("pill");
  pill.textContent = state.focusModeActive ? `Focus ON${state.strict ? " · strict" : ""}` : "Focus off";
  pill.className = `pill ${state.focusModeActive ? "on" : "off"}`;

  const rules = Array.isArray(state.rules) && state.rules.length
    ? state.rules
    : (state.domains || []).map((domain) => ({ domain, always: false }));
  const always = state.focusModeActive ? rules.filter((r) => r.always).length : rules.length;
  const blockedNow = state.focusModeActive ? rules.length : rules.filter((r) => r.always).length;

  $("detail").textContent = state.focusModeActive
    ? state.blockAll
      ? `Every site blocked except ${(state.allowlist || []).length} study sites · Reels ${
          state.reelsBlocked ? "blocked" : "allowed"
        }`
      : `${blockedNow} site(s) blocked · Reels ${state.reelsBlocked ? "blocked" : "allowed"} · Study Mode ${
          state.studyMode ? "on" : "off"
        }`
    : `${blockedNow} site(s) always blocked · Start a session in Regain for the rest.`;

  const minutes = Math.floor((state.remainingSec || 0) / 60);
  const seconds = String((state.remainingSec || 0) % 60).padStart(2, "0");
  $("timer").textContent = state.focusModeActive ? `Time remaining: ${minutes}:${seconds}` : "";

  $("bridge").textContent = state.bridgeConnected
    ? "Desktop app connected ✓"
    : "Desktop app not detected — local blocking still works.";

  const list = $("local-list");
  const local = state.localDomains || [];
  list.textContent = "";
  $("local-empty").style.display = local.length ? "none" : "block";
  for (const domain of local) {
    const row = document.createElement("div");
    row.className = "item";
    const label = document.createElement("span");
    label.textContent = domain;
    const remove = document.createElement("button");
    remove.textContent = "Remove";
    remove.title = `Stop blocking ${domain}`;
    remove.addEventListener("click", () =>
      chrome.runtime.sendMessage({ type: "REMOVE_DOMAIN", domain }, refresh),
    );
    row.append(label, remove);
    list.append(row);
  }

  const count = rules.length + local.length;
  $("block-tab").textContent = `🚫 Block this site`;
  $("block-tab").title = `Currently ${count} rule(s) active`;
}

function refresh() {
  chrome.storage.local.get(DEFAULTS).then((s) => render({ ...DEFAULTS, ...s }));
}

function flash(elementId, text) {
  const el = $(elementId);
  el.textContent = text;
  window.setTimeout(() => {
    el.textContent = "";
  }, 2500);
}

$("add").addEventListener("click", () => {
  const raw = $("domain").value;
  const domain = normalize(raw);
  if (!domain) {
    flash("action-error", "Enter a domain like chess.com");
    return;
  }
  chrome.runtime.sendMessage({ type: "ADD_DOMAIN", domain }, (res) => {
    if (res?.ok) {
      $("domain").value = "";
      flash("action-ok", `Now blocking ${res.domain}`);
      refresh();
    } else {
      flash("action-error", res?.error || "Could not add that domain");
    }
  });
});

$("block-tab").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "BLOCK_ACTIVE_TAB" }, (res) => {
    if (res?.ok) flash("action-ok", `Blocked ${res.domain}`);
    else flash("action-error", res?.error || "Could not block this tab");
    refresh();
  });
});

$("domain").addEventListener("keydown", (event) => {
  if (event.key === "Enter") $("add").click();
});

const autoClose = document.getElementById("auto-close");
if (autoClose) {
  chrome.storage.local.get({ autoCloseBlocked: true }).then((s) => {
    autoClose.checked = s.autoCloseBlocked !== false;
    const hint = document.getElementById("auto-close-hint");
    if (hint) {
      hint.textContent = autoClose.checked
        ? "On: a blocked site closes itself the moment it loads."
        : "Off: the block page stays open with a Close button.";
    }
  });
  autoClose.addEventListener("change", () => {
    chrome.runtime.sendMessage({ type: "SET_AUTO_CLOSE", value: autoClose.checked });
    const hint = document.getElementById("auto-close-hint");
    if (hint) {
      hint.textContent = autoClose.checked
        ? "On: a blocked site closes itself the moment it loads."
        : "Off: the block page stays open with a Close button.";
    }
  });
}

chrome.storage.onChanged.addListener(refresh);
refresh();
