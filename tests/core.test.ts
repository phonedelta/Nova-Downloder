import { test } from "node:test";
import assert from "node:assert/strict";
import { youtubeUrl } from "../src/utils/format";
import { safeName } from "../backend/services/download.service";
import {
  parseSrt,
  translateSrt,
} from "../backend/services/translation.service";
test("canonicalise les liens YouTube et refuse les destinations non autorisées", () => {
  for (const url of [
    "https://youtu.be/dQw4w9WgXcQ",
    "https://youtube.com/shorts/dQw4w9WgXcQ",
    "https://youtube.com/live/dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=abc",
  ])
    assert.equal(
      youtubeUrl(url),
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
  for (const url of [
    "http://127.0.0.1",
    "https://youtube.com.evil.org/watch?v=dQw4w9WgXcQ",
    "https://evil@youtube.com/watch?v=dQw4w9WgXcQ",
    "file:///etc/passwd",
    "https://youtube.com:123/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/abc",
    "https://youtube.com/redirect?q=http://localhost",
  ])
    assert.equal(youtubeUrl(url), null);
});
test("noms de fichiers sûrs", () => {
  assert.equal(
    safeName("Amazing Music / Relax & Sleep?"),
    "Amazing Music - Relax & Sleep-",
  );
  assert.ok(!safeName("../../file").includes("/"));
});
test("SRT : arabe UTF-8 et timecodes inchangés lors de la traduction", async () => {
  const srt =
    "1\n00:00:01,000 --> 00:00:04,000\nHello world.\n\n2\n00:00:04,500 --> 00:00:08,000\nWelcome.\n";
  const fetchOriginal = globalThis.fetch;
  process.env.TRANSLATE_URL = "https://translate.example.test";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ translatedText: ["مرحبًا بالعالم.", "أهلًا وسهلًا."] }),
      { status: 200 },
    );
  try {
    const result = await translateSrt(srt, "en", "ar");
    const blocks = parseSrt(result);
    assert.equal(blocks[0].text, "مرحبًا بالعالم.");
    assert.deepEqual(
      blocks.map((b) => b.time),
      parseSrt(srt).map((b) => b.time),
    );
    assert.equal(Buffer.from(result, "utf8").toString("utf8"), result);
  } finally {
    globalThis.fetch = fetchOriginal;
    delete process.env.TRANSLATE_URL;
  }
});
test("rejette des sous-titres mal formés", () => {
  assert.throws(() => parseSrt("1\nbad timecode\nHello"));
});
test("traduction FR / EN / AR / TR préserve les blocs", async () => {
  const originalFetch = globalThis.fetch;
  process.env.TRANSLATE_URL = "https://translate.example.test";
  const fixture = "1\n00:00:01,000 --> 00:00:02,000\nA full sentence.\n";
  try {
    for (const language of ["fr", "en", "ar", "tr"]) {
      globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.target, language);
        assert.deepEqual(body.q, ["A full sentence."]);
        return new Response(
          JSON.stringify({
            translatedText: [
              {
                fr: "Une phrase complète.",
                en: "A full sentence.",
                ar: "جملة كاملة.",
                tr: "Tam bir cümle.",
              }[language],
            ],
          }),
        );
      };
      const result = await translateSrt(fixture, "en", language);
      assert.equal(parseSrt(result)[0].time, "00:00:01,000 --> 00:00:02,000");
    }
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TRANSLATE_URL;
  }
});
test("supprime le dossier et le job après nettoyage", async () => {
  const { mkdtemp, writeFile, access } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { jobs, cleanupJob } =
    await import("../backend/services/download.service");
  const directory = await mkdtemp(join(tmpdir(), "nova-test-"));
  await writeFile(join(directory, "media.mp4"), "fixture");
  const job = {
    id: "test-cleanup",
    directory,
    status: "ready" as const,
    stage: "ready",
    created: Date.now(),
  };
  jobs.set(job.id, job);
  await cleanupJob(job);
  assert.equal(jobs.has(job.id), false);
  await assert.rejects(access(directory));
});
