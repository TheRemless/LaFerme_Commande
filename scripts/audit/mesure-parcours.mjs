// Mesure du parcours de commande : gestes et temps, avant et après chaque PR de la vague 3 (client-commande).
// Instance locale seulement (base embarquée) : AUDIT_BASE=http://localhost:3226 node scripts/audit/mesure-parcours.mjs
//
// Gestes : un tap compte 1, un champ rempli compte 1 tap plus un geste par caractère tapé.
// Temps humain estimé (modèle simple, à comparer d'une mesure à l'autre, pas une vérité absolue) :
// 1 s par tap, 0,28 s par caractère (environ 40 mots par minute au téléphone), 1,5 s de lecture par écran nouveau,
// plus l'attente réelle mesurée de chaque chargement.
import { chromium, devices } from "@playwright/test";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3226";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) throw new Error(`Refusé hors instance locale : ${BASE}`);
const HEURE = "2026-11-10T19:05";

const navigateur = await chromium.launch({ channel: "chrome" });

function compteur(page) {
  const m = { taps: 0, caracteres: 0, ecrans: 0, attenteMs: 0, debut: Date.now() };
  const attendre = async (fn) => {
    const t = Date.now();
    await fn();
    m.attenteMs += Date.now() - t;
  };
  return {
    m,
    async aller(url) {
      m.ecrans++;
      await attendre(() => page.goto(`${BASE}${url}`));
      await attendre(() => page.waitForFunction(() => document.readyState === "complete"));
    },
    async tap(loc) {
      m.taps++;
      await loc.click();
    },
    async taper(loc, texte) {
      m.taps++;
      m.caracteres += texte.length;
      await loc.fill(texte);
    },
    async ecran(fn) {
      m.ecrans++;
      await attendre(fn);
    },
    resultat(nom) {
      const humain = m.taps * 1 + m.caracteres * 0.28 + m.ecrans * 1.5 + m.attenteMs / 1000;
      return { parcours: nom, gestes: m.taps + m.caracteres, taps: m.taps, caracteres: m.caracteres, ecrans: m.ecrans, attente_s: +(m.attenteMs / 1000).toFixed(1), temps_estime_s: Math.round(humain) };
    },
  };
}

