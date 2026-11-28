import net from "node:net";
import os from "node:os";

export function proseTitle(text, max = 140) {
  const paragraph = String(text || "").trim().split(/\r?\n\s*\r?\n/).at(-1) || "";
  const lastLine = paragraph.trim().split(/\r?\n/).at(-1) || "";
  const sentence = lastLine.split(/(?<=[.!?])\s+(?=\S)|(?<=[。！？])(?=\S)/).at(-1)?.trim() || "";
  return sentence.length > max ? sentence.slice(0, max - 1).trimEnd() + "…" : sentence;
}

export class UpstreamProtocolError extends Error {
  constructor(engine, version, method, detail) {
    super(`[${engine}${version ? ` ${version}` : ""}] protocol error on ${method}: ${detail}`);
    this.name = "UpstreamProtocolError";
    this.engine = engine;
    this.version = version || "";
    this.method = method;
    this.detail = detail;
  }
}

export function safeKill(proc) {
  if (!proc || proc.killed || proc.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    proc.once("exit", finish);
    try {
      proc.stdin?.end();
    } catch {}
    try {
      proc.kill();
    } catch {}
    setTimeout(() => {
      try {
        if (!proc.killed && proc.exitCode === null) proc.kill("SIGKILL");
      } catch {}
      finish();
    }, 1500).unref();
  });
}

export function utf8Env(extra = {}) {
  const winDefaults =
    process.platform === "win32"
      ? {
          OS: process.env.OS || "Windows_NT",
          SYSTEMROOT: process.env.SYSTEMROOT || "C:\\Windows",
          WINDIR: process.env.WINDIR || process.env.SYSTEMROOT || "C:\\Windows",
          COMSPEC: process.env.COMSPEC || "C:\\Windows\\system32\\cmd.exe",
          PATHEXT:
            process.env.PATHEXT ||
            ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC",
          PROGRAMDATA: process.env.PROGRAMDATA || "C:\\ProgramData",
          TEMP: process.env.TEMP || process.env.TMP || os.tmpdir(),
          TMP: process.env.TMP || process.env.TEMP || os.tmpdir(),
        }
      : {};
  return {
    ...winDefaults,
    ...process.env,
    PYTHONIOENCODING: "utf-8",
    LANG: process.env.LANG || "C.UTF-8",
    ...extra,
  };
}

const PROXY_ENV_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"];
const LOOPBACK_PROXY_RE = /^(?:https?|socks\d?):\/\/(127\.0\.0\.1|localhost):(\d+)\/?$/;
const PROXY_PROBE_TIMEOUT_MS = 150;
const PROXY_PROBE_TTL_MS = 15_000;
const proxyReachability = new Map(); // `${host}:${port}` -> { ok, at }

function probeLoopback(host, port) {
  return new Promise((resolve) => {
    let settled = false;
    let socket = null;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      try {
        socket?.destroy();
      } catch {}
      resolve(ok);
    };
    try {
      socket = net.createConnection({ host, port });
    } catch {
      finish(false);
      return;
    }
    socket.setTimeout(PROXY_PROBE_TIMEOUT_MS);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function isLoopbackReachable(host, port) {
  const key = `${host}:${port}`;
  const cached = proxyReachability.get(key);
  const now = Date.now();
  if (cached && now - cached.at < PROXY_PROBE_TTL_MS) return cached.ok;
  const ok = await probeLoopback(host, port);
  proxyReachability.set(key, { ok, at: now });
  return ok;
}

/**
 * Builds the UTF-8 env but drops dead loopback proxies (e.g. an inactive
 * 127.0.0.1:10808 left over from a stopped TUN/VPN tool) that would otherwise
 * blackhole every outbound request. Live loopback proxies and non-loopback
 * proxies are preserved. Reachability is cached per host:port for 15s.
 */
export async function utf8EnvChecked(extra = {}) {
  const env = utf8Env(extra);
  const probes = [];
  for (const key of PROXY_ENV_KEYS) {
    const value = env[key];
    if (!value) continue;
    const match = LOOPBACK_PROXY_RE.exec(String(value).trim());
    if (!match) continue;
    probes.push(
      isLoopbackReachable(match[1], Number(match[2])).then((ok) => {
        if (!ok) env[key] = "";
      })
    );
  }
  if (probes.length) await Promise.all(probes);
  return env;
}
