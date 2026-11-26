#!/usr/bin/env node
/**
 * Build the A.stand v2 desktop console into a single self-contained HTML file.
 *
 *   1. Bundle src/desktop-ui/app.js (+ icons.js) with esbuild as an IIFE.
 *   2. Inline styles.css and the bundle into template.html.
 *   3. Assert integrity and write dist/desktop.html.
 *
 * The output has zero external references so it renders instantly inside the
 * Tauri WebView2 shell under a strict Content-Security-Policy.
 */
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "src", "desktop-ui");
const DIST_DIR = path.join(ROOT, "dist");
const OUT_FILE = path.join(DIST_DIR, "desktop.html");

const CSS_PLACEHOLDER = "/*__INLINE_CSS__*/";
const JS_PLACEHOLDER = "/*__INLINE_JS__*/";

function fail(message) {
  throw new Error(`[build-desktop-ui] ${message}`);
}

function readSource(name) {
  const file = path.join(SRC_DIR, name);
  if (!fs.existsSync(file)) fail(`missing source file: ${path.relative(ROOT, file)}`);
  return fs.readFileSync(file, "utf8");
}

// ---------------------------------------------------------------------------
// 1. Bundle the browser script
// ---------------------------------------------------------------------------
const entryPoint = path.join(SRC_DIR, "app.js");
if (!fs.existsSync(entryPoint)) fail(`missing entry point: ${path.relative(ROOT, entryPoint)}`);

const startedAt = Date.now();
let bundleResult;
try {
  bundleResult = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: "browser",
    target: "es2020",
    format: "iife",
    minify: true,
    write: false,
    legalComments: "none",
    charset: "utf8",
    logLevel: "silent",
  });
} catch (err) {
  const detail = err?.errors?.map((e) => `${e.text}${e.location ? ` (${e.location.file}:${e.location.line})` : ""}`).join("\n") || err?.message;
  fail(`esbuild bundle failed:\n${detail}`);
}

const output = bundleResult.outputFiles?.[0];
if (!output || typeof output.text !== "string" || !output.text.trim()) {
  fail("esbuild produced an empty bundle");
}

const jsCode = output.text.replace(/<\/script/gi, "<\\/script");
if (/<\/script/i.test(jsCode)) fail("bundle still contains a literal </script sequence after escaping");

// ---------------------------------------------------------------------------
// 2. Inline CSS + JS into the template
// ---------------------------------------------------------------------------
const cssCode = readSource("styles.css");
const template = readSource("template.html");

if (!template.includes(CSS_PLACEHOLDER)) fail(`template is missing the CSS placeholder ${CSS_PLACEHOLDER}`);
if (!template.includes(JS_PLACEHOLDER)) fail(`template is missing the JS placeholder ${JS_PLACEHOLDER}`);

// Function replacers are mandatory: `$&`, `$'` and `` $` `` sequences inside the
// minified bundle must never be interpreted as replacement patterns.
const html = template
  .replace(CSS_PLACEHOLDER, () => cssCode)
  .replace(JS_PLACEHOLDER, () => jsCode);

// ---------------------------------------------------------------------------
// 3. Integrity assertions
// ---------------------------------------------------------------------------
const problems = [];
const doctypeMatches = html.match(/<!doctype html>/gi) || [];
if (doctypeMatches.length !== 1) problems.push(`expected exactly 1 doctype, found ${doctypeMatches.length}`);
if (!/^\s*<!doctype html>/i.test(html)) problems.push("doctype must be the first thing in the document");

for (const marker of [CSS_PLACEHOLDER, JS_PLACEHOLDER, "__INLINE_CSS__", "__INLINE_JS__"]) {
  if (html.includes(marker)) problems.push(`unreplaced placeholder remained: ${marker}`);
}
if (/\{\{[A-Z0-9_]+\}\}/.test(html)) problems.push("unreplaced {{PLACEHOLDER}} token remained");

if (/<script[^>]+src\s*=\s*["']?(?:https?:)?\/\//i.test(html)) problems.push("external <script src> reference found");
if (/<link[^>]+href\s*=\s*["']?(?:https?:)?\/\//i.test(html)) problems.push("external <link href> reference found");
if (/@import\s+(?:url\()?["']?(?:https?:)?\/\//i.test(html)) problems.push("external @import found in CSS");
if (/url\(\s*["']?(?:https?:)?\/\//i.test(cssCode)) problems.push("external url() found in CSS");

// Lightweight structural balance check (script/style bodies are already inlined,
// so only count tags that the template itself owns).
const countTag = (name) => (html.match(new RegExp(`<${name}\\b`, "gi")) || []).length;
const countClose = (name) => (html.match(new RegExp(`</${name}>`, "gi")) || []).length;
for (const tag of ["html", "head", "body"]) {
  const open = countTag(tag);
  const close = countClose(tag);
  if (open !== 1 || close !== 1) problems.push(`expected exactly one <${tag}> pair, found ${open} open / ${close} close`);
}
if (countTag("style") !== countClose("style")) problems.push("<style> tags are unbalanced");
if (countTag("script") !== countClose("script")) problems.push("<script> tags are unbalanced");

if (!html.includes("data-theme=\"light\"")) problems.push("light theme must be the default on <html>");

if (problems.length) fail(`integrity check failed:\n - ${problems.join("\n - ")}`);

// ---------------------------------------------------------------------------
// 4. Write the artifact
// ---------------------------------------------------------------------------
fs.mkdirSync(DIST_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, html, "utf8");

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const cssBytes = Buffer.byteLength(cssCode);
const jsBytes = Buffer.byteLength(jsCode);
const htmlBytes = Buffer.byteLength(html);

console.log(
  `[build-desktop-ui] wrote ${path.relative(ROOT, OUT_FILE)} — ${kb(htmlBytes)} ` +
    `(css ${kb(cssBytes)}, js ${kb(jsBytes)}, ${Date.now() - startedAt}ms, verified OK)`
);
