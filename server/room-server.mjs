#!/usr/bin/env node
/**
 * Regain focus-room relay.
 *
 * Zero-dependency WebSocket server (RFC 6455) that keeps multiplayer study
 * rooms in sync: presence, focused minutes, chat and reactions.
 *
 *   node server/room-server.mjs            # listens on 0.0.0.0:8790
 *   PORT=9000 node server/room-server.mjs
 *
 * Protocol (JSON frames):
 *   client → { t: "hello",    room, member }
 *   client → { t: "progress", member }
 *   client → { t: "chat",     text, member }
 *   client → { t: "reaction", emoji, member }
 *   client → { t: "bye",      member }
 *   server → { t: "state",    members, chat }
 *
 * Only focus metadata is relayed — screen contents never leave the device.
 */

import crypto from "node:crypto";
import http from "node:http";

const PORT = Number(process.env.PORT || 8790);
const HOST = process.env.HOST || "0.0.0.0";
const MEMBER_TTL = 45_000;
const MAX_CHAT = 60;
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** roomCode → { members: Map<id, member>, chat: [], sockets: Set<ws> } */
const rooms = new Map();

function room(code) {
  let r = rooms.get(code);
  if (!r) {
    r = { code, members: new Map(), chat: [], sockets: new Set() };
    rooms.set(code, r);
  }
  return r;
}

/* ------------------------------ frame codec ------------------------------ */

function encodeFrame(payload, opcode = 0x1) {
  const data = Buffer.from(payload);
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, data]);
}

function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const b0 = buffer[offset];
    const b1 = buffer[offset + 1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) === 0x80;
    let len = b1 & 0x7f;
    let cursor = offset + 2;
    if (len === 126) {
      if (cursor + 2 > buffer.length) break;
      len = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (len === 127) {
      if (cursor + 8 > buffer.length) break;
      len = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }
    let mask = null;
    if (masked) {
      if (cursor + 4 > buffer.length) break;
      mask = buffer.subarray(cursor, cursor + 4);
      cursor += 4;
    }
    if (cursor + len > buffer.length) break;
    const payload = Buffer.from(buffer.subarray(cursor, cursor + len));
    if (mask) {
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    }
    frames.push({ opcode, payload });
    offset = cursor + len;
  }
  return { frames, rest: buffer.subarray(offset) };
}

/* -------------------------------- server -------------------------------- */

const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "regain-room-relay",
        rooms: rooms.size,
        members: [...rooms.values()].reduce((a, r) => a + r.members.size, 0),
      }),
    );
    return;
  }
  res.writeHead(404).end();
});

server.on("upgrade", (req, socket) => {
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = crypto.createHash("sha1").update(key + GUID).digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "\r\n",
    ].join("\r\n"),
  );
  socket.setNoDelay(true);

  const client = { socket, room: null, memberId: null };

  const send = (obj) => {
    if (socket.destroyed) return;
    try {
      socket.write(encodeFrame(JSON.stringify(obj)));
    } catch {
      /* client vanished */
    }
  };

  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const { frames, rest } = decodeFrames(buffer);
    buffer = rest;
    for (const frame of frames) {
      if (frame.opcode === 0x8) {
        socket.end();
        return;
      }
      if (frame.opcode === 0x9) {
        socket.write(encodeFrame("", 0xa));
        continue;
      }
      if (frame.opcode !== 0x1) continue;
      let msg;
      try {
        msg = JSON.parse(frame.payload.toString("utf8"));
      } catch {
        continue;
      }
      handleMessage(client, msg, send);
    }
  });

  const cleanup = () => {
    const r = client.room ? rooms.get(client.room) : null;
    if (r) {
      r.sockets.delete(client);
      if (client.memberId) r.members.delete(client.memberId);
      if (!r.members.size && !r.sockets.size) rooms.delete(r.code);
      broadcast(r);
    }
  };

  socket.on("close", cleanup);
  socket.on("error", cleanup);
});

