import "dotenv/config";
import { run, ytdlp, common } from "../backend/services/process";

const url = "https://www.youtube.com/watch?v=vWl96B8D1RA";
const args = [...common(), "--dump-single-json", "--skip-download", "--", url];
console.log("args include cookies:", args.includes("--cookies-from-browser"), args[args.indexOf("--cookies-from-browser") + 1]);
try {
  const raw = JSON.parse(await run(ytdlp(), args, undefined, 180000));
  const fmts = (raw.formats || []).filter(
    (f: { vcodec?: string; height?: number }) =>
      f.vcodec && f.vcodec !== "none" && f.height,
  );
  const heights = [
    ...new Set(fmts.map((f: { height: number }) => f.height)),
  ].sort((a: number, b: number) => b - a);
  console.log("heights", heights, "count", fmts.length);
  for (const f of fmts
    .sort(
      (a: { height: number; fps?: number }, b: { height: number; fps?: number }) =>
        b.height - a.height || (b.fps || 0) - (a.fps || 0),
    )
    .slice(0, 25)) {
    console.log(
      `${f.height}p id=${f.format_id} ${f.ext} fps=${f.fps} v=${f.vcodec} a=${f.acodec} proto=${f.protocol}`,
    );
  }
} catch (e) {
  console.error(String(e).slice(0, 500));
}
