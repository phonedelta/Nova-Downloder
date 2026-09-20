import { chromium } from "@playwright/test";
import fs from "node:fs";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await p.route("**/api/analyze", (r) =>
  r.fulfill({
    json: JSON.parse(fs.readFileSync("/tmp/nova-api-analysis.json", "utf8")),
  }),
);
await p.goto("http://127.0.0.1:5173");
await p
  .getByLabel("Lien YouTube")
  .fill("https://www.youtube.com/watch?v=aqz-KE-bpKQ");
await p.getByRole("button", { name: "Analyser", exact: true }).click();
await p
  .getByRole("heading", {
    name: "Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film",
  })
  .waitFor();
await p.waitForTimeout(400);
console.log(
  "Real metadata display:",
  await p.locator(".format-row").count(),
  "resolutions",
);
for (const width of [320, 375, 390, 430, 768, 1024, 1440, 1920]) {
  await p.setViewportSize({ width, height: 1000 });
  await p.waitForTimeout(150);
  const result = await p.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: innerWidth,
  }));
  if (result.scroll > width) {
    console.log(
      await p.evaluate(() =>
        [...document.querySelectorAll("*")]
          .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
          .map((e) => ({
            cls: e.className,
            right: e.getBoundingClientRect().right,
          }))
          .slice(0, 20),
      ),
    );
    throw Error(JSON.stringify(result));
  }
  console.log("Result", width, "OK");
}
await p.setViewportSize({ width: 1440, height: 1100 });
await p.waitForTimeout(300);
await p.screenshot({ path: "/tmp/nova-result.png", fullPage: true });
await b.close();
