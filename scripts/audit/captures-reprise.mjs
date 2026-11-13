// Captures de « Votre dernière commande » à l'accueil (vague 3, client-commande), 375 et 320 px.
// Instance locale seulement (code de connexion affiché à l'écran, adresses en .test) :
// AUDIT_BASE=http://localhost:3226 node scripts/audit/captures-reprise.mjs <dossier>
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
  await ctx.setExtraHTTPHeaders({ "x-forwarded-for": `10.8.${largeur % 250}.${Math.floor(Math.random() * 250)}` });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/compte`);
  await p.getByLabel("E-mail", { exact: true }).fill(`capture-reprise-${largeur}-${Date.now()}@laferme.test`);
  await p.getByRole("button", { name: "Recevoir un code" }).click();
  await p.getByLabel("Code à 6 chiffres").fill(await p.locator(".note-preversion strong").innerText());
  await p.getByRole("button", { name: "Me connecter" }).click();
  await p.getByRole("heading", { name: "Vos commandes" }).waitFor();
  await p.evaluate(() => {
    localStorage.setItem("laferme.choix.v1", JSON.stringify({ mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05", enregistreLe: Date.now() }));
    localStorage.setItem("laferme.panier.v1", JSON.stringify({ le: Date.now(), lignes: [{ slug: "pizza-margherita", qte: 2, choix: {}, retraits: [], note: "" }, { slug: "pizza-peppino", qte: 1, choix: {}, retraits: [], note: "" }] }));
  });
  await p.goto(`${BASE}/commande`);
  await p.getByLabel("Prénom").fill("Léa");
  await p.getByLabel("Nom", { exact: true }).fill("Rochat");
  await p.getByLabel("Téléphone", { exact: true }).fill(`079 ${100 + Math.floor(Math.random() * 899)} 22 33`);
  await p.getByText("Au comptoir").click();
  await p.getByRole("button", { name: /^Commander, je paie au comptoir/ }).click();
  await p.waitForURL(/\/suivi\//);
  await p.evaluate(() => localStorage.clear());
  await p.goto(`${BASE}/?heure=2026-11-10T19:05`);
  await p.getByRole("button", { name: "Reprendre cette commande" }).waitFor();
  await p.screenshot({ path: `${dossier}/apres-reprise-accueil-${largeur}.png` });
  await p.getByRole("button", { name: "Reprendre cette commande" }).click();
  await p.getByText(/plats? remis dans votre panier/).waitFor();
  await p.waitForTimeout(900);
  await p.screenshot({ path: `${dossier}/apres-reprise-remise-${largeur}.png` });
  await ctx.close();
}
await navigateur.close();
