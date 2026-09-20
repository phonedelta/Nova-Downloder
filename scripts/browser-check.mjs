import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:5173");
await page.waitForLoadState("networkidle");
for (const width of [320, 375, 390, 430, 768, 1024, 1440, 1920]) {
  await page.setViewportSize({ width, height: 1000 });
  await page.waitForTimeout(100);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  if (overflow) throw Error(`Overflow at ${width}`);
  console.log(`Responsive ${width}: OK`);
}
await page.setViewportSize({ width: 1440, height: 1100 });
await page.screenshot({ path: "/tmp/nova-desktop.png", fullPage: true });
await page.getByRole("button", { name: "Analyser", exact: true }).click();
await page.getByRole("alert").waitFor();
await page.getByRole("tab", { name: "MP3" }).click();
await page.getByRole("tabpanel").getByRole("heading", {name: "Télécharger en MP3"}).waitFor();
await page.getByRole("tab", { name: "Sous-titres", exact: true }).click();
await page.getByRole("tab", { name: "Informations", exact: true }).click();
await page.getByRole("button", { name: "Activer le thème clair" }).click();
if ((await page.locator("html").getAttribute("data-theme")) !== "light")
  throw Error("Theme");
await page.getByRole("button", { name: "Activer le thème sombre" }).click();
await page.getByRole("tab", { name: "Vidéo", exact: true }).click();
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
await page.screenshot({ path: "/tmp/nova-mobile.png", fullPage: true });
await page.getByRole("button", { name: "Ouvrir le menu" }).click();
if (!(await page.getByRole("navigation").isVisible()))
  throw Error("Mobile navigation");
if (errors.length) throw Error(errors.join("\n"));
console.log("Tabs, validation, theme, mobile menu, console: OK");
await browser.close();
