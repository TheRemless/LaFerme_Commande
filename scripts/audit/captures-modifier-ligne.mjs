// Captures de « Modifier » une ligne du panier (vague 3, client-commande) : 375 et 320 px, bureau.
// Instance locale seulement : AUDIT_BASE=http://localhost:3226 node scripts/audit/captures-modifier-ligne.mjs <dossier> <prefixe>
import { mkdir } from "node:fs/promises";
import { chromium, devices } from "@playwright/test";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3226";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) throw new Error(`Refusé hors instance locale : ${BASE}`);
const [dossier = "captures", prefixe = "apres"] = process.argv.slice(2);
await mkdir(dossier, { recursive: true });
const navigateur = await chromium.launch({ channel: "chrome" });
const lignes = [
  { slug: "pizza-margherita", qte: 1, choix: {}, retraits: [], note: "" },
  { slug: "pasta-alla-carbonara", qte: 2, choix: { "choix-pates": ["Penne"] }, retraits: [], note: "Bien chaud" },
];

async function page(largeur) {
  const opts = largeur < 800 ? { ...devices["iPhone 13"], viewport: { width: largeur, height: 812 } } : { viewport: { width: 1440, height: 900 } };
  delete opts.defaultBrowserType;
  const ctx = await navigateur.newContext({ ...opts, locale: "fr-CH" });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/mentions-legales`);
  await p.evaluate((l) => {
    localStorage.setItem("laferme.choix.v1", JSON.stringify({ mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05", enregistreLe: Date.now() }));
    localStorage.setItem("laferme.panier.v1", JSON.stringify({ le: Date.now(), lignes: l }));
  }, lignes);
  return p;
}

for (const [nom, largeur] of [["375", 375], ["320", 320]]) {
  const p = await page(largeur);
  await p.goto(`${BASE}/panier`);
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${dossier}/${prefixe}-modifier-panier-${nom}.png` });
  const bouton = p.getByRole("button", { name: /^Modifier/ }).nth(1);
  if (await bouton.isVisible().catch(() => false)) {
    await bouton.click();
    await p.waitForTimeout(600);
    await p.getByRole("dialog").locator(".fiche-pied").scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${dossier}/${prefixe}-modifier-fiche-${nom}.png` });
  }
  await p.context().close();
}
{
  const p = await page(1440);
  await p.goto(`${BASE}/carte`);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${dossier}/${prefixe}-modifier-carte-bureau.png` });
  await p.context().close();
}
await navigateur.close();
