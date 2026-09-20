export function parseSrt(input: string) {
  const blocks = input
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n\s*\n/);
  return blocks.map((block) => {
    const lines = block.split("\n");
    if (
      !/^\d+$/.test(lines[0]) ||
      !/^\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}$/.test(lines[1]) ||
      lines.length < 3
    )
      throw new Error("INVALID_SRT");
    return { index: lines[0], time: lines[1], text: lines.slice(2).join("\n") };
  });
}
export async function translateSrt(
  input: string,
  source: string,
  target: string,
) {
  if (!process.env.TRANSLATE_URL) throw new Error("TRANSLATION_UNAVAILABLE");
  if (
    !["fr", "en", "ar", "tr"].includes(target) ||
    !/^[\w-]{2,20}$/.test(source)
  )
    throw new Error("INVALID_LANGUAGE");
  const blocks = parseSrt(input);
  for (let i = 0; i < blocks.length; i += 30) {
    const batch = blocks.slice(i, i + 30);
    const response = await fetch(process.env.TRANSLATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: batch.map((b) => b.text),
        source: source.split("-")[0],
        target,
        format: "text",
        api_key: process.env.TRANSLATE_API_KEY,
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error("TRANSLATION_FAILED");
    const result = (await response.json()) as { translatedText: string[] };
    if (
      !Array.isArray(result.translatedText) ||
      result.translatedText.length !== batch.length
    )
      throw new Error("TRANSLATION_FAILED");
    batch.forEach((b, j) => {
      b.text = result.translatedText[j].replace(/\n\s*\n/g, "\n");
    });
  }
  return (
    blocks.map((b) => `${b.index}\n${b.time}\n${b.text}`).join("\n\n") + "\n"
  );
}
