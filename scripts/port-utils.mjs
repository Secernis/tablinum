/**
 * Dual-stack port helpers.
 *
 * Important on Windows: without an explicit `host`, Vite binds to "localhost",
 * which often resolves to ::1 (IPv6) there. A check against 127.0.0.1 alone
 * reports the port as free — or waits forever. Both loopback addresses are
 * therefore always checked.
 */
import net from "node:net";

export const LOOPBACKS = ["127.0.0.1", "::1"];

/** Attempts a TCP connection; true means something is listening. */
export function canConnect(port, host, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/** True as soon as any loopback address answers. */
export async function isPortListening(port, timeoutMs = 1000) {
  const results = await Promise.all(
    LOOPBACKS.map((host) => canConnect(port, host, timeoutMs)),
  );
  return results.some(Boolean);
}

/** True when the port can be bound on all interfaces. */
function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port);
  });
}

/**
 * True when the port is taken — by an IPv4, IPv6, or exclusively bound
 * listener alike.
 */
export async function isPortTaken(port) {
  if (await isPortListening(port, 400)) return true;
  return !(await canListen(port));
}

/** True when a Vite dev server answers on that port. */
export async function isViteServer(port) {
  try {
    const res = await fetch(`http://localhost:${port}/@vite/client`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok && (res.headers.get("content-type") ?? "").includes("javascript");
  } catch {
    return false;
  }
}

/**
 * Picks the port for a dev run.
 *
 * @returns {Promise<{port:number, reuse:boolean}|null>}
 *   reuse=true  -> a Vite server already runs on basePort, no second one needed
 *   reuse=false -> this port is free and will be taken by Vite
 *   null        -> nothing free within [basePort, basePort+range)
 */
export async function resolveDevPort(basePort, range = 20, onBusy = () => {}) {
  for (let port = basePort; port < basePort + range; port++) {
    if (!(await isPortTaken(port))) return { port, reuse: false };

    if (port === basePort && (await isViteServer(port))) {
      return { port, reuse: true };
    }
    onBusy(port);
  }
  return null;
}
