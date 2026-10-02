/**
 * Icon and bundle-config validation.
 *
 * Regression guard for a real CI failure: Tauri's `generate_context!` rejects
 * non-RGBA PNG icons with a proc-macro panic, which only shows up at compile
 * time — and only on Linux/macOS, so a Windows build passes happily. These
 * checks catch it in a second instead of a 5 minute CI run.
 *
 *   node tests/icons.test.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
const failures = [];
const check = (label, ok, extra = "") => {
  if (ok) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failures.push(`${label}${extra ? ` — ${extra}` : ""}`);
    console.log(`FAIL  ${label}${extra ? ` — ${extra}` : ""}`);
  }
};

const config = JSON.parse(fs.readFileSync(path.join(root, "tauri.conf.json"), "utf8"));
const icons = config.bundle?.icon ?? [];

check("tauri.conf.json lists bundle icons", icons.length > 0, `${icons.length} entries`);

/** Minimal PNG header reader: width, height, bit depth, colour type. */
function readPng(file) {
  const buffer = fs.readFileSync(file);
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") return null;
  const length = buffer.readUInt32BE(8);
  const type = buffer.subarray(12, 16).toString("ascii");
  if (type !== "IHDR" || length < 13) return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colourType: buffer[25],
  };
}

const COLOUR_TYPE_NAMES = {
  0: "grayscale",
  2: "RGB",
  3: "indexed",
  4: "grayscale+alpha",
  6: "RGBA",
};

for (const icon of icons) {
  const file = path.join(root, icon);
  if (!fs.existsSync(file)) {
    check(`${icon} exists`, false);
    continue;
  }

  if (icon.endsWith(".png")) {
    const png = readPng(file);
    if (!png) {
      check(`${icon} is a PNG`, false, "bad signature or IHDR");
      continue;
    }
    check(`${icon} exists (${png.width}×${png.height})`, true);
    check(
      `${icon} is 8-bit RGBA (Tauri requires RGBA)`,
      png.colourType === 6 && png.bitDepth === 8,
      `${COLOUR_TYPE_NAMES[png.colourType] ?? png.colourType} depth ${png.bitDepth}`,
    );
    check(`${icon} is square`, png.width === png.height, `${png.width}×${png.height}`);
  } else if (icon.endsWith(".ico")) {
    const buffer = fs.readFileSync(file);
    const reserved = buffer.readUInt16LE(0);
    const type = buffer.readUInt16LE(2);
    const count = buffer.readUInt16LE(4);
    check(`${icon} is a valid ICO`, reserved === 0 && type === 1 && count > 0, `type=${type} images=${count}`);
    check(`${icon} embeds several sizes`, count >= 4, `${count} entries`);
  } else if (icon.endsWith(".icns")) {
    // Parse the container: header + OSType/length/payload records, each of
    // which must be a PNG for the ic07–ic10 types macOS accepts.
    const buffer = fs.readFileSync(file);
    const magic = buffer.subarray(0, 4).toString("ascii");
    const declared = buffer.readUInt32BE(4);
    check(`${icon} is a valid ICNS`, magic === "icns", magic);
    check(`${icon} declares its full length`, declared === buffer.length, `${declared} vs ${buffer.length}`);
    const types = [];
    let offset = 8;
    let valid = true;
    while (offset + 8 <= buffer.length) {
      const ostype = buffer.subarray(offset, offset + 4).toString("ascii");
      const length = buffer.readUInt32BE(offset + 4);
      if (length < 8 || offset + length > buffer.length) {
        valid = false;
        break;
      }
      const payload = buffer.subarray(offset + 8, offset + length);
      if (payload.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") types.push(ostype);
      offset += length;
    }
    check(`${icon} records parse cleanly`, valid && offset === buffer.length, `stopped at ${offset}/${buffer.length}`);
    check(`${icon} embeds several PNG sizes`, types.length >= 3, types.join(", "));
    check(`${icon} includes the Retina sizes macOS expects`, types.includes("ic07") && types.includes("ic08"), types.join(", "));
  }
}

/* --------------------------- platform coverage --------------------------- */

const referenced = icons.join(" ");
check("a Windows icon (.ico) is bundled", /\.ico/.test(referenced));
check("PNG icons are bundled for Linux", /\.png/.test(referenced));
check(
  "a macOS icon (.icns) is bundled or generatable",
  /\.icns/.test(referenced) || fs.existsSync(path.join(root, "icons/icon.icns")),
);

/* ------------------------------ config sanity ---------------------------- */

check("frontendDist points at the Vite output", config.build?.frontendDist === "dist", String(config.build?.frontendDist));
check("devUrl matches the Vite dev server", config.build?.devUrl === "http://localhost:1420", String(config.build?.devUrl));
check(
  "beforeBuildCommand builds the frontend first",
  String(config.build?.beforeBuildCommand).includes("build"),
  String(config.build?.beforeBuildCommand),
);
check("both app windows are declared", (config.app?.windows?.length ?? 0) >= 2, `${config.app?.windows?.length} windows`);
check(
  "the Focus Guard overlay window is hidden by default",
  config.app.windows.some((w) => w.label === "blocker" && w.visible === false),
);
check(
  "the main window has a sensible minimum size",
  Boolean(config.app.windows.find((w) => w.label === "main")?.minWidth),
);

const capabilities = fs.existsSync(path.join(root, "capabilities/default.json"))
  ? JSON.parse(fs.readFileSync(path.join(root, "capabilities/default.json"), "utf8"))
  : null;
check("capabilities file exists", Boolean(capabilities));
if (capabilities) {
  const windowLabels = (config.app?.windows ?? []).map((w) => w.label);
  const declared = capabilities.windows ?? [];
  check(
    "capabilities cover exactly the declared windows",
    declared.every((label) => windowLabels.includes(label)) && declared.length === windowLabels.length,
    `capabilities: ${declared.join(", ")} | config: ${windowLabels.join(", ")}`,
  );
  check("core:default permission is granted", (capabilities.permissions ?? []).includes("core:default"));
}

console.log(`\nicons: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  ✗ ${f}`);
process.exit(failures.length ? 1 : 0);
