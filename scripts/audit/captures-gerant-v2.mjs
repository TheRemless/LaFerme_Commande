// Captures avant et après de la vague 2 du gérant (instance locale, base embarquée, base propre à chaque fois).
// AUDIT_BASE=http://localhost:3105 node scripts/audit/captures-gerant-v2.mjs docs/rendus/gerant-vague-2 avant|apres
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { BASE, attendre, commander, connecter, http, LIGNES, payer } from "./lib.mjs";

const [dossier = "captures", prefixe = "apres"] = process.argv.slice(2);
const apres = prefixe === "apres";
await mkdir(dossier, { recursive: true });
const gerant = await connecter("gerant-bureau@laferme.test");
const tab = await connecter("equipe-bureau@laferme.test");

// Service du jour ouvert toute la journée, pour que l'heure réelle tombe pendant un service.
const jourIso = ((d) => (d === 0 ? 7 : d))(new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Zurich" })).getDay());
const service = await http("GET", "/api/gestion/service", { cookie: gerant });
const h = service.json.horaires.find((x) => x.jour === jourIso);
if (h) await http("POST", "/api/gestion/service", { cookie: gerant, corps: { type: "horaire", id: h.id, champs: { premiere_heure: "00:15", derniere_heure: "23:50", derniere_commande: "23:30", derniere_commande_pizzas: "23:40" } } });
// Une modification de zone, pour le journal.
await http("POST", "/api/gestion/service", { cookie: gerant, corps: { type: "zone", numero: 1, champs: { frais: "3.50" } } });

const a = await commander({ etiquette: "Alice", moyen: "en_ligne", lignes: [LIGNES.margheritaOptions, LIGNES.pesto] });
if (a.idPaiement) await payer(a.idPaiement, "paye");
const ca = (await http("GET", "/api/tablette/file", { cookie: tab })).json.commandes.find((c) => c.client_prenom === "Alice");
await http("POST", "/api/tablette/action", { cookie: tab, corps: { commande: ca.id, action: "accepter", heure: ca.heure_proposee, de: "nouvelle" } });

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
  await page.locator(".tab-ruptures").waitFor();
  await page.locator("#recherche-plat").fill("bur");
  await attendre(500);
  await page.locator(".tab-ruptures").screenshot({ path: `${dossier}/${prefixe}-1-tablette-ruptures.png` });
  await page.getByRole("button", { name: "Fermer les réglages" }).click();
  await page.getByRole("button", { name: /^En cours/ }).click();
  const carte = page.locator("li.tab-commande", { hasText: "Alice Audit" });
  await carte.waitFor();
  if (apres) {
    await carte.getByRole("button", { name: "Il manque…" }).click();
    // Une pizza sur deux : on coche la ligne, puis −1 (remarque de la session principale).
    await carte.getByRole("button", { name: "2 × Pizza Margherita" }).click();
    await carte.getByRole("button", { name: "Une Pizza Margherita de moins" }).click();
    await carte.getByRole("button", { name: "1 × Pizza Margherita" }).waitFor();
    await carte.getByRole("button", { name: "Calculer le montant" }).click();
    await carte.getByText(/^À rembourser/).waitFor();
  }
  await attendre(300);
  await carte.screenshot({ path: `${dossier}/${prefixe}-2-tablette-manque.png` });
  if (apres) {
    await carte.getByRole("button", { name: "Confirmer et prévenir le client" }).click();
    await carte.getByRole("button", { name: "Fermer" }).click();
    await carte.locator(".tab-manque").waitFor();
    await carte.screenshot({ path: `${dossier}/${prefixe}-3-tablette-manque-fait.png` });
  }
  await contexte.close();
}

// Back-office au téléphone, 375 × 812.
{
  const [nom, valeur] = gerant.split("=");
  const contexte = await navigateur.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await contexte.addCookies([{ name: nom, value: valeur, url: BASE }]);
  const page = await contexte.newPage();
  await page.goto(`${BASE}/gestion`);
  await page.getByRole("button", { name: "Livraison et horaires" }).click();
  const fermetures = page.locator(".ges-bloc", { has: page.getByRole("heading", { name: "Fermetures" }) });
  await fermetures.waitFor();
  if (apres) {
    await fermetures.getByLabel("Fermer").selectOption("soir");
    await fermetures.getByLabel("Le", { exact: true }).fill("2026-12-08");
    await fermetures.getByLabel("Motif (pour vous)").fill("Soirée privée");
  }
  await attendre(300);
  await fermetures.screenshot({ path: `${dossier}/${prefixe}-4-gestion-fermetures.png` });
  if (apres) {
    await page.locator(".ges-bloc", { has: page.getByRole("heading", { name: "Ouvertures exceptionnelles" }) }).screenshot({ path: `${dossier}/${prefixe}-5-gestion-ouvertures.png` });
    await page.locator(".ges-bloc", { has: page.getByRole("heading", { name: "Paiement au comptoir" }) }).screenshot({ path: `${dossier}/${prefixe}-6-gestion-comptoir.png` });
  }
  await page.locator(".ges-zone").first().screenshot({ path: `${dossier}/${prefixe}-7-gestion-communes.png` });
  await page.getByRole("button", { name: "Journal" }).click();
  await page.getByRole("heading", { name: "Journal des modifications" }).waitFor();
  await attendre(400);
  await page.screenshot({ path: `${dossier}/${prefixe}-8-gestion-journal.png` });
  if (apres) {
    const ligne = page.locator(".ges-journal-liste li", { hasText: "Zone 1" }).first();
    await ligne.getByRole("button", { name: "Annuler" }).click();
    await attendre(200);
    await page.screenshot({ path: `${dossier}/${prefixe}-9-gestion-journal-annuler.png` });
  }
  await contexte.close();
}
await navigateur.close();
console.log(JSON.stringify({ alice: ca.numero }));
