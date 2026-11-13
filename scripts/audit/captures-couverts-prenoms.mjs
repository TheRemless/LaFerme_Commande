// Captures des couverts (C8) et du prénom par ligne (C5), allumés par réécriture des réglages servis
// avec la page (éteints par défaut), 375 et 320 px. Instance locale seulement :
// AUDIT_BASE=http://localhost:3226 node scripts/audit/captures-couverts-prenoms.mjs <dossier>
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
    localStorage.setItem("laferme.panier.v1", JSON.stringify({ le: Date.now(), lignes: [{ slug: "pizza-margherita", qte: 1, choix: {}, retraits: [], note: "", pour: "Léa" }, { slug: "pizza-peppino", qte: 1, choix: {}, retraits: [], note: "", pour: "Marc" }] }));
  });
  await p.route(/\/(carte|panier|commande)$/, async (r) => {
    if (r.request().resourceType() !== "document") return r.continue();
    const rep = await r.fetch();
    const html = (await rep.text()).replaceAll('\\"couvertsActifs\\":false', '\\"couvertsActifs\\":true').replaceAll('\\"prenomActif\\":false', '\\"prenomActif\\":true');
    await r.fulfill({ response: rep, body: html });
  });
  await p.goto(`${BASE}/carte`);
  await p.locator('li[data-slug="pizza-margherita"] button').first().click();
  await p.getByRole("dialog").getByLabel("Pour qui ?").fill("Léa");
  await p.getByRole("dialog").getByLabel("Pour qui ?").evaluate((e) => e.scrollIntoView({ block: "center" }));
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${dossier}/apres-prenom-fiche-${largeur}.png` });
  await p.goto(`${BASE}/panier`);
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${dossier}/apres-prenom-panier-${largeur}.png` });
  await p.goto(`${BASE}/commande`);
  await p.getByLabel("Couverts et serviettes").evaluate((e) => e.scrollIntoView({ block: "center" }));
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${dossier}/apres-couverts-${largeur}.png` });
  await ctx.close();
}
await navigateur.close();
