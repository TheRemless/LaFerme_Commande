// Captures de l'heure annoncée en fourchette à l'accueil (vague 3, client-commande), 375 et 320 px.
// Instance locale seulement : AUDIT_BASE=http://localhost:3226 node scripts/audit/captures-fourchette.mjs <dossier> <prefixe>
import { mkdir } from "node:fs/promises";
import { chromium, devices } from "@playwright/test";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3226";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) throw new Error(`Refusé hors instance locale : ${BASE}`);
const [dossier = "captures", prefixe = "apres"] = process.argv.slice(2);
await mkdir(dossier, { recursive: true });
const navigateur = await chromium.launch({ channel: "chrome" });
for (const largeur of [375, 320]) {
  const opts = { ...devices["iPhone 13"], viewport: { width: largeur, height: 812 } };
  delete opts.defaultBrowserType;
  const ctx = await navigateur.newContext({ ...opts, locale: "fr-CH" });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/?heure=2026-11-10T19:05`);
  await p.waitForFunction(() => window.__laFermePret === true);
  await p.getByLabel("Adresse de livraison").fill("Avenue du Gros-Chêne 20");
  await p.locator(".suggestions button").first().click();
  await p.getByText("Dans notre zone de livraison").waitFor();
  await p.waitForTimeout(1200);
  await p.locator(".verdict-ok").first().evaluate((e) => e.scrollIntoView({ block: "start" }));
  await p.screenshot({ path: `${dossier}/${prefixe}-fourchette-livraison-${largeur}.png` });
  await p.getByRole("button", { name: /À emporter/ }).click();
  await p.waitForTimeout(800);
  await p.locator("fieldset.quand").evaluate((e) => e.scrollIntoView({ block: "center" }));
  await p.screenshot({ path: `${dossier}/${prefixe}-fourchette-retrait-${largeur}.png` });
  await ctx.close();
}
await navigateur.close();
