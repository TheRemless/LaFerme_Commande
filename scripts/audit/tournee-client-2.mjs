// Seconde tournée « client mystère » (vague 2), instance locale sur base embarquée seulement.
// AUDIT_BASE=http://localhost:3101 node scripts/audit/tournee-client-2.mjs docs/audits/captures-client-2
import { mkdir } from "node:fs/promises";
import { chromium, devices } from "@playwright/test";
import { attendre, BASE, connecter as connecterUneFois, http } from "./lib.mjs";

// Un code par e-mail du personnel toutes les 30 s : on attend le délai annoncé.
async function connecter(email) {
  for (let essai = 0; essai < 4; essai++) {
    try {
      return await connecterUneFois(email);
    } catch (e) {
      const m = String(e).match(/dans (\d+) (secondes|minutes?)/);
      if (!m) throw e;
      await attendre((Number(m[1]) * (m[2].startsWith("minute") ? 60 : 1) + 1) * 1000);
    }
  }
  throw new Error(`Connexion impossible pour ${email}`);
}

const [dossier = "captures"] = process.argv.slice(2);
await mkdir(dossier, { recursive: true });
const HEURE = "2026-11-10T19:05";
const constats = [];
const noter = (cas, ok, detail) => {
  constats.push({ cas, ok, detail });
  console.log(`${ok ? "OK " : "KO "} ${cas} : ${detail}`);
};
const L = (slug, qte = 1, extra = {}) => ({ slug, qte, choix: {}, retraits: [], note: "", ...extra });

