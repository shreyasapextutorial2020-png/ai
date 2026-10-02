/**
 * Regain content script — Shorts/Reels interception + YouTube Study Mode.
 * Runs on youtube.com and instagram.com at document_start.
 */

const state = {
  focusModeActive: false,
  reelsBlocked: true,
  studyMode: false,
  channels: [],
};

function isShortsUrl() {
  return window.location.pathname.startsWith("/shorts/") || window.location.pathname.startsWith("/reel/");
}

function pauseMedia() {
  document.querySelectorAll("video, audio").forEach((media) => {
    try {
      media.pause();
    } catch {
      /* ignore */
    }
  });
}

/** Shorts / Reels are simply not watchable while focus mode is running. */
function interceptShorts() {
  if (!state.focusModeActive || !state.reelsBlocked || !isShortsUrl()) return;
  pauseMedia();
  const notice = document.createElement("div");
  notice.id = "regain-intercept";
  notice.innerHTML = `
    <div style="font-size:52px">🛡️</div>
    <h1 style="font-family:Inter,system-ui,sans-serif">Short-form video is blocked</h1>
    <p style="font-family:Inter,system-ui,sans-serif;opacity:.75;max-width:520px">
      Regain is guarding this session. Long-form study content is still available —
      reels and shorts are not.
    </p>
    <a href="https://www.youtube.com/" style="font-family:Inter,system-ui,sans-serif;color:#7c5cff">
      Back to the study feed →
    </a>`;
  notice.setAttribute(
    "style",
    "position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;gap:10px;align-items:center;" +
      "justify-content:center;text-align:center;background:#08080f;color:#fff;padding:24px",
  );
  document.documentElement.appendChild(notice);
}

function applyStudyMode() {
  const on = state.focusModeActive && state.studyMode;
  document.documentElement.setAttribute("data-regain-study-mode", on ? "true" : "false");
  document.documentElement.setAttribute(
    "data-regain-focus",
    state.focusModeActive ? "true" : "false",
  );
  document.documentElement.setAttribute(
    "data-regain-reels",
    state.focusModeActive && state.reelsBlocked ? "blocked" : "allowed",
  );

  if (on) {
    // Channel allow-list: the home feed only renders videos from allowed channels.
    const allowed = state.channels
      .map((c) => String(c).toLowerCase().replace(/^@/, ""))
      .filter(Boolean);
    document.documentElement.style.setProperty(
      "--regain-channel-list",
      JSON.stringify(allowed),
    );
  }
}

function refresh() {
  interceptShorts();
  applyStudyMode();
}

/* --------------------------- state subscription ------------------------- */

try {
  chrome.storage.local.get(
    ["focusModeActive", "reelsBlocked", "studyMode", "channels"],
    (res) => {
      // First run without the desktop app: stay passive.
      state.focusModeActive = Boolean(res?.focusModeActive);
      state.reelsBlocked = res?.reelsBlocked !== false;
      state.studyMode = Boolean(res?.studyMode);
      state.channels = Array.isArray(res?.channels) ? res.channels : [];
      refresh();
    },
  );

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.focusModeActive) state.focusModeActive = Boolean(changes.focusModeActive.newValue);
    if (changes.reelsBlocked) state.reelsBlocked = Boolean(changes.reelsBlocked.newValue);
    if (changes.studyMode) state.studyMode = Boolean(changes.studyMode.newValue);
    if (changes.channels) state.channels = changes.channels.newValue || [];
    refresh();
  });
} catch {
  /* extension context invalidated */
}

// SPA navigation (YouTube fires yt-navigate-finish, Instagram is history-based)
window.addEventListener("yt-navigate-finish", refresh);
window.addEventListener("popstate", refresh);
window.addEventListener("pushstate", refresh);
const originalPushState = history.pushState;
history.pushState = function pushState(...args) {
  const result = originalPushState.apply(this, args);
  window.dispatchEvent(new Event("pushstate"));
  return result;
};

const earlyWatch = setInterval(refresh, 150);
setTimeout(() => clearInterval(earlyWatch), 5000);
refresh();
