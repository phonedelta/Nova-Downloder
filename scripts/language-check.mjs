import { chromium } from "@playwright/test";
const b = await chromium.launch();
const p = await b.newPage();
await p.goto("http://127.0.0.1:5173");
for (const lang of ["en", "ar", "tr", "fr"]) {
  await p.locator(".language select").selectOption(lang);
  await p.waitForTimeout(400);
  for (const width of [320, 390, 768, 1440]) {
    await p.setViewportSize({ width, height: 900 });
    await p.waitForTimeout(150);
    const overflow = await p.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    if (overflow) {
      console.log(
        await p.evaluate(() =>
          [...document.querySelectorAll("*")]
            .filter(
              (e) =>
                e.getBoundingClientRect().right > innerWidth + 1 ||
                e.getBoundingClientRect().left < -1,
            )
            .map((e) => ({
              cls: e.className,
              width: e.getBoundingClientRect().width,
            }))
            .slice(0, 20),
        ),
      );
      throw Error(`${lang} overflow ${width}`);
    }
  }
  console.log(lang, await p.locator("h1").innerText(), ": responsive OK");
}
await b.close();
