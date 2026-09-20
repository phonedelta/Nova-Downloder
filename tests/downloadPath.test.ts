import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getDownloadPath,
  sanitizeFilename,
} from "../packages/shared/src/format.ts";

test("sanitizeFilename garde unicode et extension", () => {
  assert.equal(
    sanitizeFilename("شنو مجرم؟ | Episode 10.mp4"),
    "شنو مجرم؟ - Episode 10.mp4",
  );
  assert.equal(sanitizeFilename("Café été.mp3"), "Café été.mp3");
  assert.equal(sanitizeFilename("Yılmaz - Şarkı.mp3"), "Yılmaz - Şarkı.mp3");
  // Only the last path segment is kept (no absolute/relative path injection).
  assert.equal(sanitizeFilename("a/b\\c:d*.mp4"), "c-d-.mp4");
});

test("getDownloadPath organise Vedio / Music / Sous-titre", () => {
  assert.equal(
    getDownloadPath("video", "Title - 1080p.mp4"),
    "Nova Downloader/Vedio/Title - 1080p.mp4",
  );
  assert.equal(
    getDownloadPath("audio", "Song.mp3"),
    "Nova Downloader/Music/Song.mp3",
  );
  assert.equal(
    getDownloadPath("subtitles", "Title - fr.srt"),
    "Nova Downloader/Sous-titre/Title - fr.srt",
  );
});

test("getDownloadPath ignore les chemins absolus injectés", () => {
  assert.equal(
    getDownloadPath("video", "/Users/x/Downloads/evil.mp4"),
    "Nova Downloader/Vedio/evil.mp4",
  );
});
