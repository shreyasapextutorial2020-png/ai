import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

interface WindowInfo {
  process_name: string;
  window_title: string;
  pid: number;
}

export default function App() {
  const [activeWindow, setActiveWindow] = useState<WindowInfo | null>(null);
  const [isFocusOn, setIsFocusOn] = useState(false);
  const [blockedAlert, setBlockedAlert] = useState<string | null>(null);
  const [blockList, setBlockList] = useState<string[]>([]);
  const [newProcess, setNewProcess] = useState("");

  useEffect(() => {
    invoke<string[]>("get_blocklist").then(setBlockList);

    const unlistenFocus = listen<WindowInfo>("window-focus-changed", (e) => {
      setActiveWindow(e.payload);
    });

    const unlistenBlocked = listen<WindowInfo>("distraction-blocked", (e) => {
      setBlockedAlert(`Blocked: ${e.payload.process_name}`);
      setTimeout(() => setBlockedAlert(null), 3000);
    });

    return () => {
      unlistenFocus.then((f) => f());
      unlistenBlocked.then((f) => f());
    };
  }, []);

  const handleToggle = async () => {
    const next = !isFocusOn;
    await invoke("toggle_focus_mode", { active: next });
    setIsFocusOn(next);
  };

  const addTarget = async () => {
    if (!newProcess.trim()) return;
    const item = newProcess.trim().toLowerCase();
    const updated = [...blockList, item.endsWith(".exe") ? item : `${item}.exe`];
    await invoke("update_blocklist", { list: updated });
    setBlockList(updated);
    setNewProcess("");
  };

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif", maxWidth: "600px", margin: "auto" }}>
      <h1>Regain PC - Focus Engine</h1>

      <div style={{ padding: "1rem", border: "1px solid #ccc", borderRadius: "8px", marginBottom: "1rem" }}>
        <h3>Current Window Detection</h3>
        <p><strong>App:</strong> {activeWindow?.process_name ?? "Waiting..."}</p>
        <p><strong>Title:</strong> {activeWindow?.window_title ?? "..."}</p>
        <p><strong>PID:</strong> {activeWindow?.pid ?? 0}</p>
      </div>

      <button
        onClick={handleToggle}
        style={{
          padding: "0.75rem 1.5rem",
          fontSize: "1.1rem",
          cursor: "pointer",
          backgroundColor: isFocusOn ? "#d9534f" : "#5cb85c",
          color: "#fff",
          border: "none",
          borderRadius: "6px"
        }}
      >
        {isFocusOn ? "Stop Focus Mode" : "Start Focus Mode"}
      </button>

      {blockedAlert && (
        <div style={{ marginTop: "1rem", padding: "0.5rem", backgroundColor: "#ffebee", color: "#c62828", borderRadius: "4px" }}>
          ⚠️ {blockedAlert}
        </div>
      )}

      <div style={{ marginTop: "2rem" }}>
        <h3>Blocked Apps List</h3>
        <ul>
          {blockList.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            placeholder="e.g. notepad.exe"
            value={newProcess}
            onChange={(e) => setNewProcess(e.target.value)}
            style={{ padding: "0.5rem", flex: 1 }}
          />
          <button onClick={addTarget} style={{ padding: "0.5rem 1rem" }}>Add</button>
        </div>
      </div>
    </main>
  );
}