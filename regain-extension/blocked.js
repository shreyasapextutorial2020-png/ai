/**
 * Block page: get the user out of the way immediately.
 *
 * window.close() is ignored for tabs the user opened themselves, which used to
 * leave the tab trapped on this page. So the close button asks the background
 * worker to remove the tab (chrome.tabs.remove works for any tab), with
 * window.close() and history.back() as fallbacks. If the user opted into
 * "close blocked tabs automatically", the background closes the tab before this
 * page even paints.
 */

const params = new URLSearchParams(window.location.search);
const domain = params.get("domain") || "";
if (domain) {
  const target = document.getElementById("domain-name");
  if (target) target.textContent = domain;
}

// "always" rules are permanent; "focus" rules only bite during a session.
const rawMode = params.get("mode");
const mode = rawMode === "always" ? "always" : rawMode === "strict" ? "strict" : "focus";
const reason = document.getElementById("reason");
if (reason) {
  reason.textContent =
    mode === "always"
      ? "This site is on your always-blocked list."
      : mode === "strict"
        ? "You turned on Block everything else — only your study sites are reachable while a session runs."
        : "Blocked while a Regain focus session is running.";
}

const status = document.getElementById("status");
const setStatus = (text) => {
  if (status) status.textContent = text || "";
};

/* --------------------------- live countdown ----------------------------- */

const timerEl = document.getElementById("timer");
function paintTimer(state) {
  if (!timerEl) return;
  const sec = Number(state?.remainingSec) || 0;
  if (state?.focusModeActive && sec > 0) {
    const m = Math.floor(sec / 60);
    const s = String(sec % 60).padStart(2, "0");
    timerEl.textContent = `${m}:${s} left in this session — you can do this.`;
  } else {
    timerEl.textContent = "";
  }
}
if (chrome?.storage?.local) {
  chrome.storage.local.get({ focusModeActive: false, remainingSec: 0 }).then(paintTimer);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.remainingSec || changes.focusModeActive) {
      chrome.storage.local.get({ focusModeActive: false, remainingSec: 0 }).then(paintTimer);
    }
  });
}

/* ----------------------------- close the tab ---------------------------- */

const send = (message) =>
  new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(response);
      });
    } catch {
      resolve(null);
    }
  });

async function closeTab() {
  // 1. ask the background worker: chrome.tabs.remove handles user-opened tabs
  const result = await send({ type: "CLOSE_TAB" });
  if (result?.closed) return;
  // 2. window.close() still works when the tab was opened by a script
  window.close();
  // 3. last resort: leave the user somewhere safe and say so
  window.setTimeout(() => {
    setStatus("Your browser would not close this tab — press Ctrl+W (⌘W on Mac), or tap “Go back”.");
  }, 250);
}

document.getElementById("close-tab")?.addEventListener("click", closeTab);

document.getElementById("go-back")?.addEventListener("click", () => {
  if (window.history.length > 1) window.history.back();
  else window.location.replace("about:blank");
});

/* --------------------------- auto-close toggle -------------------------- */

const autoClose = document.getElementById("auto-close");
if (autoClose) {
  autoClose.addEventListener("change", async () => {
    await send({ type: "SET_AUTO_CLOSE", value: autoClose.checked });
    setStatus(autoClose.checked ? "Blocked tabs will close themselves." : "Blocked tabs will stay open.");
  });
}

/* ------------------------- unblock a local rule ------------------------- */

const unblock = document.getElementById("unblock");
unblock?.addEventListener("click", async () => {
  const result = await send({ type: "REMOVE_DOMAIN", domain });
  if (result?.ok) {
    setStatus(`${domain} removed from your blocklist — reopening it…`);
    window.setTimeout(() => window.location.replace(`https://${domain}`), 900);
  } else {
    setStatus("This rule comes from the Regain desktop app, so change it there.");
  }
});

/* --------------------------- ask what to do ----------------------------- */

(async () => {
  const result = await send({ type: "BLOCKED_PAGE_LOADED", domain });
  if (!result) return;
  if (result.closed) return; // the background closed this tab already
  if (autoClose) autoClose.checked = Boolean(result.autoClose);
  if (unblock && result.canUnblock) unblock.style.display = "inline-block";
  if (result.lastTab) {
    setStatus("This is your only tab, so Regain left it open — press Ctrl+W when you are ready.");
  }
})();

/* ------------------------------- misc ---------------------------------- */

document.getElementById("open-regain")?.addEventListener("click", (event) => {
  event.preventDefault();
  setStatus("Open Regain from your taskbar to change your blocklists.");
});
