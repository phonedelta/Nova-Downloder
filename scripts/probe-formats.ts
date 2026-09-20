import "dotenv/config";
import { run, ytdlp, common } from "../backend/services/process";

const url = "https://www.youtube.com/watch?v=vWl96B8D1RA";
const clients = [
  "ios,android,android_vr,tv,web_safari",
  "ios",
  "android",
  "tv",
  "mweb",
  "web",
  "android_vr",
  "web_embedded",
];

for (const c of clients) {
  const args = common().filter(
    (a, i, arr) => a !== "--extractor-args" && arr[i - 1] !== "--extractor-args",
  );
  args.push("--extractor-args", `youtube:player_client=${c}`);
  try {
    const raw = JSON.parse(
      await run(
        ytdlp(),
        [...args, "--dump-single-json", "--skip-download", "--", url],
        undefined,
        180000,
      ),
    );
    const fmts = (raw.formats || []).filter(
      (f: { vcodec?: string; height?: number }) =>
        f.vcodec && f.vcodec !== "none" && f.height,
    );
    const heights = [
      ...new Set(fmts.map((f: { height: number }) => f.height)),
    ].sort((a, b) => b - a);
    const hi = fmts
      .filter((f: { height: number }) => f.height >= 720)
      .slice(0, 8)
      .map(
        (f: { format_id: string; height: number; ext: string; protocol?: string }) =>
          `${f.format_id}@${f.height}p/${f.ext}/${f.protocol || "?"}`,
      );
    console.log(c, "→", heights.length, "heights", heights, "hi", hi);
  } catch (e) {
    console.log(c, "→ ERROR", String(e).slice(0, 220).replace(/\n/g, " "));
  }
}
