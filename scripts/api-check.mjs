const base = "http://127.0.0.1:3001";
for (const [path, body, status] of [
  ["/api/health", null, 200],
  ["/api/analyze", { url: "http://127.0.0.1" }, 400],
  ["/api/download/video", { videoUrl: "https://evil.example" }, 400],
  ["/api/download/audio", { videoUrl: "file:///etc/passwd" }, 400],
  ["/api/subtitles", { videoUrl: "not-a-url" }, 400],
  ["/api/jobs/missing", null, 404],
  [
    "/api/subtitles/translate",
    { subtitleData: "bad", sourceLanguage: "en", targetLanguage: "fr" },
    422,
  ],
]) {
  const r = await fetch(
    base + path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  if (r.status !== status) throw Error(`${path}: ${r.status}`);
  console.log(path, r.status, await r.text());
}
