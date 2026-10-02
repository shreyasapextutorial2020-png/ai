import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Regain PC runs inside a Tauri webview in production, but the very same UI is
// served by Vite in the browser so the app can be previewed without a desktop
// build. Everything browser-side is served from this one origin (no localhost
// fetches), so the app works behind any proxy / preview host.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: host || "0.0.0.0",
    port: 1420,
    strictPort: true,
    // Allow tunnel / preview hosts (e2b, ngrok, cloudflare, LAN IPs...).
    allowedHosts: true,
    watch: { ignored: ["**/src-tauri/**", "**/target/**"] },
  },
  build: {
    target: "es2021",
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  envPrefix: ["VITE_", "TAURI_"],
});
