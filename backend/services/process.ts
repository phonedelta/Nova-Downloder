import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export function run(
  command: string,
  args: string[],
  onLine?: (s: string) => void,
  timeout = 120000,
  hooks?: { onStart?: (kill: () => void) => void },
) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      env: { ...process.env },
      detached: process.platform !== "win32",
    });
    let out = "",
      err = "";
    const stop = () => {
      try {
        if (process.platform !== "win32" && child.pid)
          process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {}
    };
    hooks?.onStart?.(stop);
    const timer = setTimeout(() => {
      stop();
      reject(new Error("PROCESS_TIMEOUT"));
    }, timeout);
    child.stdout.on("data", (b) => {
      out += b.toString();
      onLine?.(b.toString());
      if (out.length > 20_000_000) stop();
    });
    child.stderr.on("data", (b) => {
      err = (err + b.toString()).slice(-12000);
      onLine?.(b.toString());
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(out) : reject(new Error(err || "PROCESS_FAILED"));
    });
  });
}

export const ytdlp = () => {
  const configured = process.env.YT_DLP_PATH || "yt-dlp";
  // Standalone binary cannot load POT plugins → often only 360p.
  // Prefer the Python wrapper when it exists next to the project tools.
  const python = join(process.cwd(), ".tools/bin/yt-dlp-python");
  if (
    existsSync(python) &&
    (/yt-dlp_macos|yt-dlp\.exe$/i.test(configured) ||
      process.env.YT_DLP_FORCE_PYTHON === "1")
  ) {
    return python;
  }
  return configured;
};

export function ffmpegBin() {
  const configured = process.env.FFMPEG_PATH || "ffmpeg";
  if (
    configured === "ffmpeg" ||
    configured.endsWith("ffmpeg") ||
    configured.endsWith("ffmpeg.exe")
  )
    return configured;
  const candidate = join(
    configured,
    process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
  );
  return existsSync(candidate) ? candidate : configured;
}

/** Resolve `node` for yt-dlp JS challenge solver (nsig / mweb HD). */
function jsRuntimesArg(): string {
  const configured = process.env.YT_DLP_JS_RUNTIMES?.trim();
  if (configured && configured !== "node") return configured;
  const fromEnv = process.env.NODE_BINARY?.trim();
  if (fromEnv && existsSync(fromEnv)) return `node:${fromEnv}`;
  // process.execPath is the Node running Nova API — always valid
  if (process.execPath && existsSync(process.execPath)) {
    return `node:${process.execPath}`;
  }
  return "node";
}

/**
 * Shared yt-dlp flags for metadata / format listing.
 * Cookies are optional — broken/empty cookie DBs (e.g. Firefox v17) cause
 * YouTube to skip android clients and return SABR URLs that 403 on download.
 */
export const common = () => {
  const args = [
    "--ignore-config",
    "--no-playlist",
    "--no-warnings",
    "--socket-timeout",
    "20",
    "--retries",
    "5",
    "--fragment-retries",
    "5",
    "--ffmpeg-location",
    ffmpegBin(),
    // Required for mweb/web nsig challenges (HD formats).
    "--js-runtimes",
    jsRuntimesArg(),
    "--extractor-args",
    process.env.YT_DLP_EXTRACTOR_ARGS ||
      "youtube:player_client=mweb,tv,android,ios",
  ];

  // Optional second extractor-args for the PO Token HTTP provider
  const potArgs =
    process.env.YT_DLP_POT_EXTRACTOR_ARGS?.trim() ||
    (process.env.YT_DLP_POT_BASE_URL
      ? `youtubepot-bgutilhttp:base_url=${process.env.YT_DLP_POT_BASE_URL.replace(/\/$/, "")}`
      : "");
  if (potArgs) {
    args.push("--extractor-args", potArgs);
  }

  // Only attach cookies when explicitly enabled AND a source is set.
  // Empty Firefox extractions cookies break media downloads (HTTP 403).
  const useCookies = process.env.YT_DLP_USE_COOKIES === "1";
  const cookiesFile = process.env.YT_DLP_COOKIES?.trim();
  const cookiesBrowser = process.env.YT_DLP_COOKIES_FROM_BROWSER?.trim();

  if (useCookies && cookiesFile) {
    args.push("--cookies", cookiesFile);
  } else if (useCookies && cookiesBrowser) {
    args.push("--cookies-from-browser", cookiesBrowser);
  }

  return args;
};

/**
 * Flags for actual media download / stream.
 * Prefer mweb (GVS PO via bgutil) — android/ios are often SABR-only now.
 * Preserve non-youtube extractor-args (e.g. youtubepot-bgutilhttp base_url).
 */
export const commonDownload = () => {
  const args = common();
  const downloadClients =
    process.env.YT_DLP_DOWNLOAD_EXTRACTOR_ARGS ||
    "youtube:player_client=mweb,tv";
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--extractor-args") {
      const value = args[i + 1] || "";
      i++;
      if (value.startsWith("youtube:")) {
        out.push("--extractor-args", downloadClients);
      } else if (value) {
        // Keep POT provider / other extractor args intact
        out.push("--extractor-args", value);
      }
      continue;
    }
    out.push(args[i]!);
  }
  return out;
};

export function publicError(e: unknown) {
  const s = String(e);
  if (/SUBTITLE_UNAVAILABLE/.test(s)) return "Aucun sous-titre disponible.";
  if (/FORMAT_UNAVAILABLE/.test(s))
    return "Ce format n’est plus disponible. Veuillez analyser la vidéo à nouveau.";
  if (/TRANSLATION_/.test(s))
    return "La traduction est momentanément indisponible.";
  if (/NO_AUDIO/.test(s))
    return "Aucune piste audio n’est disponible pour cette vidéo.";
  if (/SIZE_LIMIT/.test(s)) return "Ce fichier dépasse la limite de 4 Go.";
  if (/EMPTY_DOWNLOAD_RESPONSE|FIRST_BYTE_TIMEOUT/i.test(s))
    return "Le téléchargement n’a produit aucune donnée. Réessayez.";
  if (/BUSY/.test(s))
    return "Le serveur est occupé. Veuillez réessayer dans un instant.";
  if (/ENOENT/.test(s))
    return "Le moteur de téléchargement est indisponible. Veuillez réessayer plus tard.";
  if (/private/i.test(s)) return "Cette vidéo est privée.";
  if (/confirm.*(you.?re|you are).*not a bot|cookies-from-browser|pass cookies/i.test(s))
    return "YouTube bloque temporairement l’accès (vérification anti-bot). Sur le serveur, configurez YT_DLP_COOKIES_FROM_BROWSER=chrome (ou firefox) dans .env, puis redémarrez NovaDownloader.";
  if (/age.?restrict|sign in to confirm your age|login required/i.test(s))
    return "Cette vidéo présente une restriction d’âge ou nécessite une connexion.";
  if (/sign in/i.test(s))
    return "Cette vidéo nécessite une authentification ou présente une restriction d’accès.";
  if (/country|geo/i.test(s))
    return "Cette vidéo n’est pas disponible dans la région du serveur.";
  if (/removed|unavailable|not available/i.test(s))
    return "Cette vidéo a été supprimée ou n’est plus disponible.";
  if (/TIMEOUT/.test(s))
    return "Le traitement a pris trop de temps. Veuillez réessayer.";
  return "Impossible de traiter cette vidéo pour le moment. Veuillez réessayer.";
}
