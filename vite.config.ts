import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const port = Number(process.env.VITE_PORT) || 1420;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  // TailGrids components import through `@/…` — the alias lives in
  // tailgrids.config.json and must be mirrored here AND in tsconfig.json,
  // otherwise either the build or the type check falls over.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: port + 1,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`, and the hook layer's
      //    telemetry: every gate appends to `.claude/hooks/state/`, and a
      //    reload on each append throws away whatever the app had on screen.
      ignored: ["**/src-tauri/**", "**/.claude/**"],
    },
  },
}));
