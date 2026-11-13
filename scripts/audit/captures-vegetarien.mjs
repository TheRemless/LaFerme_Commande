// Captures du filtre « Végétarien » de la carte (vague 3, client-commande), 375 et 320 px. Étiquettes
// d'exemple posées en réécrivant la carte servie (le seed n'en a aucune). Instance locale seulement :
// AUDIT_BASE=http://localhost:3226 node scripts/audit/captures-vegetarien.mjs <dossier>
import { mkdir } from "node:fs/promises";
import { chromium, devices } from "@playwright/test";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3226";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) throw new Error(`Refusé hors instance locale : ${BASE}`);
const [dossier = "captures"] = process.argv.slice(2);
await mkdir(dossier, { recursive: true });
const navigateur = await chromium.launch({ channel: "chrome" });
for (const largeur of [375, 320]) {
  const opts = { ...devices["iPhone 13"], viewport: { width: largeur, height: 812 } };
  delete opts.defaultBrowserType;
  const ctx = await navigateur.newContext({ ...opts, locale: "fr-CH" });
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    localStorage.setItem("laferme.choix.v1", JSON.stringify({ mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05", enregistreLe: Date.now() }));
  });
  await p.route("**/carte", async (r) => {
    if (r.request().resourceType() !== "document") return r.continue();
    const rep = await r.fetch();
    const html = (await rep.text())
      .replace(/(\\"slug\\":\\"pizza-margherita\\"[^}]*?\\"etiquettes\\":)\[\]/, '$1[\\"vegetarien\\"]')
      .replace(/(\\"slug\\":\\"rigatoni-alla-peppino\\"[^}]*?\\"etiquettes\\":)\[\]/, '$1[\\"vegetarien\\"]');
    await r.fulfill({ response: rep, body: html });
  });
  await p.goto(`${BASE}/carte`);
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${dossier}/apres-vegetarien-carte-${largeur}.png` });
  await p.getByRole("button", { name: "Végétarien", exact: true }).click();
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${dossier}/apres-vegetarien-filtre-${largeur}.png` });
  await ctx.close();
}
await navigateur.close();
