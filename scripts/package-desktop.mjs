#!/usr/bin/env node
/**
 * Package the A.stand portable Windows desktop bundle.
 *
 *   1. Resolve a usable cargo (auto-prepending %USERPROFILE%\.cargo\bin).
 *   2. Refresh the Node bundles via `npm run build` (daemon.mjs / desktop.html /
 *      stdio-bridge.mjs / wait-job.mjs).
 *   3. Build the Tauri release binary.
 *   4. Assemble dist-desktop/A.stand/ as a self-contained portable folder.
 *
 * The portable layout is exactly what the Rust supervisor probes for first:
 *   dist-desktop/A.stand/
 *     a-stand.exe
 *     daemon.mjs
 *     desktop.html
 *     stdio-bridge.mjs
 *     wait-job.mjs
 *     plugin/rules/AGENTS.md
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const TAURI_DIR = path.join(ROOT, "desktop", "src-tauri");
const OUT_DIR = path.join(ROOT, "dist-desktop", "A.stand");
const IS_WINDOWS = process.platform === "win32";

const RUNTIME_FILES = ["daemon.mjs", "desktop.html", "stdio-bridge.mjs", "wait-job.mjs"];
const RULES_FILE = path.join(ROOT, "plugin", "rules", "AGENTS.md");

function log(message) {
  console.log(`[package-desktop] ${message}`);
}

function fail(message) {
  console.error(`[package-desktop] ERROR ${message}`);
  process.exit(1);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Run a command inheriting stdio; returns its exit code. */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    cwd: options.cwd || ROOT,
    env: options.env || process.env,
    shell: options.shell === true,
    windowsHide: true,
  });
  if (result.error) {
    return { code: -1, error: result.error.message };
  }
  return { code: result.status ?? -1, error: "" };
}

/**
 * npm is a `.cmd` shim on Windows and Node 20+ refuses to spawn shims without a
 * shell. Prefer the real `npm-cli.js` next to the running node binary so no shell
 * and no unescaped argument concatenation is involved; fall back to `npm.cmd`.
 */
function npmInvocation() {
  if (!IS_WINDOWS) return { command: "npm", args: ["run", "build"], shell: false };
  const cli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (fs.existsSync(cli)) {
    return { command: process.execPath, args: [cli, "run", "build"], shell: false };
  }
  return { command: "npm.cmd", args: ["run", "build"], shell: true };
}

/** Candidate cargo executables: env override, PATH, then the rustup default location. */
function cargoCandidates() {
  const names = IS_WINDOWS ? ["cargo.exe", "cargo"] : ["cargo"];
  const candidates = [];
  const explicit = (process.env.CARGO || "").trim();
  if (explicit) candidates.push({ command: explicit, env: process.env });
  const cargoBin = path.join(os.homedir(), ".cargo", "bin");
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") || "PATH";
  const currentPath = process.env[pathKey] || "";
  const prefixedPath = `${cargoBin}${path.delimiter}${currentPath}`;
  const rustcBin = path.join(cargoBin, IS_WINDOWS ? "rustc.exe" : "rustc");
  const envWithCargo = {
    ...process.env,
    [pathKey]: prefixedPath,
    ...(fs.existsSync(rustcBin) && !process.env.RUSTC ? { RUSTC: rustcBin } : {}),
  };
  for (const name of names) candidates.push({ command: name, env: envWithCargo });
  for (const name of names) candidates.push({ command: path.join(cargoBin, name), env: envWithCargo });
  return candidates;
}

function resolveCargo() {
  const tried = [];
  for (const candidate of cargoCandidates()) {
    const probe = spawnSync(candidate.command, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: candidate.env,
      encoding: "utf8",
    });
    if (!probe.error && probe.status === 0) {
      const version = (probe.stdout || "").trim();
      log(`cargo: ${candidate.command} (${version || "version unknown"})`);
      return candidate;
    }
    tried.push(`${candidate.command}${probe.error ? ` (${probe.error.message})` : ` (exit ${probe.status})`}`);
  }
  fail(
    "cargo not found. Install Rust from https://rustup.rs and re-run.\n" +
      `Tried:\n  - ${tried.join("\n  - ")}`
  );
  return null;
}

