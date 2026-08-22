/**
 * Dev orchestrator for Tablinum — starts two servers and the app.
 *
 *   [vite]   app frontend             default port 1420
 *   [brand]  design/ (brand portal)   default port 1425
 *   [tauri]  desktop window, once the app frontend answers
 *
 *   node scripts/dev.mjs              # everything
 *   node scripts/dev.mjs --no-brand   # without the brand server
 *
 * Edge cases covered, for EACH server separately:
 *  - port taken but a Vite server already runs there -> reuse it, do not start
 *    a second one.
 *  - port taken by a foreign process -> move to the next free port. For the app
 *    server, Tauri's devUrl follows via a config override.
 *  - no free port in the search window -> abort with exit code 1.
 *  - beforeDevCommand is cleared so Tauri does not start a second Vite.
 *  - Vite may listen on IPv6 localhost -> port checks are dual-stack.
 *  - the config override is cleaned up on exit, Ctrl+C and SIGTERM.
 */
import { spawn } from "node:child_process";
import { writeFileSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveDevPort } from "./port-utils.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OVERRIDE_CONFIG = join(root, "src-tauri", "tauri.dev.conf.json");

const APP_PORT = Number(process.env.VITE_PORT) || 1420;
const BRAND_PORT = Number(process.env.BRAND_PORT) || 1425;
const PORT_RANGE = 20;
const WITH_BRAND = !process.argv.includes("--no-brand") && existsSync(join(root, "design"));

const onBusy = (label) => (busy) =>
  console.warn(`[dev] ${label}: port ${busy} is taken - trying ${busy + 1} ...`);

async function pick(label, basePort) {
  const r = await resolveDevPort(basePort, PORT_RANGE, onBusy(label));
  if (!r) {
    console.error(
      `[dev] ${label}: no free port between ${basePort} and ${basePort + PORT_RANGE - 1}.`,
    );
    process.exit(1);
  }
  return r;
}

function writeOverrideConfig(port) {
  // Tauri merges this file over tauri.conf.json.
  writeFileSync(
    OVERRIDE_CONFIG,
    `${JSON.stringify(
      { build: { beforeDevCommand: "", devUrl: `http://localhost:${port}` } },
      null,
      2,
    )}\n`,
  );
}

function cleanup() {
  try {
    rmSync(OVERRIDE_CONFIG, { force: true });
  } catch {
    /* ignore */
  }
}

const app = await pick("app", APP_PORT);
const brand = WITH_BRAND ? await pick("brand", BRAND_PORT) : null;

writeOverrideConfig(app.port);
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

// One entry per process that is actually started. Reused servers do NOT appear
// here — otherwise a second Vite would race for a port that is already taken.
const services = [];
if (app.reuse) console.log(`[dev] app: Vite already runs on ${app.port} - reusing it.`);
else services.push({ name: "vite", color: "cyan", cmd: "npm run dev" });

if (brand?.reuse)
  console.log(`[dev] brand: server already runs on ${brand.port} - reusing it.`);
else if (brand) services.push({ name: "brand", color: "yellow", cmd: "npm run dev:brand" });

services.push({ name: "tauri", color: "magenta", cmd: "node scripts/tauri-after-vite.mjs" });

console.log(`[dev] app   http://localhost:${app.port}`);
if (brand) console.log(`[dev] brand http://localhost:${brand.port}`);

// Careful: on Windows an args array with shell:true must not be used here —
// the commands would fall apart into single tokens. Hence one quoted line.
const cli = [
  "npx concurrently",
  "--kill-others", // stop everything once the app window closes
  "--success first",
  `--names ${services.map((s) => s.name).join(",")}`,
  `--prefix-colors ${services.map((s) => s.color).join(",")}`,
  ...services.map((s) => JSON.stringify(s.cmd)),
].join(" ");

const child = spawn(cli, {
  cwd: root,
  env: {
    ...process.env,
    VITE_PORT: String(app.port),
    ...(brand ? { BRAND_PORT: String(brand.port) } : {}),
  },
  stdio: "inherit",
  shell: true,
});

child.on("exit", (code, signal) => {
  cleanup();
  process.exit(code ?? (signal ? 1 : 0));
});