const navigateur = await chromium.launch({ channel: "chrome" });
const telephone = { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } };
delete telephone.defaultBrowserType;
// Une « IP » par client (x-forwarded-for, cru seulement par l'instance locale) : la limite du comptoir par connexion.
const ip = () => `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const nouveau = async (mobile = true) =>
  (await navigateur.newContext({ ...(mobile ? telephone : { viewport: { width: 1440, height: 900 } }), locale: "fr-CH", extraHTTPHeaders: { "x-forwarded-for": ip() } })).newPage();
const prete = (p) => p.waitForLoadState("networkidle");
let n = 0;
const capture = (p, nom, plein = false) => p.screenshot({ path: `${dossier}/${String(++n).padStart(2, "0")}-${nom}.jpg`, quality: 70, type: "jpeg", fullPage: plein });

async function poser(page, choix, lignes) {
  await page.goto(`${BASE}/mentions-legales`);
  await page.evaluate(
    ([choix, lignes]) => {
      localStorage.setItem("laferme.choix.v1", JSON.stringify({ ...choix, enregistreLe: Date.now() }));
      localStorage.setItem("laferme.panier.v1", JSON.stringify({ le: Date.now(), lignes }));
    },
    [choix, lignes],
  );
}

// Un numéro par commande : au comptoir, deux commandes à encaisser au plus par téléphone.
const telephoneTest = () => `079 ${String(Math.floor(Math.random() * 1000)).padStart(3, "0")} ${String(Math.floor(Math.random() * 100)).padStart(2, "0")} ${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`;

async function coordonnees(page, nom) {
  await page.getByLabel("Prénom").fill("TEST-CM2");
  await page.getByLabel("Nom", { exact: true }).fill(nom);
  await page.getByLabel("Téléphone").fill(telephoneTest());
  await page.getByLabel("E-mail", { exact: true }).fill(`test-cm2.${nom.toLowerCase()}.${Date.now() % 100000}@laferme.test`);
}

// 1. Parcours principal, téléphone, livraison payée en ligne.
{
  const p = await nouveau();
  await p.goto(`${BASE}/?heure=${HEURE}`);
  await prete(p);
  await p.getByLabel("Adresse de livraison").fill("Avenue du Gros-Chêne 20");
  await p.locator(".suggestions button").first().click();
  await p.waitForTimeout(1200);
  await p.getByLabel("Nom sur la sonnette").fill("Test");
  await capture(p, "accueil-livraison-mobile");
  await p.getByRole("button", { name: "Voir la carte" }).click();
  await p.waitForURL(/\/carte/);
  await prete(p);
  await p.getByRole("button", { name: /Margherita/ }).first().click();
  await p.waitForTimeout(500);
  await capture(p, "fiche-margherita-mobile");
  await p.getByRole("button", { name: /^Ajouter/ }).click();
  await p.getByRole("button", { name: /Lasagne/ }).first().click();
  await p.getByRole("button", { name: /^Ajouter/ }).click();
  await p.waitForTimeout(500);
  await capture(p, "carte-barre-panier-mobile");
  await p.getByRole("link", { name: /Voir le panier/ }).click();
  await p.waitForURL(/\/panier/);
  await prete(p);
  await capture(p, "panier-mobile");
  await p.getByRole("link", { name: /^Commander/ }).click();
  await p.waitForURL(/\/commande/);
  await prete(p);
  await coordonnees(p, "Livraison");
  await capture(p, "commande-mobile", true);
  await p.getByRole("button", { name: /^Payer CHF/ }).click();
  await p.waitForURL(/paiement-test/);
  await prete(p);
  await p.getByRole("button", { name: "Simuler un paiement réussi" }).click();
  await p.waitForURL(/\/suivi\//);
  await prete(p);
  await capture(p, "suivi-mobile", true);
  const txt = await p.locator(".suivi-detail").innerText();
  noter("parcours livraison mobile", /Margherita/.test(txt) && !/Pizza Margherita/.test(txt), "commande payée, suivi affiché");
  await p.context().close();
}

// 2. Bureau, à emporter, au comptoir.
{
  const p = await nouveau(false);
  await p.goto(`${BASE}/?heure=${HEURE}`);
  await prete(p);
  await p.getByRole("button", { name: /À emporter/ }).click();
  await capture(p, "accueil-emporter-bureau");
  await p.getByRole("button", { name: "Voir la carte" }).click();
  await p.waitForURL(/\/carte/);
  await prete(p);
  await p.getByLabel("Chercher un plat").fill("peppino");
  await p.getByRole("button", { name: /Peppino/ }).first().click();
  await p.getByRole("button", { name: /^Ajouter/ }).click();
  await p.waitForTimeout(500);
  await capture(p, "carte-recherche-bureau");
  await p.getByRole("link", { name: /^Commander/ }).first().click();
  await p.waitForURL(/\/commande/);
  await prete(p);
  await coordonnees(p, "Comptoir");
  await p.getByText("Au comptoir").click();
  await p.getByRole("button", { name: "Commander, je paie au comptoir" }).click();
  await p.waitForURL(/\/suivi\//);
  await prete(p);
  await capture(p, "suivi-comptoir-bureau");
  noter("parcours à emporter bureau, comptoir", true, "commande au comptoir, suivi affiché");
  await p.context().close();
}

// 3. Plat mis en rupture entre le panier et le paiement.
const equipe = await connecter("equipe-mobile@laferme.test");
{
  const p = await nouveau();
  await poser(p, { mode: "retrait", quand: { type: "asap" }, heureSimulee: HEURE }, [L("pizza-margherita"), L("lasagne-de-boeuf")]);
  await p.goto(`${BASE}/commande`);
  await prete(p);
  await coordonnees(p, "Rupture");
  const r = await http("POST", "/api/tablette/plats", { cookie: equipe, corps: { slug: "lasagne-de-boeuf", rupture: true } });
  if (!r.status || r.status >= 400) throw new Error(`Rupture refusée : ${r.status} ${r.texte}`);
  await p.getByRole("button", { name: /^Payer CHF/ }).click();
  await p.waitForTimeout(1500);
  const erreur = await p.locator(".commande-form .panier-alerte").allInnerTexts();
  await capture(p, "rupture-au-paiement-mobile");
  noter("rupture entre panier et paiement", erreur.some((t) => /Lasagne/.test(t)), erreur.join(" | ").slice(0, 200));
  // Rechargement : le récapitulatif dit-il quelle ligne pose problème ?
  await p.reload();
  await prete(p);
  await p.waitForTimeout(800);
  const ligne = await p.locator(".commande-recap .ligne-erreur").allInnerTexts();
  await capture(p, "rupture-apres-rechargement-mobile", true);
  noter("rupture visible au récapitulatif après rechargement", ligne.length > 0, ligne.join(" | ") || "aucun message sur la ligne");
  await http("POST", "/api/tablette/plats", { cookie: equipe, corps: { slug: "lasagne-de-boeuf", rupture: false } });
  await p.context().close();
}

// 4. Créneau devenu complet entre le choix et le paiement.
const gerant = await connecter("gerant-mobile@laferme.test");
const service = await http("GET", "/api/gestion/service", { cookie: gerant });
const avant = service.json?.capacites ?? { livraison: 0, retrait: 0 };
await http("POST", "/api/gestion/service", { cookie: gerant, corps: { type: "capacite", livraison: avant.livraison, retrait: 1 } });
try {
  const p = await nouveau();
  await p.goto(`${BASE}/?heure=${HEURE}`);
  await prete(p);
  await p.getByRole("button", { name: /À emporter/ }).click();
  await p.getByText("Plus tard").click();
  const heure = p.getByLabel("Heure");
  const valeurs = await heure.locator("option").evaluateAll((o) => o.map((x) => x.value).filter(Boolean));
  const minutes = Number(valeurs[2] ?? valeurs[0]);
  await heure.selectOption(String(minutes));
  await p.getByRole("button", { name: "Voir la carte" }).click();
  await p.waitForURL(/\/carte/);
  await p.evaluate(() => localStorage.setItem("laferme.panier.v1", JSON.stringify({ le: Date.now(), lignes: [{ slug: "pizza-margherita", qte: 1, choix: {}, retraits: [], note: "" }] })));
  await p.goto(`${BASE}/commande`);
  await prete(p);
  await coordonnees(p, "Creneau");
  // Quelqu'un d'autre prend le dernier retrait de ce créneau.
  const autre = await http("POST", "/api/commandes", {
    corps: {
      cle: `tournee2-${Date.now()}`,
      mode: "retrait",
      moyen: "comptoir",
      quand: { type: "creneau", date: "2026-11-10", minutes },
      heure: HEURE,
      client: { prenom: "TEST-CM2", nom: "Autre", telephone: telephoneTest(), email: `test-cm2.autre.${Date.now() % 100000}@laferme.test` },
      lignes: [L("pizza-margherita")],
    },
    entetes: { "x-forwarded-for": ip() },
  });
  await p.getByText("Au comptoir").click();
  await p.getByRole("button", { name: "Commander, je paie au comptoir" }).click();
  await p.waitForTimeout(1500);
  const erreur = await p.locator('[role="alert"]').allInnerTexts();
  await capture(p, "creneau-complet-au-paiement-mobile", true);
  noter("créneau complet entre choix et paiement", autre.status === 200 && erreur.length > 0, `autre commande ${autre.status} ; message : ${erreur.join(" | ").slice(0, 200)}`);
  // Retour à l'accueil : le créneau plein n'est plus proposé.
  await p.goto(`${BASE}/?heure=${HEURE}`);
  await prete(p);
  await p.getByRole("button", { name: /À emporter/ }).click();
  await p.getByText("Plus tard").click();
  const restantes = await p.getByLabel("Heure").locator("option").evaluateAll((o) => o.map((x) => x.value));
  noter("créneau plein retiré du sélecteur", !restantes.includes(String(minutes)), `créneau ${minutes} ${restantes.includes(String(minutes)) ? "encore proposé" : "absent"}`);
  await p.context().close();
} finally {
  await http("POST", "/api/gestion/service", { cookie: gerant, corps: { type: "capacite", livraison: avant.livraison, retrait: avant.retrait } });
}

// 5. Constats majeurs de la première tournée, à l'œil.
{
  const p = await nouveau();
  // CM-01 : saisie à la main avec abréviation.
  await p.goto(`${BASE}/?heure=${HEURE}`);
  await prete(p);
  await p.getByLabel("Adresse de livraison").fill("Av. du Gros-Chêne 20");
  await p.getByRole("button", { name: "Mon adresse n'apparaît pas" }).click();
  const champs = { Rue: "Av. du Gros-Chêne", Numéro: "20", NPA: "1213", Localité: "Onex" };
  for (const [k, v] of Object.entries(champs)) await p.getByLabel(k, { exact: true }).fill(v).catch(() => undefined);
  await p.waitForTimeout(2500);
  const v = await p.locator(".verdict").first().innerText().catch(() => "");
  await capture(p, "cm01-saisie-main-abreviation-mobile");
  noter("CM-01 adresse à la main « Av. »", /Dans notre zone/.test(v), v.split("\n")[0]);
  // CM-03 : 22h14 en livraison.
  await p.goto(`${BASE}/?heure=2026-11-10T22:14`);
  await prete(p);
  await p.getByLabel("Adresse de livraison").fill("Avenue du Gros-Chêne 20");
  await p.locator(".suggestions button").first().click();
  await p.waitForTimeout(1200);
  const t3 = await p.locator(".accueil-panneau").innerText();
  await capture(p, "cm03-livraison-22h14-mobile");
  noter("CM-03 22h14", !/cuisine est fermée/i.test(t3), /Trop tard/.test(t3) ? "« Trop tard pour dès que possible » et soir proposé" : t3.slice(0, 120));
  // CM-06 : veille de fermeture annuelle.
  await p.goto(`${BASE}/?heure=2026-12-19T22:30`);
  await prete(p);
  const t6 = await p.locator(".accueil-panneau").innerText();
  await capture(p, "cm06-veille-fermeture-mobile");
  noter("CM-06 veille de fermeture", /Fermé du|rouvre/i.test(t6), (t6.match(/Fermé[^\n]*/) ?? [""])[0]);
  // CM-08 : carte pendant la fermeture.
  await p.goto(`${BASE}/?heure=2026-12-23T12:00`);
  await prete(p);
  await p.getByRole("button", { name: /À emporter/ }).click();
  await p.getByRole("button", { name: "Voir la carte" }).click();
  await p.waitForURL(/\/carte/);
  await prete(p);
  await p.getByText(/commande en ligne est fermée/).first().waitFor({ timeout: 5000 }).catch(() => undefined);
  const t8 = await p.locator("body").innerText();
  await capture(p, "cm08-carte-fermeture-mobile");
  noter("CM-08 carte pendant la fermeture", /fermée/i.test(t8), (t8.match(/[^\n]*fermée[^\n]*/i) ?? [""])[0]);
  await p.context().close();
}
{
  const p = await nouveau();
  // CM-02 et CM-10 : sous le minimum de livraison.
  await poser(p, { mode: "livraison", adresse: { rue: "Avenue du Lignon", numero: "40", npa: "1219", localite: "Le Lignon" }, details: { etage: "", sonnette: "Test", code: "", instructions: "" }, zone: { numero: 2, frais_centimes: 490, minimum_centimes: 4000, delai_min: 40, delai_max: 50 }, quand: { type: "asap" }, heureSimulee: HEURE }, [L("pizza-margherita")]);
  await p.goto(`${BASE}/carte`);
  await prete(p);
  const barre = await p.locator(".barre-panier").innerText().catch(() => "");
  await capture(p, "cm10-barre-minimum-mobile");
  noter("CM-10 barre du panier", /de plats pour le minimum/.test(barre), barre.replace(/\n/g, " "));
  await p.goto(`${BASE}/commande`);
  await prete(p);
  const bouton = p.getByRole("button", { name: /^Payer/ });
  await bouton.scrollIntoViewIfNeeded();
  await capture(p, "cm02-payer-grise-raison-mobile");
  const raison = await p.locator(".commande-form .panier-alerte").innerText().catch(() => "");
  noter("CM-02 raison du bouton gris", raison.length > 0, raison.slice(0, 120));
  // CM-09 : téléphone faux, à emporter (au-dessus de tout minimum).
  await poser(p, { mode: "retrait", quand: { type: "asap" }, heureSimulee: HEURE }, [L("pizza-margherita", 2)]);
  await p.goto(`${BASE}/commande`);
  await prete(p);
  await coordonnees(p, "Tel");
  await p.getByLabel("Téléphone").fill("123");
  await p.getByRole("button", { name: /^Payer CHF/ }).click();
  await p.waitForTimeout(500);
  await capture(p, "cm09-telephone-faux-mobile");
  const aide = await p.locator(".aide-erreur").allInnerTexts();
  noter("CM-09 téléphone faux nommé", aide.some((t) => /téléphone/i.test(t)), aide.join(" | "));
  await p.context().close();
}

await navigateur.close();
console.log(JSON.stringify(constats, null, 1));
