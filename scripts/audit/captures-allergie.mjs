// Captures du champ « Allergie ou intolérance » (vague 3, client-commande), 375 et 320 px et bureau.
// Instance locale seulement : AUDIT_BASE=http://localhost:3226 node scripts/audit/captures-allergie.mjs <dossier>
import { mkdir } from "node:fs/promises";
import { chromium, devices } from "@playwright/test";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3226";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) throw new Error(`Refusé hors instance locale : ${BASE}`);
const [dossier = "captures"] = process.argv.slice(2);
await mkdir(dossier, { recursive: true });
const navigateur = await chromium.launch({ channel: "chrome" });

for (const [nom, largeur] of [["375", 375], ["320", 320], ["bureau", 1440]]) {
  const mobile = largeur < 800;
  const opts = mobile ? { ...devices["iPhone 13"], viewport: { width: largeur, height: 812 } } : { viewport: { width: 1440, height: 900 } };
  delete opts.defaultBrowserType;
  const ctx = await navigateur.newContext({ ...opts, locale: "fr-CH" });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/mentions-legales`);
  await p.evaluate(() => {
    localStorage.setItem("laferme.choix.v1", JSON.stringify({ mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05", enregistreLe: Date.now() }));
    localStorage.setItem("laferme.panier.v1", JSON.stringify({ le: Date.now(), lignes: [{ slug: "pizza-margherita", qte: 2, choix: {}, retraits: [], note: "" }] }));
  });
  await p.goto(`${BASE}/commande`);
  await p.getByLabel("Prénom").fill("Léa");
  await p.getByLabel("Nom", { exact: true }).fill("Rochat");
  await p.getByLabel("Téléphone").fill("079 123 45 67");
  await p.getByLabel("E-mail", { exact: true }).fill("lea.rochat@exemple.ch");
  await p.getByLabel("Allergie ou intolérance").fill("Arachides (enfant de 6 ans)");
  await p.waitForTimeout(800);
  if (mobile) await p.getByLabel("Allergie ou intolérance").evaluate((e) => e.scrollIntoView({ block: "center" }));
  await p.screenshot({ path: `${dossier}/apres-allergie-${nom}.png` });
  await ctx.close();
}
await navigateur.close();
