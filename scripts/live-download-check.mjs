import fs from "node:fs/promises";
const base = "http://127.0.0.1:3001";
const a = JSON.parse(await fs.readFile("/tmp/nova-api-analysis.json", "utf8"));
const format = a.formats.filter(
  (f) => f.height === 144 && f.ext === "mp4" && f.codec.startsWith("avc"),
)[0];
if (!format) throw Error("No fixture format");
for (const [kind, body] of [
  ["video", { videoUrl: a.video.url, formatId: format.id }],
  ["audio", { videoUrl: a.video.url, bitrate: "128" }],
]) {
  const response = await fetch(`${base}/api/download/${kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const job = await response.json();
  if (!response.ok) throw Error(JSON.stringify(job));
  let previous = "";
  for (let i = 0; i < 400; i++) {
    const state = await (await fetch(`${base}/api/jobs/${job.id}`)).json();
    if (state.stage !== previous) {
      console.log(kind, state.stage);
      previous = state.stage;
    }
    if (state.status === "error") throw Error(state.error);
    if (state.status === "ready") {
      const file = await fetch(`${base}/api/jobs/${job.id}/file`);
      if (!file.ok) throw Error("No file");
      const bytes = await file.arrayBuffer();
      await fs.writeFile(
        `/tmp/nova-live-${kind}.${kind === "audio" ? "mp3" : "mp4"}`,
        Buffer.from(bytes),
      );
      console.log(kind, bytes.byteLength, "bytes");
      await new Promise((r) => setTimeout(r, 200));
      const gone = await fetch(`${base}/api/jobs/${job.id}`);
      if (gone.status !== 404) throw Error("Job not cleaned");
      console.log(kind, "cleanup: OK");
      break;
    }
    await new Promise((r) => setTimeout(r, 1800));
  }
}
