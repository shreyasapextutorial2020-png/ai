/**
 * Regain Focus Companion — background service worker.
 *
 * Talks to the Regain desktop app over a local WebSocket (127.0.0.1:48123):
 *   app  → { type: "FOCUS_MODE_STATE", active, strict, domains, reelsBlocked, studyMode, channels }
 *   app  → { type: "TIMER", remainingSec, mode }
 *   here → { type: "ACTIVE_DOMAIN", domain, url, title }
 *
 * The desktop app is the source of truth; when it is not running the last known
 * state is kept so blocking survives a disconnect.
 */

const BRIDGE_URL = "ws://127.0.0.1:48123";
const DEFAULT_STATE = {
  focusModeActive: false,
  strict: false,
  domains: [],
  reelsBlocked: true,
  studyMode: false,
  channels: [],
  remainingSec: 0,
};

let socket = null;
let reconnectTimer = null;

/* --------------------------- bridge connection -------------------------- */

function connectBridge() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  try {
    socket = new WebSocket(BRIDGE_URL);

    socket.onopen = () => {
      console.log("[Regain] desktop bridge connected");
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      reportActiveTab();
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "FOCUS_MODE_STATE") {
          applyState({
            focusModeActive: Boolean(data.active),
            strict: Boolean(data.strict),
            domains: Array.isArray(data.domains) ? data.domains : [],
            reelsBlocked: data.reelsBlocked !== false,
            studyMode: Boolean(data.studyMode),
            channels: Array.isArray(data.channels) ? data.channels : [],
          });
        } else if (data.type === "TIMER") {
          chrome.storage.local.set({ remainingSec: Number(data.remainingSec) || 0, mode: data.mode });
        }
      } catch (error) {
        console.error("[Regain] bad frame", error);
      }
    };

    socket.onclose = () => {
      socket = null;
      if (!reconnectTimer) reconnectTimer = setTimeout(connectBridge, 3000);
    };

    socket.onerror = () => socket && socket.close();
  } catch (error) {
    console.error("[Regain] bridge unavailable", error);
  }
}

/* ------------------------------ state sync ------------------------------ */

async function applyState(patch) {
  const current = await chrome.storage.local.get(DEFAULT_STATE);
  const next = { ...DEFAULT_STATE, ...current, ...patch };
  await chrome.storage.local.set(next);
  await syncDynamicRules(next);
  updateBadge(next);
}

function updateBadge(state) {
  const on = state.focusModeActive;
  chrome.action.setBadgeText({ text: on ? "ON" : "" });
  chrome.action.setBadgeBackgroundColor({ color: on ? "#2fbf8f" : "#888888" });
}

/** Domain blocking is enforced with declarativeNetRequest dynamic rules. */
async function syncDynamicRules(state) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((rule) => rule.id);
  const addRules = [];

  if (state.focusModeActive && state.domains.length) {
    state.domains.slice(0, 900).forEach((domain, index) => {
      const clean = String(domain).trim().toLowerCase().replace(/^www\./, "");
      if (!clean) return;
      addRules.push({
        id: index + 1,
        priority: 1,
        action: {
          type: "redirect",
          redirect: { extensionPath: `/blocked.html?domain=${encodeURIComponent(clean)}` },
        },
        condition: {
          urlFilter: `||${clean}`,
          resourceTypes: ["main_frame"],
        },
      });
    });
  }

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
}

/* ------------------------- active domain reporting ---------------------- */

async function reportActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || !tab.url || !tab.url.startsWith("http")) return;
    const url = new URL(tab.url);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "ACTIVE_DOMAIN",
          domain: url.hostname.replace(/^www\./, ""),
          url: tab.url,
          title: tab.title || "",
        }),
      );
    }
  } catch (error) {
    /* ignore */
  }
}

chrome.tabs.onActivated.addListener(reportActiveTab);
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (info.status === "complete" || info.url) reportActiveTab();
  if (tab && tab.id) injectHelper(tab.id);
});

async function injectHelper(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  } catch {
    /* restricted page (chrome://, web store…) */
  }
}

/* ------------------------------- lifecycle ------------------------------ */

connectBridge();
chrome.alarms.create("regainHeartbeat", { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "regainHeartbeat") connectBridge();
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set(DEFAULT_STATE);
  connectBridge();
});
chrome.runtime.onStartup.addListener(connectBridge);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.focusModeActive || changes.domains)) {
    chrome.storage.local.get(DEFAULT_STATE).then(updateBadge);
  }
});
