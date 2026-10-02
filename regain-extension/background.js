let socket = null;
let reconnectTimer = null;

function connectBridge() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    socket = new WebSocket("ws://127.0.0.1:48123");

    socket.onopen = () => {
      console.log("[Regain] Desktop WebSocket Connected");
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "FOCUS_MODE_STATE") {
          chrome.storage.local.set({ focusModeActive: data.active });
        }
      } catch (err) {
        console.error("[Regain] Parse error:", err);
      }
    };

    socket.onclose = () => {
      // Re-attempt connection after delay without immediately dropping active focus
      socket = null;
      if (!reconnectTimer) {
        reconnectTimer = setTimeout(connectBridge, 3000);
      }
    };

    socket.onerror = () => {
      if (socket) {
        socket.close();
      }
    };
  } catch (e) {
    console.error("[Regain] Connection attempt failed:", e);
  }
}

// 1. Initial connection
connectBridge();

// 2. Periodic Chrome Alarm keep-alive (prevents worker from idling out)
chrome.alarms.create("regainHeartbeat", { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "regainHeartbeat") {
    connectBridge();
  }
});

// 3. Re-awaken on installation, startup, and wake events
chrome.runtime.onInstalled.addListener(() => connectBridge());
chrome.runtime.onStartup.addListener(() => connectBridge());