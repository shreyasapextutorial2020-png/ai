/**
 * Regain Focus Companion — background service worker.
 *
 * Talks to the Regain desktop app over a local WebSocket (127.0.0.1:48123):
 *   app  → { type: "FOCUS_MODE_STATE", active, strict, rules:[{domain,always}], domains, reelsBlocked, studyMode, channels }
 *   app  → { type: "TIMER", remainingSec, mode }
 *   here → { type: "ACTIVE_DOMAIN", domain, url, title }
 *
 * Blocking has two independent sources, so a site stays blocked even if one of
 * them is missing:
 *   1. rules pushed by the desktop app (authoritative while it runs),
 *   2. rules the user added straight in the extension popup (`localDomains`),
 *      which also work when the desktop app is closed.
 *
 * "Always" rules are enforced continuously; "focus" rules only while a session
 * is running. Sub-frames and top-level navigations are both covered.
 */

const BRIDGE_URL = "ws://127.0.0.1:48123";
const DEFAULT_STATE = {
  focusModeActive: false,
  strict: false,
  domains: [],
  /** [{ domain, always }] — preferred over `domains` when present */
  rules: [],
  /** domains added in the popup; enforced regardless of the desktop app */
  localDomains: [],
  reelsBlocked: true,
  studyMode: false,
  channels: [],
  remainingSec: 0,
  mode: "idle",
  /** when true, every site except `allowlist` is blocked during a session */
  blockAll: false,
  allowlist: [],
  bridgeConnected: false,
  /** close a tab as soon as it lands on the block page */
  autoCloseBlocked: true,
};

let socket = null;
let reconnectTimer = null;

/* ------------------------------------------------------------------ */
/* normalisation (mirrors src/lib/blocking.ts)                         */
/* ------------------------------------------------------------------ */

function normalizeDomain(input) {
  if (!input) return "";
  let value = String(input).trim().toLowerCase();
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.replace(/^[^/@]*@/, "");
  value = value.split(/[/?#]/)[0];
  value = value.split(":")[0];
  value = value.replace(/\.+$/, "").replace(/^\.+/, "");
  value = value.replace(/^www\./, "");
  value = value.replace(/^(m|mobile|amp|music|www\d?)\./, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) return "";
  if (!/^[a-z]{2,}$/.test(value.split(".").pop() || "")) return "";
  return value;
}

/** Merge the app's rules with the popup's own list into one rule set. */
function collectRules(state) {
  const out = new Map();
  const push = (domain, always) => {
    const clean = normalizeDomain(domain);
    if (!clean) return;
    const existing = out.get(clean);
    out.set(clean, { domain: clean, always: Boolean(always) || Boolean(existing?.always) });
  };

  if (Array.isArray(state.rules)) {
    for (const rule of state.rules) push(rule?.domain ?? rule?.pattern, rule?.always);
  } else {
    for (const domain of state.domains || []) push(domain, false);
  }
  for (const domain of state.localDomains || []) push(domain, true);
  return [...out.values()];
}

/** Rules that should be active right now, given the session state. */
function activeRules(state) {
  const rules = collectRules(state);
  if (state.focusModeActive) return rules;
  return rules.filter((rule) => rule.always);
}

/* ------------------------------------------------------------------ */
/* bridge connection                                                   */
/* ------------------------------------------------------------------ */

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
      chrome.storage.local.set({ bridgeConnected: true });
      reportActiveTab();
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "FOCUS_MODE_STATE") {
          applyState({
            focusModeActive: Boolean(data.active),
            strict: Boolean(data.strict),
            blockAll: Boolean(data.blockAll),
            allowlist: Array.isArray(data.allowlist) ? data.allowlist : [],
            rules: Array.isArray(data.rules)
              ? data.rules.map((r) => ({ domain: r.domain ?? r.pattern, always: Boolean(r.always) }))
              : [],
            domains: Array.isArray(data.domains) ? data.domains : [],
            reelsBlocked: data.reelsBlocked !== false,
            studyMode: Boolean(data.studyMode),
            channels: Array.isArray(data.channels) ? data.channels : [],
            bridgeConnected: true,
          });
        } else if (data.type === "TIMER") {
          chrome.storage.local.set({
            remainingSec: Number(data.remainingSec) || 0,
            mode: data.mode || "idle",
          });
        }
      } catch (error) {
        console.error("[Regain] bad frame", error);
      }
    };

    socket.onclose = () => {
      socket = null;
      chrome.storage.local.set({ bridgeConnected: false });
      if (!reconnectTimer) reconnectTimer = setTimeout(connectBridge, 3000);
    };

    socket.onerror = () => socket && socket.close();
  } catch (error) {
    console.error("[Regain] bridge unavailable", error);
  }
}

