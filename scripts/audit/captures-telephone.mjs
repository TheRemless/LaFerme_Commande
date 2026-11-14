// Captures de la commande prise au téléphone (vague 3, bo-commandes), sur le jeu de rush, instance locale :
//   BASE_LOCALE_INSTANTANE=$PWD/.pglite/rush.tar.gz npx next dev -p 3222
//   AUDIT_BASE=http://localhost:3222 node scripts/audit/captures-telephone.mjs docs/rendus/vague-3/bo-commandes
// Saisie seulement : l'instantané du jeu de rush n'a pas les migrations récentes. L'enregistrement et ses
// captures sont dans tests/e2e/tablette-telephone.spec.ts.
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { BASE, attendre, connecter } from "./lib.mjs";

if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) throw new Error(`Refusé hors instance locale : ${BASE}`);
const [dossier = "captures"] = process.argv.slice(2);
await mkdir(dossier, { recursive: true });
const gerant = await connecter("gerant.rush@exemple.test");
const [nom, valeur] = gerant.split("=");
const navigateur = await chromium.launch({ channel: "chrome" });

for (const [l, h] of [[1180, 820], [390, 844]]) {
  const contexte = await navigateur.newContext({ viewport: { width: l, height: h }, hasTouch: true });
  await contexte.addCookies([{ name: nom, value: valeur, url: BASE }]);
  const p = await contexte.newPage();
  await p.goto(`${BASE}/tablette/telephone`);
  await p.getByRole("heading", { name: "Nouvelle commande (téléphone)" }).waitFor();
  await p.getByRole("button", { name: "À emporter" }).click();
  await p.getByRole("group", { name: "Catégories" }).getByRole("button").first().click();
  await p.locator(".tel-plats button").first().click();
  const fiche = p.getByRole("dialog");
  await fiche.waitFor();
  await fiche.getByRole("button", { name: /^Ajouter/ }).click();
  await p.locator(".tel-plats button").nth(1).click();
  await p.getByRole("dialog").getByRole("button", { name: /^Ajouter/ }).click();
  const quand = p.getByLabel("Prête");
  const options = await quand.locator("option").count();
  if (options > 1) await quand.selectOption({ index: 1 });
  await p.getByLabel("Prénom").fill("Giulia");
  await p.getByLabel("Téléphone").fill("079 555 12 34");
  await attendre(900);
  await p.screenshot({ path: `${dossier}/telephone-saisie-${l}.jpg`, quality: 80, fullPage: true });
  await contexte.close();
}
await navigateur.close();
console.log("Captures écrites dans", dossier);