function assertFiles(files, label) {
  const missing = files.filter((file) => !fs.existsSync(file));
  if (missing.length) {
    fail(`${label} missing:\n  - ${missing.map((file) => path.relative(ROOT, file)).join("\n  - ")}`);
  }
}

function main() {
  const startedAt = Date.now();
  const cargo = resolveCargo();

  // 1. Node bundles -----------------------------------------------------------
  log("building Node bundles (npm run build)");
  const npm = npmInvocation();
  const build = run(npm.command, npm.args, { shell: npm.shell });
  if (build.code !== 0) fail(`npm run build failed (exit ${build.code}${build.error ? `: ${build.error}` : ""})`);
  const bundlePaths = RUNTIME_FILES.map((name) => path.join(DIST, name));
  assertFiles(bundlePaths, "dist bundles");
  assertFiles([RULES_FILE], "rules file");

  // 2. Tauri release binary ---------------------------------------------------
  // On Windows, compiling build scripts inside Desktop/Documents can be blocked by
  // Controlled Folder Access; default CARGO_TARGET_DIR to %TEMP%\astand-tauri-target.
  const targetDir =
    (process.env.CARGO_TARGET_DIR || "").trim() ||
    (IS_WINDOWS ? path.join(os.tmpdir(), "astand-tauri-target") : path.join(TAURI_DIR, "target"));
  const cargoEnv = { ...cargo.env, CARGO_TARGET_DIR: targetDir };
  log(`building Tauri release binary (cargo build --release, target=${targetDir})`);
  const cargoBuild = run(
    cargo.command,
    ["build", "--release", "--manifest-path", path.join("desktop", "src-tauri", "Cargo.toml")],
    { env: cargoEnv }
  );
  if (cargoBuild.code !== 0) {
    fail(`cargo build --release failed (exit ${cargoBuild.code}${cargoBuild.error ? `: ${cargoBuild.error}` : ""})`);
  }
  const exeName = IS_WINDOWS ? "a-stand.exe" : "a-stand";
  const builtExe = path.join(targetDir, "release", exeName);
  assertFiles([builtExe], "Tauri binary");

  // 3. Portable folder --------------------------------------------------------
  log(`assembling ${path.relative(ROOT, OUT_DIR)}`);
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  fs.copyFileSync(builtExe, path.join(OUT_DIR, exeName));
  for (const name of RUNTIME_FILES) {
    fs.copyFileSync(path.join(DIST, name), path.join(OUT_DIR, name));
  }
  const rulesTarget = path.join(OUT_DIR, "plugin", "rules", "AGENTS.md");
  fs.mkdirSync(path.dirname(rulesTarget), { recursive: true });
  fs.copyFileSync(RULES_FILE, rulesTarget);
  // `daemon.mjs` derives its rulesFile as `<daemon dir>/../plugin/rules/AGENTS.md`
  // (see src/daemon/index.mjs), so a portable layout also needs the sibling copy one
  // level above A.stand/ for the delegation rules to resolve. The in-folder copy keeps
  // the bundle self-contained and lets it degrade gracefully once the folder is moved.
  const siblingRules = path.join(OUT_DIR, "..", "plugin", "rules", "AGENTS.md");
  fs.mkdirSync(path.dirname(siblingRules), { recursive: true });
  fs.copyFileSync(RULES_FILE, siblingRules);

  // 4. Report -----------------------------------------------------------------
  const exeSize = fs.statSync(path.join(OUT_DIR, exeName)).size;
  let folderBytes = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else folderBytes += fs.statSync(full).size;
    }
  };
  walk(OUT_DIR);

  const shipped = ["a-stand.exe", ...RUNTIME_FILES, "plugin/rules/AGENTS.md", "../plugin/rules/AGENTS.md"];
  log(`portable files: ${shipped.join(", ")}`);
  log(`${exeName}: ${formatBytes(exeSize)}`);
  log(`portable folder: ${formatBytes(folderBytes)} total`);
  log(`output: ${OUT_DIR}`);
  log(`done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

main();
