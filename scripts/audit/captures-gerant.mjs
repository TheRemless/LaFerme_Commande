// Captures avant et après des correctifs « journée du gérant » (instance locale, base embarquée).
// AUDIT_BASE=http://localhost:3105 node scripts/audit/captures-gerant.mjs docs/rendus/correctifs-gerant avant|apres
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { BASE, attendre, commander, connecter, http, LIGNES, payer } from "./lib.mjs";

const [dossier = "captures", prefixe = "apres"] = process.argv.slice(2);
const apres = prefixe === "apres";
await mkdir(dossier, { recursive: true });
const gerant = await connecter("gerant-bureau@laferme.test");
const tab = await connecter("equipe-bureau@laferme.test");

// Le service du jour ouvert toute la journée, pour que l'heure réelle tombe pendant un service.
const jourIso = ((d) => (d === 0 ? 7 : d))(new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Zurich" })).getDay());
const service = await http("GET", "/api/gestion/service", { cookie: gerant });
const h = service.json.horaires.find((x) => x.jour === jourIso);
if (h) await http("POST", "/api/gestion/service", { cookie: gerant, corps: { type: "horaire", id: h.id, champs: { premiere_heure: "00:15", derniere_heure: "23:50", derniere_commande: "23:30", derniere_commande_pizzas: "23:40" } } });

const file = async () => (await http("GET", "/api/tablette/file", { cookie: tab })).json.commandes;
const action = (commande, corps) => http("POST", "/api/tablette/action", { cookie: tab, corps: { commande, ...corps } });
const trouver = async (prenom) => (await file()).find((c) => c.client_prenom === prenom);

// Une commande payée en ligne acceptée (à annuler), une livrée (à rembourser).
const a = await commander({ etiquette: "Alice", moyen: "en_ligne", lignes: [LIGNES.margheritaOptions, LIGNES.pesto] });
if (a.idPaiement) await payer(a.idPaiement, "paye");
const ca = await trouver("Alice");
await action(ca.id, { action: "accepter", heure: ca.heure_proposee, de: "nouvelle" });
const b = await commander({ etiquette: "Bruno", moyen: "en_ligne", lignes: [LIGNES.prosciutto, LIGNES.lasagne] });
if (b.idPaiement) await payer(b.idPaiement, "paye");
const cb = await trouver("Bruno");
await action(cb.id, { action: "accepter", heure: cb.heure_proposee, de: "nouvelle" });
await action(cb.id, { action: "statut", vers: "prete", de: "acceptee" });
await action(cb.id, { action: "statut", vers: "terminee", de: "prete" });
if (!apres) await http("POST", "/api/tablette/reglages", { cookie: tab, corps: { preparation: 30 } });
else await http("POST", "/api/tablette/reglages", { cookie: tab, corps: { retard: 15 } });
await http("POST", "/api/gestion/imprimantes", { cookie: gerant, corps: { type: "ajouter", nom: "Imprimante pizza", station: "pizza" } });

const navigateur = await chromium.launch({ channel: "chrome" });

// Tablette, 1024 × 768.
{
  const [nom, valeur] = tab.split("=");
  const contexte = await navigateur.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await contexte.addCookies([{ name: nom, value: valeur, url: BASE }]);
  const page = await contexte.newPage();
  await page.goto(`${BASE}/tablette`);
  await page.getByRole("button", { name: "Continuer sans son" }).click();
  await page.getByRole("button", { name: "Pause, délai, ruptures" }).click();
  await page.locator(".tab-reglages").waitFor();
  await attendre(400);
  await page.screenshot({ path: `${dossier}/${prefixe}-1-tablette-reglages.png` });
  await page.getByRole("button", { name: "Fermer les réglages" }).click();
  await page.getByRole("button", { name: /^En cours/ }).click();
  const carte = page.locator("li.tab-commande", { hasText: "Alice Audit" });
  await carte.getByRole("button", { name: "Annuler la commande" }).click();
  await attendre(300);
  await carte.screenshot({ path: `${dossier}/${prefixe}-2-tablette-annuler.png` });
  await contexte.close();
}

// Back-office au téléphone, 375 × 812.
{
  const [nom, valeur] = gerant.split("=");
  const contexte = await navigateur.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await contexte.addCookies([{ name: nom, value: valeur, url: BASE }]);
  const page = await contexte.newPage();
  await page.goto(`${BASE}/gestion`);
  await page.locator(".tab-onglets").waitFor();
  await attendre(400);
  await page.screenshot({ path: `${dossier}/${prefixe}-3-gestion-rubriques.png` });
  await page.getByRole("button", { name: "Imprimantes" }).click();
  await page.getByRole("button", { name: "Nouvelle adresse" }).first().click();
  await attendre(400);
  await page.locator(".ges-service").first().screenshot({ path: `${dossier}/${prefixe}-4-gestion-imprimantes.png` });
  if (apres) {
    await page.getByRole("button", { name: "Commandes", exact: true }).click();
    await page.getByLabel("Nom, téléphone ou numéro").fill("bruno");
    await page.getByRole("button", { name: "Chercher" }).click();
    // La liste du jour montre déjà Bruno : attendre le résultat de la recherche avant d'ouvrir la fiche.
    await page.getByRole("heading", { name: /^Recherche « bruno »/ }).waitFor();
    await attendre(300);
    await page.screenshot({ path: `${dossier}/${prefixe}-5-gestion-commandes.png`, fullPage: true });
    await page.getByText("Bruno Audit").first().click();
    await page.getByLabel("Montant à rembourser (CHF)").fill("12.50");
    await page.getByLabel("Motif").fill("Lasagne arrivée froide");
    await attendre(300);
    await page.locator(".ges-fiche-commande").screenshot({ path: `${dossier}/${prefixe}-6-gestion-remboursement.png` });
    await page.getByRole("button", { name: /^Rembourser/ }).click();
    await page.locator(".ges-fiche-commande").getByText(/remboursés\. Le client/).waitFor();
    await page.locator(".ges-fiche-commande").screenshot({ path: `${dossier}/${prefixe}-7-gestion-rembourse.png` });
    await page.getByRole("button", { name: "Équipe" }).click();
    await page.getByText("Gérant bureau").first().waitFor();
    await attendre(300);
    await page.screenshot({ path: `${dossier}/${prefixe}-8-gestion-equipe.png`, fullPage: true });
  }
  await contexte.close();
}
await navigateur.close();
console.log(JSON.stringify({ alice: ca.numero, bruno: cb.numero }));
