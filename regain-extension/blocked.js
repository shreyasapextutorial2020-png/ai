// Extension pages are CSP-restricted, so this lives in its own file rather
// than inline in blocked.html.
const params = new URLSearchParams(window.location.search);
const domain = params.get("domain");
if (domain) {
  const target = document.getElementById("domain-name");
  if (target) target.textContent = domain;
}

// "always" rules are permanent; "focus" rules only bite during a session.
const mode = params.get("mode") === "always" ? "always" : "focus";
const reason = document.getElementById("reason");
if (reason) {
  reason.textContent =
    mode === "always"
      ? "This site is on your always-blocked list."
      : "Blocked while a Regain focus session is running.";
}

// Live countdown so the block screen tells the student how long is left.
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

// window.close() only works for script-opened tabs, so prefer it and fall back
// to leaving focus mode guidance for the user.
document.getElementById("open-regain")?.addEventListener("click", (event) => {
  event.preventDefault();
  // The desktop app is a native window, not a URL — point the user at it.
  document.body.setAttribute("data-regain-nudge", "true");
  if (timerEl) timerEl.textContent = "Open Regain from your taskbar to get back to work.";
});

document.getElementById("close-tab")?.addEventListener("click", (event) => {
  event.preventDefault();
  window.close();
  window.setTimeout(() => {
    document.getElementById("close-tab").textContent = "You can close this tab now";
  }, 300);
});
