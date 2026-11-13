// Captures de la vue par poste (vague 3, D12 à l'essai), rush de scripts/tablette/rush.mjs, compte cuisine-bureau. AUDIT_BASE=http://localhost:3228.
import { chromium } from "@playwright/test";
import { BASE, connecter } from "../audit/lib.mjs";

const nav = await chromium.launch({ channel: "chrome" });
const [nom, valeur] = (await connecter("cuisine-bureau@laferme.test")).split("=");
for (const [vue, viewport] of [
  ["paysage-1024", { width: 1024, height: 768 }],
  ["paysage-1180", { width: 1180, height: 820 }],
  ["portrait-820", { width: 820, height: 1180 }],
]) {
  const ctx = await nav.newContext({ viewport, hasTouch: true });
  await ctx.addCookies([{ name: nom, value: valeur, url: BASE }]);
  const page = await ctx.newPage();
  for (const station of ["pizza", "cuisine"]) {
    await page.goto(`${BASE}/tablette/poste/${station}`);
    await page.locator(".poste-tete p", { hasNotText: "Chargement" }).waitFor();
    console.log(vue, station, await page.locator(".poste-tete p").innerText(), (await page.locator(".poste-reste").innerText({ timeout: 3000 }).catch(() => "")).replace(/\n/g, " ").slice(0, 120));
    await page.screenshot({ path: `docs/rendus/vague-3/tablette/poste-${station}-${vue}.png` });
  }
  await ctx.close();
}
await nav.close();
