// Captures avant et après des conforts restants du rapport client mystère (CM-11 à CM-26).
// Instance locale sur base embarquée seulement : AUDIT_BASE=http://localhost:3101 node scripts/audit/captures-client-conforts.mjs <dossier> <prefixe>
import { mkdir } from "node:fs/promises";
import { chromium, devices } from "@playwright/test";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3101";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) throw new Error(`Refusé hors instance locale : ${BASE}`);
const [dossier = "captures", prefixe = "apres"] = process.argv.slice(2);
await mkdir(dossier, { recursive: true });

const L = (slug, qte = 1, extra = {}) => ({ slug, qte, choix: {}, retraits: [], note: "", ...extra });
const retrait = { mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05" };

const navigateur = await chromium.launch({ channel: "chrome" });
const mesures = {};

async function contexte(taille = "mobile") {
  const opts = taille === "mobile" ? { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } : { viewport: { width: 1440, height: 900 } };
  delete opts.defaultBrowserType;
  return navigateur.newContext({ ...opts, locale: "fr-CH" });
}

async function poser(page, choix, lignes, le = Date.now()) {
  await page.goto(`${BASE}/mentions-legales`);
  await page.evaluate(
    ([choix, lignes, le]) => {
      localStorage.setItem("laferme.choix.v1", JSON.stringify({ ...choix, enregistreLe: Date.now() }));
      localStorage.setItem("laferme.panier.v1", JSON.stringify({ le, lignes }));
    },
    [choix, lignes, le],
  );
}

const nom = (n) => `${dossier}/${prefixe}-${n}.png`;

// CM-26 : accueil mobile, adresse choisie. Le bouton « Voir la carte » est-il visible ?
{
  const ctx = await contexte();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?heure=2026-11-10T19:05`);
  await page.getByLabel("Adresse de livraison").fill("Avenue du Gros-Chêne 20");
  await page.locator(".suggestions button").first().click();
  await page.waitForTimeout(1200);
  await page.getByLabel("Nom sur la sonnette").fill("Test");
  await page.waitForTimeout(400);
  const b = await page.getByRole("button", { name: "Voir la carte" }).boundingBox();
  mesures.cm26 = { yBouton: Math.round(b.y + b.height), hauteur: 844, scrollY: await page.evaluate(() => scrollY) };
  await page.screenshot({ path: nom("cm26-accueil-mobile") });
  await ctx.close();
}

// CM-15 : panier de plus de 24 h.
{
  const ctx = await contexte();
  const page = await ctx.newPage();
  await poser(page, retrait, [L("pizza-margherita", 2)], Date.now() - 25 * 3600 * 1000);
  await page.goto(`${BASE}/panier`);
  await page.waitForTimeout(600);
  await page.screenshot({ path: nom("cm15-panier-expire") });
  await ctx.close();
}

// CM-23 : « − » sur la dernière unité d'une ligne.
{
  const ctx = await contexte();
  const page = await ctx.newPage();
  await poser(page, retrait, [L("pizza-margherita", 1, { note: "Bien cuite" }), L("lasagne-de-boeuf", 1)]);
  await page.goto(`${BASE}/panier`);
  await page.getByRole("button", { name: "Retirer du panier" }).first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: nom("cm23-retrait-ligne") });
  await ctx.close();
}

// CM-22 et CM-11 : commande payée en ligne (doublure), suivi, puis retour arrière.
{
  const ctx = await contexte();
  const page = await ctx.newPage();
  await poser(page, retrait, [L("pizza-margherita", 2), L("pizza-peppino", 1)]);
  await page.goto(`${BASE}/commande`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Prénom").fill("TEST-CM");
  await page.getByLabel("Nom", { exact: true }).fill("Conforts");
  await page.getByLabel("Téléphone").fill("079 000 00 00");
  await page.getByLabel("E-mail", { exact: true }).fill("test-cm.conforts@laferme.test");
  await page.getByRole("button", { name: /^Payer CHF/ }).click();
  await page.waitForURL(/paiement-test/);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Simuler un paiement réussi" }).click();
  await page.waitForURL(/\/suivi\//);
  await page.locator(".suivi-detail").scrollIntoViewIfNeeded();
  await page.screenshot({ path: nom("cm22-suivi-noms") });
  await page.goBack();
  await page.waitForTimeout(800);
  mesures.cm11 = { url: page.url().replace(BASE, "") };
  await page.screenshot({ path: nom("cm11-retour-apres-paiement") });
  await ctx.close();
}

// CM-21 : réseau lent simulé (scripts retenus 4 s), tap sur « À emporter » avant qu'ils arrivent.
{
  const ctx = await contexte();
  const page = await ctx.newPage();
  await page.route("**/_next/static/chunks/**", async (r) => {
    await new Promise((ok) => setTimeout(ok, 4000));
    await r.continue();
  });
  await page.goto(`${BASE}/?heure=2026-11-10T19:05`, { waitUntil: "commit" });
  await page.getByRole("button", { name: /À emporter/ }).click({ noWaitAfter: true });
  await page.waitForTimeout(7000);
  mesures.cm21 = { retraitChoisi: await page.getByRole("button", { name: /À emporter/ }).getAttribute("aria-pressed") };
  await page.screenshot({ path: nom("cm21-tap-avant-chargement") });
  await ctx.close();
}

// Bureau : panier à droite de la carte, après « − » sur la dernière unité.
{
  const ctx = await contexte("bureau");
  const page = await ctx.newPage();
  await poser(page, retrait, [L("pizza-margherita", 1), L("lasagne-de-boeuf", 1)]);
  await page.goto(`${BASE}/carte`);
  await page.waitForLoadState("networkidle");
  const moins = page.getByRole("button", { name: "Retirer du panier" }).first();
  if (await moins.isVisible().catch(() => false)) await moins.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: nom("bureau-carte-panier") });
  await ctx.close();
}

await navigateur.close();
console.log(JSON.stringify(mesures));
