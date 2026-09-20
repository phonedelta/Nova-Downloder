import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { ffmpegBin } from "./process";

export type AudioFileMeta = {
  title: string;
  /** Channel / interpreter name (YouTube uploader). */
  artist: string;
  album?: string;
  comment?: string;
  thumbnailUrl?: string;
};

function killTree(child: ReturnType<typeof spawn> | null | undefined) {
  if (!child || child.killed) return;
  try {
    child.kill("SIGKILL");
  } catch {
    /* */
  }
}

function sanitizeMetaValue(value: string, max = 200): string {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\r?\n/g, " ")
    .trim()
    .slice(0, max);
}

/** Escape a value for an ffmetadata file. */
function ffEscape(value: string): string {
  return sanitizeMetaValue(value).replace(/\\/g, "\\\\").replace(/=/g, "\\=");
}

async function downloadThumbnail(
  url: string,
  destPath: string,
): Promise<boolean> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
      headers: {
        "User-Agent":
          process.env.YT_DLP_USER_AGENT ||
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "image/*,*/*",
      },
    });
    if (!res.ok || !res.body) return false;
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct && !ct.startsWith("image/") && !ct.includes("octet-stream")) {
      return false;
    }
    await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(destPath));
    const buf = await readFile(destPath);
    return buf.length > 256;
  } catch {
    try {
      await rm(destPath, { force: true });
    } catch {
      /* */
    }
    return false;
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin(), args, {
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env },
    });
    let err = "";
    child.stderr?.on("data", (b: Buffer) => {
      err = (err + b.toString()).slice(-6000);
    });
    const timer = setTimeout(() => {
      killTree(child);
      reject(new Error("PROCESS_TIMEOUT"));
    }, 120_000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(err || `FFMPEG_META_FAILED:${code}`));
    });
  });
}

/**
 * Embed ID3v2 tags + optional cover art into an MP3 (in place).
 * title, artist (channel), album_artist, album, comment, attached picture.
 */
export async function embedMp3Metadata(
  mp3Path: string,
  meta: AudioFileMeta,
): Promise<void> {
  const title = sanitizeMetaValue(meta.title) || "audio";
  const artist = sanitizeMetaValue(meta.artist) || "Unknown Artist";
  const album = sanitizeMetaValue(meta.album || title) || title;
  const comment = sanitizeMetaValue(meta.comment || "", 300);

  const work = await mkdtemp(join(tmpdir(), "nova-id3-"));
  const metaFile = join(work, "ffmeta.txt");
  const coverPath = join(work, "cover.jpg");
  const outPath = join(work, "tagged.mp3");

  try {
    const lines = [
      ";FFMETADATA1",
      `title=${ffEscape(title)}`,
      `artist=${ffEscape(artist)}`,
      `album_artist=${ffEscape(artist)}`,
      `album=${ffEscape(album)}`,
      `composer=${ffEscape(artist)}`,
    ];
    if (comment) lines.push(`comment=${ffEscape(comment)}`);
    await writeFile(metaFile, `${lines.join("\n")}\n`, "utf8");

    let hasCover = false;
    if (meta.thumbnailUrl) {
      hasCover = await downloadThumbnail(meta.thumbnailUrl, coverPath);
    }

    if (hasCover) {
      await runFfmpeg([
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        mp3Path,
        "-i",
        coverPath,
        "-i",
        metaFile,
        "-map",
        "0:a",
        "-map",
        "1",
        "-map_metadata",
        "2",
        "-c",
        "copy",
        "-c:v",
        "mjpeg",
        "-disposition:v:0",
        "attached_pic",
        "-id3v2_version",
        "3",
        "-write_id3v1",
        "1",
        "-y",
        outPath,
      ]);
    } else {
      await runFfmpeg([
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        mp3Path,
        "-i",
        metaFile,
        "-map",
        "0:a",
        "-map_metadata",
        "1",
        "-c",
        "copy",
        "-id3v2_version",
        "3",
        "-write_id3v1",
        "1",
        "-y",
        outPath,
      ]);
    }

    await rename(outPath, mp3Path);
  } finally {
    void rm(work, { recursive: true, force: true });
  }
}
