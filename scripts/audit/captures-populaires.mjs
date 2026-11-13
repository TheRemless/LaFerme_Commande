// Captures des plats les plus commandés et de la suggestion au panier (vague 3, client-commande), 375 et 320 px.
// Éteints par défaut : allumés ici en réécrivant les données servies avec la page (données d'exemple).
// Instance locale seulement : AUDIT_BASE=http://localhost:3226 node scripts/audit/captures-populaires.mjs <dossier>
import { mkdir } from "node:fs/promises";
import { chromium, devices } from "@playwright/test";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3226";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) throw new Error(`Refusé hors instance locale : ${BASE}`);
const [dossier = "captures"] = process.argv.slice(2);
await mkdir(dossier, { recursive: true });
const navigateur = await chromium.launch({ channel: "chrome" });
const allumer = async (p) =>
  p.route(/\/(carte|panier)$/, async (r) => {
    if (r.request().resourceType() !== "document") return r.continue();
    const rep = await r.fetch();
    const html = (await rep.text())
      .replace('\\"populaires_actifs\\":false', '\\"populaires_actifs\\":true')
      .replace('\\"suggestion_active\\":false', '\\"suggestion_active\\":true')
      .replace('\\"tous\\":[]', '\\"tous\\":[\\"pizza-margherita\\",\\"lasagne-de-boeuf\\",\\"pizza-peppino\\"]')
      .replace('\\"par_categorie\\":{}', '\\"par_categorie\\":{\\"boissons\\":[\\"coca-cola\\"]}');
    await r.fulfill({ response: rep, body: html });
  });
for (const largeur of [375, 320]) {
  const opts = { ...devices["iPhone 13"], viewport: { width: largeur, height: 812 } };
  delete opts.defaultBrowserType;
  const ctx = await navigateur.newContext({ ...opts, locale: "fr-CH" });
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    localStorage.setItem("laferme.choix.v1", JSON.stringify({ mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05", enregistreLe: Date.now() }));
    localStorage.setItem("laferme.panier.v1", JSON.stringify({ le: Date.now(), lignes: [{ slug: "pizza-margherita", qte: 2, choix: {}, retraits: [], note: "" }] }));
  });
  await allumer(p);
  await p.goto(`${BASE}/carte`);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${dossier}/apres-populaires-carte-${largeur}.png` });
  await p.goto(`${BASE}/panier`);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${dossier}/apres-suggestion-panier-${largeur}.png` });
  await ctx.close();
}
await navigateur.close();
