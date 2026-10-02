import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface WindowInfo {
  process_name: string;
  window_title: string;
  pid: number;
}

export function useFocusManager() {
  const [isFocusActive, setIsFocusActive] = useState(false);
  const [currentApp, setCurrentApp] = useState<WindowInfo | null>(null);
  const [blockedAlert, setBlockedAlert] = useState<string | null>(null);

  useEffect(() => {
    // Listen for real-time focus changes (Screen Time data)
    const unlistenFocus = listen<WindowInfo>("window-focus-changed", (event) => {
      setCurrentApp(event.payload);
    });

    // Listen for blocked trigger
    const unlistenBlocked = listen<WindowInfo>("distraction-blocked", (event) => {
      setBlockedAlert(`Blocked: ${event.payload.process_name}`);
      setTimeout(() => setBlockedAlert(null), 3000);
    });

    return () => {
      unlistenFocus.then((f) => f());
      unlistenBlocked.then((f) => f());
    };
  }, []);

  const toggleFocus = async () => {
    const nextState = !isFocusActive;
    await invoke("toggle_focus_mode", { active: nextState });
    setIsFocusActive(nextState);
  };

  const updateBlocklist = async (items: string[]) => {
    await invoke("update_blocklist", { list: items });
  };

  return { isFocusActive, currentApp, blockedAlert, toggleFocus, updateBlocklist };
}