async function contexte() {
  const opts = { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } };
  delete opts.defaultBrowserType;
  const ctx = await navigateur.newContext({ ...opts, locale: "fr-CH" });
  // Chaque parcours a ses propres coordonnées : la limite du comptoir ne bloque pas la mesure.
  await ctx.setExtraHTTPHeaders({ "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  return ctx;
}

async function ajouter(c, page, nom) {
  await c.tap(page.locator(".plat-carte", { hasText: nom }).first());
  await c.ecran(() => page.getByRole("button", { name: /^Ajouter, / }).waitFor());
  await c.tap(page.getByRole("button", { name: /^Ajouter, / }));
}

async function coordonnees(c, page, email) {
  await c.taper(page.getByLabel("Prénom"), "Léa");
  await c.taper(page.getByLabel("Nom", { exact: true }), "Rochat");
  // Numéro tiré au hasard : la limite du comptoir compte les commandes en attente par téléphone.
  await c.taper(page.getByLabel("Téléphone"), `079 ${100 + Math.floor(Math.random() * 899)} ${10 + Math.floor(Math.random() * 89)} ${10 + Math.floor(Math.random() * 89)}`);
  await c.taper(page.getByLabel("E-mail", { exact: true }), email);
}

async function payerDoublure(c, page) {
  await c.tap(page.getByRole("button", { name: /^Payer CHF/ }));
  await c.ecran(() => page.waitForURL(/paiement-test/));
  // Le vrai Stripe demande ici TWINT ou la carte : compté comme deux taps (choisir TWINT, confirmer dans l'app).
  await c.tap(page.getByRole("button", { name: "Simuler un paiement réussi" }));
  c.m.taps++;
  await c.ecran(() => page.waitForURL(/\/suivi\//));
}

const resultats = [];
const id = Date.now().toString(36);

// 1. Nouveau client, livraison : adresse, sonnette, deux pizzas et une boisson, paiement en ligne.
{
  const ctx = await contexte();
  const page = await ctx.newPage();
  const c = compteur(page);
  await c.aller(`/?heure=${HEURE}`);
  await page.waitForFunction(() => window.__laFermePret === true);
  await c.taper(page.getByLabel("Adresse de livraison"), "Avenue du Gros-Chêne 20");
  await c.tap(page.locator(".suggestions button").first());
  await page.getByText("Dans notre zone de livraison").waitFor();
  await c.taper(page.getByLabel("Nom sur la sonnette"), "Rochat");
  await c.tap(page.getByRole("button", { name: "Voir la carte" }));
  await c.ecran(() => page.waitForURL(/\/carte/));
  await ajouter(c, page, "Margherita");
  await ajouter(c, page, "Margherita");
  await ajouter(c, page, "Peppino");
  await c.tap(page.locator(".barre-panier"));
  await c.ecran(() => page.waitForURL(/\/panier/));
  await c.tap(page.getByRole("link", { name: /^Commander, / }));
  await c.ecran(() => page.waitForURL(/\/commande/));
  await coordonnees(c, page, `mesure-livraison-${id}@laferme.test`);
  await payerDoublure(c, page);
  resultats.push(c.resultat("nouveau client, livraison, en ligne"));
  await ctx.close();
}

// 2. Nouveau client, à emporter, paiement au comptoir.
{
  const ctx = await contexte();
  const page = await ctx.newPage();
  const c = compteur(page);
  await c.aller(`/?heure=${HEURE}`);
  await page.waitForFunction(() => window.__laFermePret === true);
  await c.tap(page.getByRole("button", { name: /À emporter/ }));
  await c.tap(page.getByRole("button", { name: "Voir la carte" }));
  await c.ecran(() => page.waitForURL(/\/carte/));
  await ajouter(c, page, "Margherita");
  await c.tap(page.locator(".barre-panier"));
  await c.ecran(() => page.waitForURL(/\/panier/));
  await c.tap(page.getByRole("link", { name: /^Commander, / }));
  await c.ecran(() => page.waitForURL(/\/commande/));
  await coordonnees(c, page, `mesure-retrait-${id}@laferme.test`);
  await c.tap(page.getByText("Au comptoir"));
  await c.tap(page.getByRole("button", { name: /^Commander, je paie au comptoir/ }));
  await c.ecran(() => page.waitForURL(/\/suivi\//));
  resultats.push(c.resultat("nouveau client, à emporter, comptoir"));
  await ctx.close();
}

// 3. Client fidèle déjà connecté (session ouverte sur son téléphone), qui revient le lendemain.
{
  const ctx = await contexte();
  const page = await ctx.newPage();
  const email = `mesure-fidele-${id}@laferme.test`;
  // Préparation, hors mesure : connexion par code, profil, puis une première livraison (adresse gardée au compte).
  await page.goto(`${BASE}/compte`);
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Recevoir un code" }).click();
  const code = await page.locator(".note-preversion strong").innerText();
  await page.getByLabel("Code à 6 chiffres").fill(code);
  await page.getByRole("button", { name: "Me connecter" }).click();
  await page.getByRole("heading", { name: "Vos commandes" }).waitFor();
  await page.getByLabel("Prénom").fill("Léa");
  await page.getByLabel("Nom", { exact: true }).fill("Rochat");
  await page.getByLabel("Téléphone").fill("079 123 45 67");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await page.getByText("Enregistré.").waitFor();
  await page.goto(`${BASE}/?heure=${HEURE}`);
  await page.waitForFunction(() => window.__laFermePret === true);
  await page.getByLabel("Adresse de livraison").fill("Avenue du Gros-Chêne 20");
  await page.locator(".suggestions button").first().click();
  await page.getByText("Dans notre zone de livraison").waitFor();
  await page.getByLabel("Nom sur la sonnette").fill("Rochat");
  await page.getByRole("button", { name: "Voir la carte" }).click();
  await page.waitForURL(/\/carte/);
  for (const nom of ["Margherita", "Margherita", "Peppino"]) {
    await page.locator(".plat-carte", { hasText: nom }).first().click();
    await page.getByRole("button", { name: /^Ajouter, / }).click();
  }
  await page.goto(`${BASE}/commande`);
  await page.getByRole("button", { name: /^Payer CHF/ }).click();
  await page.waitForURL(/paiement-test/);
  await page.getByRole("button", { name: "Simuler un paiement réussi" }).click();
  await page.waitForURL(/\/suivi\//);
  // Le lendemain : le panier et le choix du jour ont expiré.
  await page.evaluate(() => {
    localStorage.removeItem("laferme.panier.v1");
    localStorage.removeItem("laferme.choix.v1");
    sessionStorage.clear();
  });

  // Mesure : il ouvre le site et reprend la même pizza.
  const c = compteur(page);
  await c.aller(`/?heure=${HEURE}`);
  await page.waitForFunction(() => window.__laFermePret === true);
  const enregistree = page.locator(".adresses-enregistrees button, .adresses-enregistrees label").first();
  // Les adresses du compte arrivent avec /api/accueil, après le premier affichage.
  await enregistree.waitFor({ timeout: 5000 }).catch(() => undefined);
  if (await enregistree.isVisible().catch(() => false)) {
    await c.tap(enregistree);
  } else {
    await c.taper(page.getByLabel("Adresse de livraison"), "Avenue du Gros-Chêne 20");
    await c.tap(page.locator(".suggestions button").first());
  }
  await page.getByText("Dans notre zone de livraison").waitFor();
  const sonnette = page.getByLabel("Nom sur la sonnette");
  if (!(await sonnette.inputValue())) await c.taper(sonnette, "Rochat");
  await c.tap(page.getByRole("button", { name: "Voir la carte" }));
  await c.ecran(() => page.waitForURL(/\/carte/));
  await ajouter(c, page, "Margherita");
  await ajouter(c, page, "Margherita");
  await ajouter(c, page, "Peppino");
  await c.tap(page.locator(".barre-panier"));
  await c.ecran(() => page.waitForURL(/\/panier/));
  await c.tap(page.getByRole("link", { name: /^Commander, / }));
  await c.ecran(() => page.waitForURL(/\/commande/));
  await payerDoublure(c, page);
  resultats.push(c.resultat("client fidèle connecté, livraison"));

  // 4. Le même client, le surlendemain, reprend sa dernière commande dès l'accueil (vague 3).
  await page.evaluate(() => {
    localStorage.removeItem("laferme.panier.v1");
    localStorage.removeItem("laferme.choix.v1");
    sessionStorage.clear();
  });
  const r = compteur(page);
  await r.aller(`/?heure=${HEURE}`);
  await page.waitForFunction(() => window.__laFermePret === true);
  const reprendre = page.getByRole("button", { name: "Reprendre cette commande" });
  await reprendre.waitFor({ timeout: 5000 }).catch(() => undefined);
  if (await reprendre.isVisible().catch(() => false)) {
    await r.tap(reprendre);
    await page.getByText(/plats? remis dans votre panier/).waitFor();
    await page.getByText("Dans notre zone de livraison").waitFor();
    await r.tap(page.getByRole("button", { name: "Voir le panier" }));
    await r.ecran(() => page.waitForURL(/\/panier/));
    await r.tap(page.getByRole("link", { name: /^Commander, / }));
    await r.ecran(() => page.waitForURL(/\/commande/));
    await payerDoublure(r, page);
    resultats.push(r.resultat("client fidèle connecté, reprendre la dernière commande"));
  }
  await ctx.close();
}

await navigateur.close();
console.table(resultats);
console.log(JSON.stringify(resultats));
