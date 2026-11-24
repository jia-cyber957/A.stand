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