function handleMessage(client, msg, send) {
  switch (msg.t) {
    case "hello": {
      const code = String(msg.room || "").toUpperCase().slice(0, 12) || "PUBLIC";
      client.room = code;
      const r = room(code);
      client.memberId = msg.member?.id || crypto.randomUUID();
      r.sockets.add(client);
      const existing = r.members.get(client.memberId) || {};
      r.members.set(client.memberId, {
        id: client.memberId,
        name: msg.member?.name || "Guest",
        avatar: msg.member?.avatar || "🦊",
        minutes: existing.minutes ?? msg.member?.minutes ?? 0,
        targetMinutes: msg.member?.targetMinutes ?? 120,
        focusing: msg.member?.focusing ?? false,
        sessionSec: msg.member?.sessionSec ?? 0,
        distractions: msg.member?.distractions ?? 0,
        isSelf: false,
        joinedAt: existing.joinedAt ?? Date.now(),
        lastSeen: Date.now(),
      });
      send({ t: "state", members: [...r.members.values()], chat: r.chat });
      broadcast(r);
      break;
    }
    case "progress": {
      const r = client.room ? rooms.get(client.room) : null;
      if (!r || !client.memberId) return;
      const prev = r.members.get(client.memberId);
      if (!prev) return;
      r.members.set(client.memberId, {
        ...prev,
        minutes: Number(msg.member?.minutes ?? prev.minutes),
        focusing: Boolean(msg.member?.focusing),
        sessionSec: Number(msg.member?.sessionSec ?? 0),
        distractions: Number(msg.member?.distractions ?? prev.distractions),
        lastSeen: Date.now(),
      });
      broadcast(r);
      break;
    }
    case "chat": {
      const r = client.room ? rooms.get(client.room) : null;
      if (!r) return;
      const text = String(msg.text || "").slice(0, 400);
      if (!text.trim()) return;
      r.chat.push({
        id: crypto.randomUUID(),
        memberId: client.memberId,
        name: msg.member?.name || "Guest",
        avatar: msg.member?.avatar || "🦊",
        text,
        at: Date.now(),
      });
      if (r.chat.length > MAX_CHAT) r.chat = r.chat.slice(-MAX_CHAT);
      broadcast(r);
      break;
    }
    case "reaction": {
      const r = client.room ? rooms.get(client.room) : null;
      if (!r || !client.memberId) return;
      const member = r.members.get(client.memberId);
      if (!member) return;
      const emoji = String(msg.emoji || "👍").slice(0, 4);
      member.reactions = member.reactions || {};
      member.reactions[emoji] = (member.reactions[emoji] || 0) + 1;
      broadcast(r);
      break;
    }
    case "bye": {
      const r = client.room ? rooms.get(client.room) : null;
      if (r && client.memberId) r.members.delete(client.memberId);
      if (r) broadcast(r);
      break;
    }
    default:
      break;
  }
}

function broadcast(r) {
  const now = Date.now();
  for (const [id, member] of r.members) {
    if (now - (member.lastSeen || 0) > MEMBER_TTL) r.members.delete(id);
  }
  const payload = encodeFrame(
    JSON.stringify({ t: "state", members: [...r.members.values()], chat: r.chat }),
  );
  for (const client of r.sockets) {
    if (!client.socket.destroyed) client.socket.write(payload);
  }
}

/* Reap rooms that have no live sockets and no recent members, so a relay that
   runs for months does not accumulate dead rooms. */
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    for (const [id, member] of r.members) {
      if (now - (member.lastSeen || 0) > MEMBER_TTL) r.members.delete(id);
    }
    const liveSockets = [...r.sockets].filter((c) => !c.socket.destroyed);
    if (liveSockets.length === 0 && r.members.size === 0) rooms.delete(code);
  }
}, 30_000).unref();

server.listen(PORT, HOST, () => {
  console.log(`[regain] room relay listening on ws://${HOST}:${PORT}`);
  console.log("[regain] health check: http://127.0.0.1:%d/health", PORT);
});
