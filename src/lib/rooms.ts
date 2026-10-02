/**
 * Multiplayer study rooms.
 *
 * Transport is intentionally pluggable:
 *   1. WebSocket relay (server/room-server.mjs — zero dependencies, JSON frames)
 *      used when a room server is reachable, giving true multi-machine rooms;
 *   2. local mode otherwise — the room still runs with simulated study buddies
 *      so the leaderboard, chat and timers are usable offline.
 */

import type { RoomMember, RoomState } from "./types";

export type RoomStatus = "connecting" | "online" | "local";

export interface RoomTransport {
  status: () => RoomStatus;
  send: (text: string) => void;
  react: (emoji: string) => void;
  progress: (m: { minutes: number; focusing: boolean; sessionSec: number; distractions: number }) => void;
  close: () => void;
}

interface Handlers {
  room: RoomState;
  self: RoomMember;
  relayUrl?: string;
  onStatus: (s: RoomStatus) => void;
  onMembers: (members: RoomMember[]) => void;
  onChat: (chat: RoomState["chat"]) => void;
}

const SEND_INTERVAL = 4000;

/**
 * Derive a relay URL from the page origin so the browser preview can talk to a
 * sibling port without hard-coding sandbox hostnames.
 */
export function deriveRelayUrl(explicit?: string): string | undefined {
  if (explicit && explicit.trim()) {
    const v = explicit.trim();
    return v.replace(/^http/, "ws");
  }
  if (typeof window === "undefined") return undefined;
  const { protocol, host } = window.location;
  // Preview hosts look like 1420-<sandbox>.e2b.app — swap the leading port.
  const m = /^(\d+)-(.+)$/.exec(host);
  if (m) {
    return `${protocol === "https:" ? "wss" : "ws"}://8790-${m[2]}`;
  }
  if (protocol === "http:" && (host.startsWith("localhost") || host.startsWith("127.0.0.1"))) {
    return `ws://localhost:8790`;
  }
  return undefined;
}

export function connectRoom(handlers: Handlers): RoomTransport {
  const { room, self } = handlers;
  let status: RoomStatus = "connecting";
  let socket: WebSocket | null = null;
  let closed = false;
  let attempts = 0;
  let lastSend = 0;
  let lastProgress: RoomMember | null = null;
  let fallbackTimer: number | undefined;

  const setStatus = (s: RoomStatus) => {
    if (status !== s) {
      status = s;
      handlers.onStatus(s);
    }
  };

  const fallbackToLocal = () => {
    if (closed) return;
    setStatus("local");
  };

  const url = deriveRelayUrl(handlers.relayUrl);

  const connect = () => {
    if (closed || !url || attempts >= 3) {
      fallbackToLocal();
      return;
    }
    attempts += 1;
    try {
      socket = new WebSocket(url);
    } catch {
      fallbackToLocal();
      return;
    }

    // If nothing answers within 2.5s, degrade gracefully.
    fallbackTimer = window.setTimeout(() => fallbackToLocal(), 2500);

    socket.onopen = () => {
      window.clearTimeout(fallbackTimer);
      if (closed) return;
      setStatus("online");
      attempts = 0;
      socket?.send(JSON.stringify({ t: "hello", room: room.code, member: self }));
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.t === "state") {
          handlers.onMembers((msg.members as RoomMember[]) || []);
          handlers.onChat((msg.chat as RoomState["chat"]) || []);
        }
      } catch {
        /* ignore malformed frames */
      }
    };

    socket.onclose = () => {
      window.clearTimeout(fallbackTimer);
      if (closed) return;
      if (status === "online") {
        setStatus("connecting");
        window.setTimeout(connect, 1500);
      } else {
        fallbackToLocal();
      }
    };

    socket.onerror = () => {
      window.clearTimeout(fallbackTimer);
      socket?.close();
    };
  };

  connect();

  const post = (payload: Record<string, unknown>) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
      return true;
    }
    return false;
  };

  return {
    status: () => status,
    send: (text) => {
      if (!text.trim()) return;
      post({ t: "chat", text, member: self });
    },
    react: (emoji) => {
      post({ t: "reaction", emoji, member: self });
    },
    progress: (m) => {
      lastProgress = { ...self, ...m, lastSeen: Date.now() };
      const now = Date.now();
      if (now - lastSend < SEND_INTERVAL) return;
      lastSend = now;
      post({ t: "progress", member: lastProgress });
    },
    close: () => {
      closed = true;
      window.clearTimeout(fallbackTimer);
      post({ t: "bye", member: self });
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
      socket = null;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Study buddies for offline rooms                                     */
/* ------------------------------------------------------------------ */

const BUDDIES: Array<Pick<RoomMember, "name" | "avatar">> = [
  { name: "Aarav", avatar: "🐼" },
  { name: "Meera", avatar: "🦉" },
  { name: "Rohan", avatar: "🐯" },
  { name: "Ananya", avatar: "🦋" },
  { name: "Kabir", avatar: "🐺" },
  { name: "Ishita", avatar: "🐨" },
  { name: "Dev", avatar: "🦊" },
  { name: "Sara", avatar: "🐬" },
];

export function makeBuddies(count: number, goalMinutes: number, seed = Date.now()): RoomMember[] {
  const picked = [...BUDDIES].sort(() => Math.random() - 0.5).slice(0, count);
  return picked.map((b, i) => {
    const started = Date.now() - Math.floor(Math.random() * 40 * 60 * 1000);
    return {
      id: `bot-${seed}-${i}`,
      name: b.name,
      avatar: b.avatar,
      minutes: Math.floor(Math.random() * goalMinutes * 0.8),
      targetMinutes: goalMinutes,
      focusing: Math.random() > 0.25,
      sessionSec: Math.floor(((Date.now() - started) / 1000) % 5400),
      distractions: Math.floor(Math.random() * 4),
      isSelf: false,
      joinedAt: started,
      lastSeen: Date.now(),
      isBot: true,
      reactions: {},
    };
  });
}

/** Advance simulated buddies: they study, take breaks and occasionally slip. */
export function tickBuddies(members: RoomMember[], elapsedSec: number): RoomMember[] {
  return members.map((m) => {
    if (!m.isBot) return m;
    const focusing = Math.random() > 0.06 ? m.focusing : !m.focusing;
    const gain = focusing ? elapsedSec / 60 : 0;
    const distraction = focusing && Math.random() < 0.01 ? 1 : 0;
    return {
      ...m,
      focusing,
      minutes: Math.min(m.targetMinutes + 60, m.minutes + gain),
      sessionSec: focusing ? m.sessionSec + elapsedSec : 0,
      distractions: m.distractions + distraction,
      lastSeen: Date.now(),
    };
  });
}

export function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export function roomLink(code: string) {
  if (typeof window === "undefined") return code;
  return `${window.location.origin}${window.location.pathname}#room=${code}`;
}
