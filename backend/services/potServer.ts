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

export function isPotServerReachable(timeoutMs = 1200): Promise<boolean> {
  if (process.env.YT_DLP_POT_DISABLE === "1") return Promise.resolve(false);
  return ping(timeoutMs);
}

function potMainJs(): string | null {
  const candidates = [
    "/opt/bgutil-ytdlp-pot-provider/server/build/main.js",
    join(process.cwd(), ".tools/bgutil-ytdlp-pot-provider/server/build/main.js"),
    join(process.cwd(), "bgutil-ytdlp-pot-provider/server/build/main.js"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return null;
}

function potNodeBinary(mainJs: string): string {
  const configured = process.env.YT_DLP_POT_NODE?.trim();
  if (configured && existsSync(configured)) return configured;
  // Prefer bundled Node next to /opt pot server (matches canvas ABI)
  if (mainJs.startsWith("/opt/")) {
    const bundled = "/opt/bgutil-node/bin/node";
    if (existsSync(bundled)) return bundled;
  }
  return process.execPath;
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

  const mainJs = potMainJs();
  if (!mainJs) {
    console.warn(
      "[pot] Missing bgutil-ytdlp-pot-provider — some videos may only show 360p",
    );
    return false;
  }

  const nodeBin = potNodeBinary(mainJs);
  console.log("[pot] Starting PO Token server…", { mainJs, nodeBin });
  const child = spawn(nodeBin, [mainJs, "--host", "127.0.0.1"], {
    cwd: dirname(mainJs),
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      // Ensure dynamic linker finds libs from the bundled Node image
      LD_LIBRARY_PATH: [
        "/opt/bgutil-node/lib",
        process.env.LD_LIBRARY_PATH || "",
      ]
        .filter(Boolean)
        .join(":"),
    },
  });
  child.on("error", (err) => {
    console.warn("[pot] Failed to spawn PO Token server:", err.message);
  });
  child.unref();

  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 300));
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
