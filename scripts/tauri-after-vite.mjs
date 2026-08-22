/**
 * Waits until the Vite dev server answers on VITE_PORT, then starts `tauri dev`
 * with the config override written by scripts/dev.mjs.
 *
 * No `&&` in the shell -> identical behaviour under cmd.exe, PowerShell and
 * POSIX shells.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isPortListening } from "./port-utils.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.VITE_PORT) || 1420;
const TIMEOUT_MS = 60_000;
const RETRY_MS = 250;

const deadline = Date.now() + TIMEOUT_MS;
while (!(await isPortListening(PORT))) {
  if (Date.now() > deadline) {
    console.error(
      `[tauri] Vite did not answer on port ${PORT} within ${TIMEOUT_MS / 1000}s - giving up.`,
    );
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, RETRY_MS));
}

console.log(`[tauri] Vite ready on port ${PORT} - starting Tauri ...`);

const overrideConfig = join(root, "src-tauri", "tauri.dev.conf.json");
const child = spawn(
  `npm run tauri -- dev --config ${JSON.stringify(overrideConfig)}`,
  { cwd: root, stdio: "inherit", shell: true },
);

const forward = (signal) => () => child.kill(signal);
process.on("SIGINT", forward("SIGINT"));
process.on("SIGTERM", forward("SIGTERM"));

child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
