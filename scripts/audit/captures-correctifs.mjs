// Captures avant et après des correctifs « samedi soir » sur la tablette (instance locale, base embarquée).
// node scripts/audit/captures-correctifs.mjs <dossier> <prefixe>   (ex. docs/rendus/correctifs-service avant)
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { BASE, attendre, commander, connecter, http, LIGNES, payer } from "./lib.mjs";

const [dossier = "captures", prefixe = "apres"] = process.argv.slice(2);
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

// A : retrait payé au comptoir, prêt au comptoir.
await commander({ etiquette: "Alice", lignes: [LIGNES.margheritaOptions, LIGNES.pesto] });
let a = await trouver("Alice");
await action(a.id, { action: "accepter", heure: a.heure_proposee });
await action(a.id, { action: "statut", vers: "prete" });
// B : retrait au comptoir marqué « Retirée » sans « Encaissée ».
await commander({ etiquette: "Bruno", lignes: [LIGNES.prosciutto] });
const b = await trouver("Bruno");
await action(b.id, { action: "accepter", heure: b.heure_proposee });
await action(b.id, { action: "statut", vers: "prete" });
await action(b.id, { action: "statut", vers: "terminee" });
// C : payée en ligne pendant une pause, avec un plat épuisé entre-temps.
const c = await commander({ etiquette: "Chloé", mode: "retrait", moyen: "en_ligne", lignes: [LIGNES.lasagne, LIGNES.margherita] });
await http("POST", "/api/tablette/reglages", { cookie: tab, corps: { pause: "sans-fin" } });
await http("POST", "/api/tablette/plats", { cookie: tab, corps: { slug: "lasagne-de-boeuf", rupture: true } });
if (c.idPaiement) await payer(c.idPaiement, "paye");
await http("POST", "/api/tablette/reglages", { cookie: tab, corps: { pause: "reprendre" } });

const [nom, valeur] = tab.split("=");
const navigateur = await chromium.launch({ channel: "chrome" });
const contexte = await navigateur.newContext({ viewport: { width: 1180, height: 820 } });
await contexte.addCookies([{ name: nom, value: valeur, url: BASE }]);
const page = await contexte.newPage();
await page.goto(`${BASE}/tablette`);
await page.getByRole("button", { name: "Continuer sans son" }).click();
await page.getByText("Chloé Audit").waitFor();
await attendre(500);
await page.screenshot({ path: `${dossier}/${prefixe}-1-a-accepter.png` });
await page.getByRole("button", { name: /^En cours/ }).click();
await page.getByText("Alice Audit").scrollIntoViewIfNeeded();
await page.locator("li.tab-commande", { hasText: "Alice Audit" }).screenshot({ path: `${dossier}/${prefixe}-2-pret-au-comptoir.png` });
await page.getByRole("button", { name: /^Terminées/ }).click();
await page.locator("li.tab-commande", { hasText: "Bruno Audit" }).screenshot({ path: `${dossier}/${prefixe}-3-terminee-non-encaissee.png` });
await navigateur.close();
console.log(JSON.stringify({ a: a.numero, b: b.numero, c: c.status }));
