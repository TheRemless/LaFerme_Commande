// Captures « après » de la rubrique Clients (vague 3, bo-commandes), sur le jeu de rush de qualite.
//   BASE_LOCALE_INSTANTANE=$PWD/.pglite/rush.tar.gz npx next dev -p 3222
//   AUDIT_BASE=http://localhost:3222 node scripts/audit/captures-bo-clients.mjs docs/rendus/vague-3/bo-commandes
// Pas d'« avant » : la rubrique n'existait pas (place réservée dans la coque).
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { BASE, attendre, connecter, http } from "./lib.mjs";

const [dossier = "captures"] = process.argv.slice(2);
await mkdir(dossier, { recursive: true });
const gerant = await connecter("gerant.rush@exemple.test");
const [nom, valeur] = gerant.split("=");
// Une réclamation notée au téléphone sur la dernière commande du meilleur client (le jeu de rush n'en a pas).
const meilleurs = await http("POST", "/api/gestion/clients", { cookie: gerant, corps: { action: "liste", tri: "depense", page: 1, par_page: 10 } });
const client = await http("POST", "/api/gestion/clients", { cookie: gerant, corps: { action: "fiche", email: meilleurs.json.lignes[0].email } });
await http("POST", "/api/gestion/reclamations", {
  cookie: gerant,
  corps: { action: "ouvrir", commande_id: client.json.commandes_liste[0].id, type: "manquant", source: "telephone", description: "Il manque le tiramisù. Le client a appelé à 20h40." },
});
const navigateur = await chromium.launch({ channel: "chrome" });

for (const [l, h] of [[1440, 900], [375, 812]]) {
  const contexte = await navigateur.newContext({ viewport: { width: l, height: h }, hasTouch: l < 1100 });
  await contexte.addCookies([{ name: nom, value: valeur, url: BASE }]);
  const p = await contexte.newPage();
  await p.goto(`${BASE}/gestion/clients`);
  await p.locator(".bo-tableau tbody tr").first().waitFor();
  // Les meilleurs clients d'abord.
  await p.getByRole("button", { name: /^Dépensé CHF/ }).click();
  await attendre(800);
  await p.screenshot({ path: `${dossier}/clients-apres-liste-${l}.jpg`, quality: 80, fullPage: l === 375 });
  await p.locator(".bo-tableau tbody tr").first().getByRole("button").first().click();
  const fiche = p.getByRole("dialog");
  await fiche.locator(".bo-fiche-etat").waitFor();
  await p.screenshot({ path: `${dossier}/clients-apres-fiche-${l}.jpg`, quality: 80 });
  if (l === 1440) {
    await fiche.getByRole("tab", { name: "Commandes" }).click();
    await attendre(300);
    await p.screenshot({ path: `${dossier}/clients-apres-fiche-commandes-${l}.jpg`, quality: 80 });
    await fiche.getByRole("tab", { name: "Marque" }).click();
    await attendre(300);
    await p.screenshot({ path: `${dossier}/clients-apres-fiche-marque-${l}.jpg`, quality: 80 });
    await p.keyboard.press("Escape");
    await p.getByRole("tab", { name: "Réclamations" }).click();
    await p.locator(".bo-tableau tbody tr").first().waitFor();
    await attendre(500);
    await p.screenshot({ path: `${dossier}/reclamations-apres-liste-${l}.jpg`, quality: 80 });
    await p.locator(".bo-tableau tbody tr").first().getByRole("button").first().click();
    await p.getByRole("dialog").locator(".bo-fiche-etat").waitFor();
    await attendre(300);
    await p.screenshot({ path: `${dossier}/reclamations-apres-fiche-${l}.jpg`, quality: 80 });
  }
  await contexte.close();
}
await navigateur.close();
console.log(`Captures dans ${dossier}`);
