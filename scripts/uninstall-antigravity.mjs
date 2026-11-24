import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TARGET_DIR = path.join(os.homedir(), ".gemini", "config", "plugins", "agent-relay");

if (fs.existsSync(TARGET_DIR)) {
  fs.rmSync(TARGET_DIR, { recursive: true, force: true });
  console.log(`Removed plugin directory: ${TARGET_DIR}`);
} else {
  console.log(`Plugin directory not found: ${TARGET_DIR}`);
}
