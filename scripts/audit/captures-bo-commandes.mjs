// Captures « après » de la rubrique Commandes (vague 3, bo-commandes), sur le jeu de rush de qualite.
// Instance locale seulement :
//   BASE_LOCALE_INSTANTANE=$PWD/.pglite/rush.tar.gz npx next dev -p 3222
//   AUDIT_BASE=http://localhost:3222 node scripts/audit/captures-bo-commandes.mjs docs/rendus/vague-3/bo-commandes
// Les « avant » sont les captures de la coque (docs/rendus/vague-3/bo-socle/coque-apres-commandes-*.jpg).
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { BASE, attendre, connecter } from "./lib.mjs";

const [dossier = "captures"] = process.argv.slice(2);
await mkdir(dossier, { recursive: true });
const gerant = await connecter("gerant.rush@exemple.test");
const [nom, valeur] = gerant.split("=");
const navigateur = await chromium.launch({ channel: "chrome" });

async function page(largeur, hauteur) {
  const contexte = await navigateur.newContext({ viewport: { width: largeur, height: hauteur }, hasTouch: largeur < 1100, deviceScaleFactor: 1 });
  await contexte.addCookies([{ name: nom, value: valeur, url: BASE }]);
  const p = await contexte.newPage();
  await p.goto(`${BASE}/gestion/commandes`);
  await p.getByRole("heading", { level: 1, name: "Commandes" }).waitFor();
  await p.locator(".bo-tableau tbody tr").first().waitFor();
  return p;
}

for (const [l, h] of [[1440, 900], [1024, 768], [375, 812]]) {
  const p = await page(l, h);
  await p.screenshot({ path: `${dossier}/commandes-apres-liste-${l}.jpg`, quality: 80, fullPage: l === 375 });
  // Fiche : la première commande « en préparation » du jeu (contenu, client, adresse).
  await p.getByRole("button", { name: /^En préparation \d+$/ }).click();
  await attendre(800);
  await p.locator(".bo-tableau tbody tr").first().getByRole("button").first().click();
  const fiche = p.getByRole("dialog");
  await fiche.locator(".bo-fiche-etat").waitFor();
  await p.screenshot({ path: `${dossier}/commandes-apres-fiche-${l}.jpg`, quality: 80 });
  if (l === 1440) {
    await fiche.getByRole("tab", { name: "Historique" }).click();
    await attendre(300);
    await p.screenshot({ path: `${dossier}/commandes-apres-historique-${l}.jpg`, quality: 80 });
    await fiche.getByRole("tab", { name: "Gestes" }).click();
    await attendre(300);
    await p.screenshot({ path: `${dossier}/commandes-apres-gestes-${l}.jpg`, quality: 80 });
  }
  await p.context().close();
}
await navigateur.close();
console.log(`Captures dans ${dossier}`);
