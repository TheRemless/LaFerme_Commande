// Audit « samedi soir » : la vraie page /tablette dans Chrome, coupure réseau, geste hors ligne, rechargement.
// À lancer quand service-charge.mjs est terminé (sinon le signe de vie de cette page fausse ses mesures).
// node scripts/audit/tablette-reseau.mjs <dossier des captures>
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { BASE, commander, connecter, LIGNES, attendre } from "./lib.mjs";

const dossier = process.argv[2] ?? "captures";
await mkdir(dossier, { recursive: true });
const cookie = await connecter("equipe-mobile@laferme.test");
const [nom, valeur] = cookie.split("=");

const navigateur = await chromium.launch({ channel: "chrome" });
const contexte = await navigateur.newContext({ viewport: { width: 1180, height: 820 } });
await contexte.addCookies([{ name: nom, value: valeur, url: BASE }]);
const page = await contexte.newPage();
const bilan = {};

await page.goto(`${BASE}/tablette`);
await page.getByRole("button", { name: "Démarrer le service" }).click();
const c = await commander({ etiquette: "Reseau", lignes: [LIGNES.margheritaOptions, LIGNES.pesto] });
const debut = Date.now();
await page.getByText("Reseau Audit").waitFor({ timeout: 20000 });
bilan.apparition_ms = Date.now() - debut;
await page.screenshot({ path: `${dossier}/1-commande-arrivee.png` });

await contexte.setOffline(true);
await attendre(7000);
bilan.bandeau_hors_ligne = await page.getByText(/Pas de connexion/).first().isVisible();
const accepter = page.getByRole("button", { name: /^Accepter pour/ }).first();
await accepter.click();
await attendre(1000);
bilan.message_geste_hors_ligne = await page.locator(".tab-message").textContent().catch(() => null);
bilan.bouton_reactive = await accepter.isEnabled();
await page.screenshot({ path: `${dossier}/2-hors-ligne-accepter.png` });

await contexte.setOffline(false);
await attendre(7000);
bilan.bandeau_apres_retour = await page.getByText(/Pas de connexion/).first().isVisible().catch(() => false);
await page.getByRole("button", { name: /^Accepter pour/ }).first().click();
await page.getByText("Ticket pizza").first().waitFor({ timeout: 10000 }).catch(() => undefined);
await page.screenshot({ path: `${dossier}/3-retour-reseau-acceptee.png` });

// Rechargement (onglet tué par l'iPad, mise à jour, coupure de courant) : le son repart-il ?
await page.reload();
await attendre(2000);
bilan.ecran_demarrer_apres_rechargement = await page.getByRole("button", { name: "Démarrer le service" }).isVisible();
await page.screenshot({ path: `${dossier}/4-apres-rechargement.png` });

console.log(JSON.stringify({ commande: c.status, ...bilan }, null, 2));
await navigateur.close();