/* ------------------------------------------------------------------ */
/* state sync + declarativeNetRequest rules                            */
/* ------------------------------------------------------------------ */

async function applyState(patch) {
  const current = await chrome.storage.local.get(DEFAULT_STATE);
  // `rules`/`domains` from the app replace the previous app-provided set; the
  // popup's own domains live in localDomains and are never overwritten here.
  const next = { ...DEFAULT_STATE, ...current, ...patch };
  await chrome.storage.local.set(next);
  await syncDynamicRules(next);
  updateBadge(next);
}

function updateBadge(state) {
  const rules = activeRules(state);
  const on = state.focusModeActive;
  if (on && state.blockAll) {
    chrome.action.setBadgeText({ text: "ALL" });
    chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
    chrome.action.setTitle({
      title: `Regain - studying: every site blocked except ${(state.allowlist || []).length} allowed`,
    });
    return;
  }
  chrome.action.setBadgeText({ text: on ? (rules.length ? String(rules.length) : "ON") : rules.length ? String(rules.length) : "" });
  chrome.action.setBadgeBackgroundColor({ color: on ? "#2fbf8f" : "#7c5cff" });
  chrome.action.setTitle({
    title: on
      ? `Regain — focus session running, ${rules.length} site(s) blocked`
      : `Regain — ${rules.length} site(s) blocked (${
          rules.filter((r) => r.always).length
        } always)`,
  });
}

/**
 * "Block everything except the allowlist" - one rule with the allowlist as
 * excludedRequestDomains. Only applies while a session runs, and never touches
 * the extension's own pages or the block screen itself.
 */
function blockAllRule(state) {
  if (!state.focusModeActive || !state.blockAll) return null;
  const allowlist = (state.allowlist || []).map((d) => normalizeDomain(d)).filter(Boolean);
  return {
    id: 10000,
    priority: 10,
    action: {
      type: "redirect",
      redirect: { extensionPath: "/blocked.html?mode=strict" },
    },
    condition: {
      urlFilter: "*",
      resourceTypes: ["main_frame"],
      // the allowlist stays reachable, and so does the local dev preview
      excludedRequestDomains: allowlist.length ? allowlist : ["localhost"],
      excludedInitiatorDomains: allowlist.length ? allowlist : ["localhost"],
    },
  };
}

/** Rebuilds the dynamic rule set from the currently active rules. */
async function syncDynamicRules(state) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((rule) => rule.id);
  const addRules = [];
  const rules = activeRules(state);

  const strict = blockAllRule(state);
  if (strict) addRules.push(strict);

  rules.slice(0, 900).forEach((rule, index) => {
    addRules.push({
      id: index + 1,
      priority: rule.always ? 3 : 1,
      action: {
        type: "redirect",
        redirect: {
          extensionPath: `/blocked.html?domain=${encodeURIComponent(rule.domain)}&mode=${
            rule.always ? "always" : "focus"
          }`,
        },
      },
      condition: {
        // "||domain" matches the domain and every subdomain; the separator
        // keeps "chess.com" from also matching "chess.community.example"
        urlFilter: `||${rule.domain}^`,
        resourceTypes: ["main_frame", "sub_frame"],
        isUrlFilterCaseSensitive: false,
      },
    });
  });

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
}

async function refresh() {
  const state = await chrome.storage.local.get(DEFAULT_STATE);
  await syncDynamicRules({ ...DEFAULT_STATE, ...state });
  updateBadge({ ...DEFAULT_STATE, ...state });
}

/* ------------------------------------------------------------------ */
/* popup messages                                                      */
/* ------------------------------------------------------------------ */

