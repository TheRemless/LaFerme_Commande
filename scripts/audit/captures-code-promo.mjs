// Captures du champ « Code » (codes promo de bo-carte, éteints par défaut), allumé par réécriture de la page
// et remise simulée (code d'essai, aucune offre réelle), 375 et 320 px. Instance locale seulement :
// AUDIT_BASE=http://localhost:3226 node scripts/audit/captures-code-promo.mjs <dossier>
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
    localStorage.setItem("laferme.panier.v1", JSON.stringify({ le: Date.now(), lignes: [{ slug: "pizza-margherita", qte: 2, choix: {}, retraits: [], note: "" }] }));
  });
  await p.route("**/commande", async (r) => {
    if (r.request().resourceType() !== "document") return r.continue();
    const rep = await r.fetch();
    await r.fulfill({ response: rep, body: (await rep.text()).replaceAll('\\"codesActifs\\":false', '\\"codesActifs\\":true') });
  });
  await p.route("**/api/panier", async (r) => {
    const corps = JSON.parse(r.request().postData() ?? "{}");
    const vraie = await (await r.fetch()).json();
    if (!corps.code) return r.fulfill({ json: vraie });
    const remise = Math.round(vraie.sous_total_centimes / 10);
    await r.fulfill({ json: { ...vraie, code: { code: corps.code, ok: true, remise_centimes: remise }, remise_centimes: remise, total_centimes: vraie.total_centimes - remise } });
  });
  await p.goto(`${BASE}/commande`);
  await p.getByLabel(/^Code/).evaluate((e) => e.scrollIntoView({ block: "center" }));
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${dossier}/apres-code-champ-${largeur}.png` });
  await p.getByLabel(/^Code/).fill("ESSAI");
  await p.getByRole("button", { name: "Appliquer" }).click();
  await p.waitForTimeout(1200);
  await p.locator(".commande-recap .sommes").evaluate((e) => e.scrollIntoView({ block: "center" }));
  await p.screenshot({ path: `${dossier}/apres-code-remise-${largeur}.png` });
  await ctx.close();
}
await navigateur.close();
