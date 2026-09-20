import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const ffmpeg = resolve(".tools/bin/ffmpeg"),
  ffprobe = resolve(".tools/bin/ffprobe");
const directory = mkdtempSync(join(tmpdir(), "nova-media-test-"));
const run = (args) =>
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    stdio: "pipe",
  });
const probe = (file) =>
  JSON.parse(
    execFileSync(
      ffprobe,
      ["-v", "quiet", "-show_streams", "-show_format", "-of", "json", file],
      { encoding: "utf8" },
    ),
  );
try {
  const video = join(directory, "video.mp4"),
    audio = join(directory, "audio.m4a"),
    merged = join(directory, "merged.mp4"),
    cover = join(directory, "cover.jpg"),
    mp3 = join(directory, "audio.mp3");
  run([
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=320x180:d=1",
    "-an",
    "-c:v",
    "libx264",
    video,
  ]);
  run([
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    "-c:a",
    "aac",
    audio,
  ]);
  run(["-i", video, "-i", audio, "-c", "copy", merged]);
  assert.deepEqual(
    probe(merged)
      .streams.map((s) => s.codec_type)
      .sort(),
    ["audio", "video"],
  );
  console.log("Fusion vidéo + audio : OK");
  run([
    "-f",
    "lavfi",
    "-i",
    "color=c=purple:s=300x300",
    "-frames:v",
    "1",
    cover,
  ]);
  run([
    "-i",
    merged,
    "-i",
    cover,
    "-map",
    "0:a:0",
    "-map",
    "1:v:0",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "192k",
    "-c:v",
    "mjpeg",
    "-id3v2_version",
    "3",
    "-metadata",
    "title=Nova test",
    "-metadata",
    "artist=NovaDownloader",
    "-metadata:s:v",
    "title=Album cover",
    "-metadata:s:v",
    "comment=Cover (front)",
    "-disposition:v",
    "attached_pic",
    mp3,
  ]);
  const result = probe(mp3);
  assert.equal(result.format.tags.title, "Nova test");
  assert.ok(result.streams.some((s) => s.codec_name === "mp3"));
  assert.ok(result.streams.some((s) => s.disposition.attached_pic === 1));
  console.log("MP3, métadonnées ID3 et cover : OK");
} finally {
  rmSync(directory, { recursive: true, force: true });
  console.log("Nettoyage des fichiers de test : OK");
}
