// Captures du bloc « Coup de feu » de la tablette (vague 3), compte gérant de test. Serveur local : AUDIT_BASE.
import { chromium } from "@playwright/test";
import { BASE, connecter as connecterApi } from "../audit/lib.mjs";

const DOSSIER = "docs/rendus/vague-3/tablette";
const navigateur = await chromium.launch({ channel: "chrome" });
const cookie = await connecterApi("gerant-bureau@laferme.test");
const [nom, valeur] = cookie.split("=");
for (const [vue, viewport] of [
  ["paysage-1024", { width: 1024, height: 768 }],
  ["portrait-820", { width: 820, height: 1180 }],
]) {
  const ctx = await navigateur.newContext({ viewport, hasTouch: true });
  await ctx.addCookies([{ name: nom, value: valeur, url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/tablette`);
  await page.getByRole("button", { name: "Continuer sans son" }).click();
  await page.getByRole("button", { name: "Pause, délai, ruptures" }).click();
  const bloc = page.locator(".tab-coup-de-feu");
  await bloc.waitFor();
  await bloc.getByRole("button", { name: "1 h", exact: true }).click();
  await bloc.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${DOSSIER}/coup-de-feu-${vue}-choix.png` });
  await bloc.getByRole("button", { name: /^Lancer jusqu/ }).click();
  await bloc.getByRole("button", { name: "Fin du coup de feu" }).waitFor();
  await page.screenshot({ path: `${DOSSIER}/coup-de-feu-${vue}-en-cours.png` });
  await bloc.getByRole("button", { name: "Fin du coup de feu" }).click();
  await bloc.getByRole("button", { name: "1 h", exact: true }).waitFor();
  await ctx.close();
}
await navigateur.close();
console.log("captures faites");
