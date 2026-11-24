import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectEngines, resolveCodexBinary } from "../src/core/paths.mjs";
import { CodexEngine } from "../src/engines/codex.mjs";

const REQUIRED_CODEX_METHODS = [
  "initialize",
  "thread/start",
  "thread/resume",
  "thread/fork",
  "thread/compact/start",
  "thread/delete",
  "turn/start",
  "turn/steer",
  "turn/interrupt",
  "review/start",
  "model/list",
];

async function main() {
  console.log("=== A.stand Upstream Engine & Contract Check ===\n");
  const detected = detectEngines(true);
  for (const [id, info] of Object.entries(detected)) {
    console.log(
      `- ${id.padEnd(17)} | status=${info.status.padEnd(15)} | version=${info.version || "N/A"}${info.detectedModel ? ` | default=${info.detectedModel}` : ""}`
    );
  }

  if (detected.codex.installed) {
    console.log("\nChecking Codex app-server protocol schema contract...");
    const bin = resolveCodexBinary();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ar-codex-schema-"));
    try {
      execFileSync(bin.command, ["app-server", "generate-json-schema", "--out", tmpDir], {
        windowsHide: true,
        shell: bin.useShell,
        stdio: "ignore",
      });
      const reqSchema = JSON.parse(fs.readFileSync(path.join(tmpDir, "ClientRequest.json"), "utf8"));
      const methods = new Set((reqSchema.oneOf || []).flatMap((x) => x.properties?.method?.enum || []));
      const missing = REQUIRED_CODEX_METHODS.filter((m) => !methods.has(m));
      if (missing.length > 0) {
        console.error("CONTRACT MISMATCH! Missing Codex methods:", missing);
        process.exitCode = 1;
      } else {
        console.log(`Codex schema contract OK (${REQUIRED_CODEX_METHODS.length}/${REQUIRED_CODEX_METHODS.length} methods present).`);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    const codex = new CodexEngine(() => false);
    try {
      const health = await codex.healthCheck();
      const models = await codex.listModels(true);
      console.log(
        `Codex live handshake OK: version=${health.version}, latency=${health.latencyMs}ms, models=${models.length}`
      );
      if (!Array.isArray(models) || models.length === 0) {
        console.error("CONTRACT MISMATCH! Codex model/list returned 0 models.");
        process.exitCode = 1;
      }
    } finally {
      await codex.shutdown();
    }
  }
}

main().catch((err) => {
  console.error("Contract check failed:", err);
  process.exit(1);
});
