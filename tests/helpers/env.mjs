/**
 * Shared jsdom environment for the UI tests.
 *
 * jsdom is used instead of a headless browser so the suite runs anywhere Node
 * runs (CI, sandbox, a laptop without Chrome). It supplies the handful of
 * browser APIs the app touches — Web Audio, Notifications, WebSocket — while
 * keeping the real React tree, the real store and the real relay connection.
 */
import { JSDOM } from "jsdom";

function audioParam() {
  return {
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
    setTargetAtTime() {},
  };
}

class FakeAudioContext {
  constructor() {
    this.sampleRate = 44100;
    this.currentTime = 0;
    this.state = "running";
    this.destination = {};
  }
  createGain() {
    return { gain: audioParam(), connect() {}, disconnect() {} };
  }
  createBiquadFilter() {
    return { type: "", frequency: audioParam(), Q: audioParam(), connect() {}, disconnect() {} };
  }
  createOscillator() {
    return { type: "", frequency: audioParam(), connect() {}, disconnect() {}, start() {}, stop() {} };
  }
  createBufferSource() {
    return { buffer: null, loop: false, connect() {}, disconnect() {}, start() {}, stop() {} };
  }
  createBuffer() {
    return { getChannelData: () => new Float32Array(64) };
  }
  resume() {}
}

export function createAppDom({ url = "http://localhost:1420/#focus", storage = null } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true,
    url,
  });
  const { window } = dom;

  window.AudioContext = FakeAudioContext;
  window.Notification = class {
    static permission = "granted";
    static requestPermission() {
      return Promise.resolve("granted");
    }
  };
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};

  if (storage) {
    window.localStorage.setItem("regain.pc.state.v1", JSON.stringify(storage));
  }

  const errors = [];
  window.addEventListener("error", (e) => errors.push(String(e.message)));
  window.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason)));
  const originalError = console.error;
  console.error = (...args) => {
    const text = args.map(String).join(" ");
    // React's act() chatter is noise for a non-act environment
    if (!/not wrapped in act/.test(text)) errors.push(text);
    originalError(...args);
  };

  globalThis.window = window;
  globalThis.document = window.document;
  Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
  globalThis.localStorage = window.localStorage;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.getComputedStyle = window.getComputedStyle;
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);

  const tick = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));
  const buttons = () => [...window.document.querySelectorAll("button")];
  const findButton = (re) => buttons().find((b) => re.test(b.textContent.trim()));
  const click = async (element, wait = 140) => {
    element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await tick(wait);
  };
  const navTo = async (index, wait = 160) => {
    const navItems = [...window.document.querySelectorAll(".nav-item")];
    await click(navItems[index], wait);
  };
  /** React tracks input value on the DOM node — bypass the tracker properly. */
  const setReactValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  const contentText = () => window.document.querySelector(".content")?.textContent ?? "";
  const contentHtml = () => window.document.querySelector(".content")?.innerHTML ?? "";
  const storedState = () => JSON.parse(window.localStorage.getItem("regain.pc.state.v1") || "{}");

  return { dom, window, errors, tick, buttons, findButton, click, navTo, setReactValue, contentText, contentHtml, storedState };
}

export function createReporter(suiteName) {
  const failures = [];
  let passed = 0;
  return {
    check(label, ok, extra = "") {
      if (ok) {
        passed += 1;
        console.log(`  PASS  ${label}`);
      } else {
        failures.push(`${label}${extra ? ` — ${extra}` : ""}`);
        console.log(`  FAIL  ${label}${extra ? ` — ${extra}` : ""}`);
      }
    },
    finish() {
      console.log(`\n${suiteName}: ${passed} passed, ${failures.length} failed`);
      for (const f of failures) console.log(`  ✗ ${f}`);
      return failures.length === 0;
    },
    failures,
    get passed() {
      return passed;
    },
  };
}
