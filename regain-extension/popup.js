const DEFAULTS = {
  focusModeActive: false,
  strict: false,
  domains: [],
  reelsBlocked: true,
  studyMode: false,
  remainingSec: 0,
};

chrome.storage.local.get(DEFAULTS).then((s) => {
  const pill = document.getElementById("pill");
  pill.textContent = s.focusModeActive ? `Focus ON${s.strict ? " · strict" : ""}` : "Focus off";
  pill.className = `pill ${s.focusModeActive ? "on" : "off"}`;
  document.getElementById("detail").textContent = s.focusModeActive
    ? `${s.domains.length} domains blocked · Reels ${s.reelsBlocked ? "blocked" : "allowed"} · Study Mode ${
        s.studyMode ? "on" : "off"
      }`
    : "Start a session in the Regain desktop app to arm blocking.";

  const minutes = Math.floor((s.remainingSec || 0) / 60);
  const seconds = String((s.remainingSec || 0) % 60).padStart(2, "0");
  document.getElementById("timer").textContent = s.focusModeActive
    ? `Time remaining: ${minutes}:${seconds}`
    : "";
});
