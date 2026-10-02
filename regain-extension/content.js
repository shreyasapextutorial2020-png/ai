let isFocusActive = false; // Default to inactive when desktop app is not connected // Block by default; syncs with desktop app

function checkAndRedirectShorts() {
  if (isFocusActive && window.location.pathname.startsWith("/shorts/")) {
    // Pause any playing media immediately
    const video = document.querySelector("video");
    if (video) video.pause();

    // Redirect to long-form YouTube home
    window.location.replace("https://www.youtube.com");
  }
}

function updateStudyMode(active) {
  isFocusActive = active;
  if (active) {
    document.body.setAttribute("data-regain-study-mode", "true");
    checkAndRedirectShorts();
  } else {
    document.body.removeAttribute("data-regain-study-mode");
  }
}

// 1. Immediate check before anything renders
checkAndRedirectShorts();

// 2. Poll URL briefly during initial page initialization
const initInterval = setInterval(checkAndRedirectShorts, 100);
setTimeout(() => clearInterval(initInterval), 2000);

// 3. Read synchronized focus status from desktop app
try {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    chrome.storage.local.get(["focusModeActive"], (res) => {
      // If undefined (first run), default to active focus
      const active = res?.focusModeActive !== undefined ? Boolean(res.focusModeActive) : true;
      updateStudyMode(active);
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.focusModeActive) {
        updateStudyMode(Boolean(changes.focusModeActive.newValue));
      }
    });
  }
} catch (e) {
  // Context invalidated fallback
}

// 4. Listen to YouTube SPA internal navigation events
window.addEventListener("yt-navigate-finish", checkAndRedirectShorts);
window.addEventListener("popstate", checkAndRedirectShorts);