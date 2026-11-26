import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");

fs.mkdirSync(DIST, { recursive: true });

// 1. Bundle MCP server into a standalone ESM file (zero runtime node_modules needed in plugin dir)
await esbuild.build({
  entryPoints: [path.join(ROOT, "src", "server.mjs")],
  outfile: path.join(DIST, "server.mjs"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  sourcemap: false,
  banner: {
    js: 'import { createRequire as __arCreateRequire } from "node:module"; const require = __arCreateRequire(import.meta.url);',
  },
});

// 2. Bundle the v2 resident daemon (Streamable HTTP MCP + local REST/SSE console API)
await esbuild.build({
  entryPoints: [path.join(ROOT, "src", "daemon", "index.mjs")],
  outfile: path.join(DIST, "daemon.mjs"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  sourcemap: false,
  banner: {
    js: 'import { createRequire as __arCreateRequire } from "node:module"; const require = __arCreateRequire(import.meta.url);',
  },
});

// 3. Bundle the stdio -> Streamable HTTP fallback bridge
await esbuild.build({
  entryPoints: [path.join(ROOT, "src", "bridge", "stdio-bridge.mjs")],
  outfile: path.join(DIST, "stdio-bridge.mjs"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  sourcemap: false,
  banner: {
    js: 'import { createRequire as __arCreateRequire } from "node:module"; const require = __arCreateRequire(import.meta.url);',
  },
});

// 4. Bundle UI script with @modelcontextprotocol/ext-apps and inline CSS + JS into single HTML
const uiBuild = await esbuild.build({
  entryPoints: [path.join(ROOT, "src", "ui", "app.js")],
  bundle: true,
  platform: "browser",
  target: "es2020",
  format: "iife",
  minify: true,
  write: false,
});

// Escape any accidental </script sequence inside bundled JS string literals
const jsCode = uiBuild.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const cssCode = fs.readFileSync(path.join(ROOT, "src", "ui", "styles.css"), "utf8");
const template = fs.readFileSync(path.join(ROOT, "src", "ui", "template.html"), "utf8");

// CRITICAL: Use function replacers (() => ...) so '$' patterns ($&, $`, $') inside minified JS never corrupt the HTML!
const html = template
  .replace("/*__INLINE_CSS__*/", () => cssCode)
  .replace("/*__INLINE_JS__*/", () => jsCode);

// Post-build integrity assertion
const doctypeCount = (html.match(/<!doctype html>/gi) || []).length;
if (
  doctypeCount !== 1 ||
  html.includes("/*__INLINE_JS__*/") ||
  html.includes("/*__INLINE_CSS__*/") ||
  html.includes('<script type="module">')
) {
  throw new Error(`console.html integrity check failed (doctypeCount=${doctypeCount})`);
}

fs.writeFileSync(path.join(DIST, "console.html"), html, "utf8");

// 5. Ship the zero-token doorbell waiter so the Lead Agent can run it from the installed plugin dir
const waitJobSrc = path.join(ROOT, "scripts", "wait-job.mjs");
const waitJobText = fs.readFileSync(waitJobSrc, "utf8");
if (!waitJobText.includes("process.exit(") || !waitJobText.includes("status.json")) {
  throw new Error("wait-job.mjs integrity check failed");
}
fs.writeFileSync(path.join(DIST, "wait-job.mjs"), waitJobText, "utf8");

// Post-build integrity assertions for the v2 bundles.
const daemonText = fs.readFileSync(path.join(DIST, "daemon.mjs"), "utf8");
const bridgeText = fs.readFileSync(path.join(DIST, "stdio-bridge.mjs"), "utf8");
if (!daemonText.includes("ASTAND_DAEMON_READY") || !daemonText.includes("StreamableHTTPServerTransport")) {
  throw new Error("daemon.mjs integrity check failed");
}
if (!bridgeText.includes("X-Astand-Transport") || !bridgeText.includes("stdio-bridge")) {
  throw new Error("stdio-bridge.mjs integrity check failed");
}

// 6. Build the v2 Magpie-style standalone desktop console (dist/desktop.html)
if (fs.existsSync(path.join(ROOT, "scripts", "build-desktop-ui.mjs"))) {
  await import("./build-desktop-ui.mjs");
}

console.log(
  `Built dist/server.mjs (${(fs.statSync(path.join(DIST, "server.mjs")).size / 1024).toFixed(1)} KB), ` +
  `dist/console.html (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB, verified OK), ` +
  `dist/wait-job.mjs, dist/daemon.mjs (${(fs.statSync(path.join(DIST, "daemon.mjs")).size / 1024).toFixed(1)} KB), ` +
  `dist/stdio-bridge.mjs (${(fs.statSync(path.join(DIST, "stdio-bridge.mjs")).size / 1024).toFixed(1)} KB)` +
  `${fs.existsSync(path.join(DIST, "desktop.html")) ? ` and dist/desktop.html (${(fs.statSync(path.join(DIST, "desktop.html")).size / 1024).toFixed(1)} KB)` : ""}`
);
