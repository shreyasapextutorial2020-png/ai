/**
 * Minimal RFC 6455 WebSocket client used by the test suite to act as a second
 * study-room member (and to verify the relay without extra dependencies).
 */
import net from "node:net";
import crypto from "node:crypto";

export function encodeClientFrame(payload) {
  const data = Buffer.from(payload);
  const len = data.length;
  const mask = crypto.randomBytes(4);
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x81;
  const masked = Buffer.from(data);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

export function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const b1 = buffer[offset + 1];
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
    if (cursor + len > buffer.length) break;
    frames.push(buffer.subarray(cursor, cursor + len).toString("utf8"));
    offset = cursor + len;
  }
  return { frames, rest: buffer.subarray(offset) };
}

export function connect(port = 8790, host = "127.0.0.1", name = "client") {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, host);
    const key = crypto.randomBytes(16).toString("base64");
    socket.on("connect", () => {
      socket.write(
        `GET /ws HTTP/1.1\r\nHost: ${host}:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    let buffer = Buffer.alloc(0);
    let upgraded = false;
    const messages = [];
    const waiters = [];
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const idx = buffer.indexOf("\r\n\r\n");
        if (idx === -1) return;
        const head = buffer.subarray(0, idx).toString();
        if (!head.includes("101")) return reject(new Error(`${name}: upgrade failed`));
        buffer = buffer.subarray(idx + 4);
        upgraded = true;
        resolve(client);
      }
      const { frames, rest } = decodeFrames(buffer);
      buffer = rest;
      for (const frame of frames) {
        let parsed;
        try {
          parsed = JSON.parse(frame);
        } catch {
          continue;
        }
        messages.push(parsed);
        waiters.splice(0).forEach((w) => w(parsed));
      }
    });
    socket.on("error", reject);

    const client = {
      name,
      messages,
      send: (obj) => socket.write(encodeClientFrame(JSON.stringify(obj))),
      next: (predicate, timeout = 3000, label = "") =>
        new Promise((res, rej) => {
          const found = messages.find(predicate);
          if (found) return res(found);
          const timer = setTimeout(
            () => rej(new Error(`${name}: timeout waiting for ${label || "message"}`)),
            timeout,
          );
          const waiter = (msg) => {
            if (predicate(msg)) {
              clearTimeout(timer);
              res(msg);
            } else {
              waiters.push(waiter);
            }
          };
          waiters.push(waiter);
        }),
      close: () => socket.destroy(),
    };
  });
}

export const member = (id, name, minutes = 0) => ({
  id,
  name,
  avatar: "🦉",
  minutes,
  targetMinutes: 120,
  focusing: true,
  sessionSec: 600,
  distractions: 0,
});
