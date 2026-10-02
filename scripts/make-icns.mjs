#!/usr/bin/env node
/**
 * Builds icons/icon.icns (macOS bundle icon) from the PNG set.
 *
 * ImageMagick's ICNS writer is not always available and can emit a renamed PNG
 * instead of a real container, so this writes the Apple icon format directly:
 * a header followed by OSType/length/payload records. Modern macOS accepts PNG
 * payloads for the ic07–ic10 types, which is what Tauri's bundler expects.
 *
 *   node scripts/make-icns.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const iconsDir = path.join(root, "icons");

/** OSType → source PNG. ic07=128², ic08=256², ic09=512², ic10=1024². */
const ENTRIES = [
  ["ic07", "128x128.png"],
  ["ic08", "128x128@2x.png"],
  ["ic09", "icon.png"],
  ["ic10", "source.png"],
];

const records = [];
for (const [type, file] of ENTRIES) {
  const full = path.join(iconsDir, file);
  if (!fs.existsSync(full)) {
    console.warn(`[icns] skipping ${type}: ${file} missing`);
    continue;
  }
  const data = fs.readFileSync(full);
  if (data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    console.warn(`[icns] skipping ${type}: ${file} is not a PNG`);
    continue;
  }
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, "ascii");
  header.writeUInt32BE(data.length + 8, 4);
  records.push(Buffer.concat([header, data]));
}

if (!records.length) {
  console.error("[icns] no usable PNGs found — nothing written");
  process.exit(1);
}

const body = Buffer.concat(records);
const fileHeader = Buffer.alloc(8);
fileHeader.write("icns", 0, 4, "ascii");
fileHeader.writeUInt32BE(body.length + 8, 4);

const out = path.join(iconsDir, "icon.icns");
fs.writeFileSync(out, Buffer.concat([fileHeader, body]));
console.log(`[icns] wrote ${path.relative(root, out)} (${records.length} images, ${(body.length + 8) / 1024 | 0} kB)`);
