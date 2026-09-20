import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const baseUrl = () =>
  (process.env.YT_DLP_POT_BASE_URL || "http://127.0.0.1:4416").replace(
    /\/$/,
    "",
  );

async function ping(timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl()}/ping`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Ensure bgutil PO Token HTTP server is reachable.
 * Without it, YouTube often returns only progressive 360p for many videos.
 */
export async function ensurePotServer(): Promise<boolean> {
  if (process.env.YT_DLP_POT_DISABLE === "1") return false;
  if (await ping()) {
    console.log("[pot] PO Token server already running");
    return true;
  }

  const mainJs = join(
    process.cwd(),
    ".tools/bgutil-ytdlp-pot-provider/server/build/main.js",
  );
  if (!existsSync(mainJs)) {
    console.warn(
      "[pot] Missing .tools/bgutil-ytdlp-pot-provider — some videos may only show 360p",
    );
    return false;
  }

  console.log("[pot] Starting PO Token server…");
  const child = spawn(process.execPath, [mainJs], {
    cwd: dirname(mainJs),
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await ping()) {
      console.log("[pot] PO Token server ready on", baseUrl());
      return true;
    }
  }

  console.warn(
    "[pot] Could not reach PO Token server — multi-quality may be limited",
  );
  return false;
}
