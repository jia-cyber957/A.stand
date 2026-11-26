#!/usr/bin/env node
/**
 * A.stand stdio -> Streamable HTTP bridge.
 *
 * Lightweight newline-delimited JSON-RPC proxy for MCP clients that cannot speak
 * local Streamable HTTP (or that hit localhost OAuth prompts). It NEVER shuts the
 * daemon down: stdin EOF just exits this process with code 0 and no DELETE call.
 */
import readline from "node:readline";

function parseArgs(argv) {
  const opts = { url: "", token: "" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--url" && argv[i + 1] !== undefined) opts.url = argv[++i];
    else if (arg.startsWith("--url=")) opts.url = arg.slice("--url=".length);
    else if (arg === "--token" && argv[i + 1] !== undefined) opts.token = argv[++i];
    else if (arg.startsWith("--token=")) opts.token = arg.slice("--token=".length);
  }
  return opts;
}

const cli = parseArgs(process.argv.slice(2));
const URL_VALUE = (cli.url || process.env.ASTAND_URL || "").trim();
const TOKEN_VALUE = (cli.token || process.env.ASTAND_TOKEN || "").trim();

if (!URL_VALUE) {
  process.stderr.write("stdio-bridge: missing --url (or ASTAND_URL)\n");
  process.exit(2);
}
if (!TOKEN_VALUE) {
  process.stderr.write("stdio-bridge: missing --token (or ASTAND_TOKEN)\n");
  process.exit(2);
}

let sessionId = "";
let exiting = false;

function writeMessage(message) {
  if (!message || typeof message !== "object") return;
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function parseSsePayload(text) {
  // SSE frames are separated by a blank line; collect every `data:` line per frame.
  for (const frame of text.split(/\r?\n\r?\n/)) {
    const dataLines = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (!dataLines.length) continue;
    const payload = dataLines.join("\n").trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      writeMessage(JSON.parse(payload));
    } catch {
      // Non-JSON SSE data (heartbeats / comments) is ignored on purpose.
    }
  }
}

async function forward(message) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${TOKEN_VALUE}`,
    "X-Astand-Transport": "stdio-bridge",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  let response;
  try {
    response = await fetch(URL_VALUE, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
    });
  } catch (err) {
    // Transport-level failure: surface it as a JSON-RPC error rather than dying silently.
    writeMessage({
      jsonrpc: "2.0",
      id: message?.id ?? null,
      error: { code: -32000, message: `A.stand bridge: daemon unreachable (${err?.message || String(err)})` },
    });
    return;
  }

  const returnedSession = response.headers.get("mcp-session-id");
  if (returnedSession) sessionId = returnedSession;

  if (response.status === 202 || response.status === 204) return; // Notification accepted: no payload.

  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (response.status >= 400) {
    const text = await response.text().catch(() => "");
    if (contentType.includes("text/event-stream")) {
      parseSsePayload(text);
      return;
    }
    try {
      const parsed = JSON.parse(text);
      writeMessage(parsed);
    } catch {
      writeMessage({
        jsonrpc: "2.0",
        id: message?.id ?? null,
        error: { code: -32000, message: `A.stand bridge: HTTP ${response.status} ${text.slice(0, 300)}` },
      });
    }
    return;
  }

  if (contentType.includes("text/event-stream")) {
    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.search(/\r?\n\r?\n/);
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + (buffer[boundary] === "\r" ? 4 : 2));
        parseSsePayload(frame);
        boundary = buffer.search(/\r?\n\r?\n/);
      }
    }
    if (buffer.trim()) parseSsePayload(buffer);
    return;
  }

  const text = await response.text();
  if (!text.trim()) return;
  try {
    writeMessage(JSON.parse(text));
  } catch {
    // Fall back to SSE-style parsing for servers that stream JSON without the header.
    parseSsePayload(text);
  }
}

// Strictly serial: MCP over stdio is ordered, and one HTTP round-trip per message keeps
// request/response pairing correct (including the initialize -> session-id exchange).
let queue = Promise.resolve();
function enqueue(message) {
  queue = queue
    .then(() => forward(message))
    .catch((err) => {
      writeMessage({
        jsonrpc: "2.0",
        id: message?.id ?? null,
        error: { code: -32000, message: `A.stand bridge error: ${err?.message || String(err)}` },
      });
    });
}

function shutdown(code = 0) {
  if (exiting) return;
  exiting = true;
  // Never DELETE the daemon session on EOF: the resident daemon outlives this bridge.
  process.exit(code);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    writeMessage({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error: invalid JSON" },
    });
    return;
  }
  enqueue(message);
});

rl.on("close", () => {
  // Drain in-flight requests before exiting so the last response is not lost.
  queue.finally(() => shutdown(0));
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
