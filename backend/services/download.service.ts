import {
  mkdtemp,
  readdir,
  stat,
  rm,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { analyze } from "./videoAnalyzer.service";
import { run, ytdlp, common, publicError } from "./process";
import { translateSrt } from "./translation.service";
export type Job = {
  id: string;
  status: "processing" | "ready" | "error";
  stage: string;
  progress?: number;
  file?: string;
  name?: string;
  directory?: string;
  error?: string;
  created: number;
};
export const jobs = new Map<string, Job>();
let active = 0;
export function safeName(s: string) {
  return (
    s
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
      .replace(/^\.+/, "")
      .trim()
      .slice(0, 140) || "video"
  );
}
export async function createJob(kind: string, body: any) {
  if (active >= 3) throw new Error("BUSY");
  active++;
  const job: Job = {
    id: randomUUID(),
    status: "processing",
    stage: "Préparation du téléchargement…",
    created: Date.now(),
  };
  jobs.set(job.id, job);
  void (async () => {
    try {
      const data = await analyze(body.videoUrl);
      const dir = await mkdtemp(join(tmpdir(), "nova-"));
      job.directory = dir;
      let args = [
        ...common(),
        "--newline",
        "--max-filesize",
        "2G",
        "--match-filter",
        "duration <= 7200",
        "-o",
        join(dir, "media.%(ext)s"),
      ];
      let ext = "mp4",
        suffix = "";
      if (kind === "video") {
        const f = data.formats.find((f) => f.id === body.formatId);
        if (!f) throw new Error("FORMAT_UNAVAILABLE");
        if (!f.hasAudio && !f.audioFormatId) throw new Error("NO_AUDIO");
        if (f.size && f.size > 4 * 1024 ** 3) throw new Error("SIZE_LIMIT");
        ext = f.ext === "mp4" ? "mp4" : "mkv";
        args.push(
          "-f",
          f.hasAudio ? f.id : `${f.id}+${f.audioFormatId}`,
          "--merge-output-format",
          ext,
        );
        suffix = ` - ${f.height}p`;
      } else if (kind === "audio") {
        if (!["0", "320", "256", "192", "128"].includes(String(body.bitrate)))
          throw new Error("INVALID_BITRATE");
        ext = "mp3";
        suffix = " - Audio";
        job.stage = "Extraction de l’audio…";
        args.push(
          "-f",
          "bestaudio",
          "-x",
          "--audio-format",
          "mp3",
          "--audio-quality",
          String(body.bitrate) === "0" ? "0" : `${body.bitrate}K`,
          "--embed-metadata",
          "--embed-thumbnail",
          "--convert-thumbnails",
          "jpg",
        );
      } else {
        const track = data.subtitles.find((t) => t.id === body.language);
        if (!track) throw new Error("SUBTITLE_UNAVAILABLE");
        ext = "srt";
        suffix = ` - ${body.targetLanguage || track.language}`;
        job.stage = "Récupération des sous-titres…";
        args.push(
          "--skip-download",
          track.automatic ? "--write-auto-subs" : "--write-subs",
          "--sub-langs",
          track.language,
          "--sub-format",
          "srt/vtt/best",
          "--convert-subs",
          "srt",
        );
      }
      await run(
        ytdlp(),
        [...args, "--", data.video.url],
        (line) => {
          const progress = line.match(/\[download\]\s+([\d.]+)%/);
          if (progress) job.progress = Number(progress[1]);
          if (line.includes("[Merger]")) {
            job.stage = "Assemblage de la vidéo et de l’audio…";
            job.progress = undefined;
          }
          if (line.includes("[ExtractAudio]")) {
            job.stage = "Conversion en MP3…";
            job.progress = undefined;
          }
        },
        600000,
      );
      const files = await readdir(dir);
      const file = files.find((f) => f.endsWith(`.${ext}`));
      if (!file) throw new Error("FILE_MISSING");
      job.file = join(dir, file);
      if ((await stat(job.file)).size > 4 * 1024 ** 3)
        throw new Error("SIZE_LIMIT");
      if (kind === "subtitles" && body.targetLanguage) {
        job.stage = "Traduction des sous-titres…";
        const track = data.subtitles.find((t) => t.id === body.language)!;
        await writeFile(
          job.file,
          await translateSrt(
            await readFile(job.file, "utf8"),
            track.language,
            body.targetLanguage,
          ),
          "utf8",
        );
      }
      job.name = `${safeName(data.video.title)}${suffix}.${ext}`;
      job.stage = "Votre fichier est prêt.";
      job.status = "ready";
      job.progress = 100;
    } catch (e) {
      console.error("Download job", job.id, e);
      job.status = "error";
      job.error = publicError(e);
      if (job.directory)
        await rm(job.directory, { recursive: true, force: true });
    } finally {
      active--;
    }
  })();
  return job;
}
export async function cleanupJob(job: Job) {
  jobs.delete(job.id);
  if (job.directory) await rm(job.directory, { recursive: true, force: true });
}
setInterval(() => {
  for (const job of jobs.values())
    if (Date.now() - job.created > 15 * 60000 && job.status !== "processing")
      void cleanupJob(job);
}, 60000).unref();