async function addLocalDomain(raw) {
  const domain = normalizeDomain(raw);
  if (!domain) return { ok: false, error: "That does not look like a domain" };
  const state = await chrome.storage.local.get(DEFAULT_STATE);
  const localDomains = [...new Set([...(state.localDomains || []), domain])];
  await chrome.storage.local.set({ localDomains });
  await refresh();
  return { ok: true, domain };
}

async function removeLocalDomain(raw) {
  const domain = normalizeDomain(raw);
  const state = await chrome.storage.local.get(DEFAULT_STATE);
  const localDomains = (state.localDomains || []).filter((d) => normalizeDomain(d) !== domain);
  await chrome.storage.local.set({ localDomains });
  await refresh();
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "ADD_DOMAIN") sendResponse(await addLocalDomain(message.domain));
    else if (message?.type === "REMOVE_DOMAIN") sendResponse(await removeLocalDomain(message.domain));
    else if (message?.type === "REFRESH") {
      await refresh();
      sendResponse({ ok: true });
    } else if (message?.type === "CLOSE_TAB") {
      // Works for tabs the *user* opened, which window.close() cannot touch.
      const tabId = sender?.tab?.id;
      if (typeof tabId === "number") {
        await chrome.tabs.remove(tabId).catch(() => {});
        sendResponse({ ok: true, closed: true });
      } else {
        sendResponse({ ok: false, error: "no tab to close" });
      }
    } else if (message?.type === "BLOCKED_PAGE_LOADED") {
      // The page asks us what to do; honour the user's auto-close preference.
      const state = await chrome.storage.local.get(DEFAULT_STATE);
      const tab = sender?.tab;
      const domain = normalizeDomain(message.domain || "");
      let closed = false;
      if (state.autoCloseBlocked && tab?.id != null) {
        const siblings = tab.windowId != null ? await chrome.tabs.query({ windowId: tab.windowId }) : [];
        // never close the last tab: that would shut the browser window down
        if (siblings.length > 1) {
          closed = await chrome.tabs.remove(tab.id).then(() => true).catch(() => false);
        }
      }
      sendResponse({
        ok: true,
        closed,
        autoClose: Boolean(state.autoCloseBlocked),
        lastTab: !closed,
        canUnblock: (state.localDomains || []).some((d) => normalizeDomain(d) === domain),
        domain,
      });
    } else if (message?.type === "SET_AUTO_CLOSE") {
      await chrome.storage.local.set({ autoCloseBlocked: Boolean(message.value) });
      sendResponse({ ok: true, value: Boolean(message.value) });
    } else if (message?.type === "BLOCK_ACTIVE_TAB") {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.url) {
        sendResponse({ ok: false, error: "No active tab to block" });
        return;
      }
      let host = "";
      try {
        host = new URL(tab.url).hostname;
      } catch {
        sendResponse({ ok: false, error: "This tab cannot be blocked" });
        return;
      }
      const result = await addLocalDomain(host);
      if (result.ok) {
        // send the tab to the block screen immediately — instant feedback
        chrome.tabs.update(tab.id, {
          url: chrome.runtime.getURL(`blocked.html?domain=${encodeURIComponent(result.domain)}&mode=always`),
        });
      }
      sendResponse(result);
    } else {
      sendResponse({ ok: false, error: "unknown message" });
    }
  })();
  return true; // keep the channel open for the async response
});

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
          domain: normalizeDomain(url.hostname),
          url: tab.url,
          title: tab.title || "",
        }),
      );
    }
  } catch {
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
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch {
    /* restricted page (chrome://, web store…) */
  }
}

/* ------------------------------- lifecycle ------------------------------ */

connectBridge();
refresh();

chrome.alarms.create("regainHeartbeat", { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "regainHeartbeat") {
    connectBridge();
    // self-heal: the browser can drop dynamic rules on update
    refresh();
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(DEFAULT_STATE).then((state) => {
    chrome.storage.local.set({ ...DEFAULT_STATE, ...state, localDomains: state.localDomains || [] });
    applyState({});
    connectBridge();
  });
});
chrome.runtime.onStartup.addListener(() => {
  connectBridge();
  refresh();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.localDomains) refresh();
  if (changes.focusModeActive || changes.domains || changes.rules) {
    chrome.storage.local.get(DEFAULT_STATE).then((state) => updateBadge({ ...DEFAULT_STATE, ...state }));
  }
});
