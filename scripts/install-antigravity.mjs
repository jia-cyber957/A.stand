import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PLUGIN_NAME = "agent-relay";
const TARGET_DIR = path.join(os.homedir(), ".gemini", "config", "plugins", PLUGIN_NAME);

// 1. Always rebuild fresh bundle
console.log("Building A.stand...");
execFileSync(process.execPath, [path.join(ROOT, "scripts", "build.mjs")], {
  cwd: ROOT,
  stdio: "inherit",
});

// 2. Copy plugin manifest, assets, rules, skills, and dist/ cleanly (never touches $PLUGIN_DATA or any external CLI configs)
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

fs.mkdirSync(TARGET_DIR, { recursive: true });
copyDir(path.join(ROOT, "plugin"), TARGET_DIR);
copyDir(path.join(ROOT, "dist"), path.join(TARGET_DIR, "dist"));

console.log(`\nInstalled A.stand plugin to:\n  ${TARGET_DIR}`);
console.log("Zero external CLI files (e.g. ~/.codex/config.toml) were modified.");
console.log("Antigravity auto-discovers this plugin without a restart.");
