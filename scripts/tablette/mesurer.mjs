// Mesures de la tablette pendant un rush (vague 3) : captures par onglet en 1024 × 768 et 1180 × 820,
// nombre de commandes lisibles sans faire défiler, hauteur des listes en écrans, temps des gestes.
// Après scripts/tablette/rush.mjs : AUDIT_BASE=http://localhost:3228 node scripts/tablette/mesurer.mjs <dossier> <prefixe>
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { BASE, connecter as connecterApi } from "../audit/lib.mjs";

const [dossier = "captures", prefixe = "avant"] = process.argv.slice(2);
await mkdir(dossier, { recursive: true });
const navigateur = await chromium.launch({ channel: "chrome" });
const mesures = { base: BASE, vues: {} };

// Session par l'API (même cookie que le navigateur) : pas de limite d'essais sur l'écran de connexion.
const cookies = {};
async function connecter(page, email) {
  cookies[email] ??= await connecterApi(email);
  const [nom, valeur] = cookies[email].split("=");
  await page.context().addCookies([{ name: nom, value: valeur, url: BASE }]);
  await page.goto(`${BASE}/tablette`);
  await page.getByRole("button", { name: "Continuer sans son" }).click();
  await page.locator(".tab-liste, .tab-vide:not(:text('Chargement'))").first().waitFor();
}

for (const [nomVue, viewport] of [
  ["paysage-1024", { width: 1024, height: 768 }],
  ["paysage-1180", { width: 1180, height: 820 }],
  ["portrait-820", { width: 820, height: 1180 }],
]) {
  const ctx = await navigateur.newContext({ viewport, hasTouch: true });
  const page = await ctx.newPage();
  await connecter(page, process.env.COMPTE ?? "cuisine-bureau@laferme.test");
  const vue = {};
  for (const [onglet, titre] of [["traiter", /^À accepter/], ["cours", /^En cours/], ["avance", /^À l'avance/], ["terminees", /^Terminées/]]) {
    await page.getByRole("button", { name: titre }).click();
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      // Cartes (avant la vague 3, et « À accepter ») ou lignes du tableau (après).
      const cartes = [...document.querySelectorAll(":is(.tab-liste, .tab-tableau-liste):not(.tab-detail *) > li")];
      const h = window.innerHeight;
      const liste = document.querySelector(".tab-tableau-liste") ?? document.querySelector(".tab-liste");
      return {
        cartes: cartes.length,
        // Carte dont le numéro se lit sans défiler.
        numerosVisibles: cartes.filter((c) => c.querySelector(".tab-num, .tab-ligne-num").getBoundingClientRect().bottom <= h).length,
        hauteurCarteMoyenne: cartes.length ? Math.round(cartes.reduce((a, c) => a + c.getBoundingClientRect().height, 0) / cartes.length) : 0,
        hauteurListeEnEcrans: liste ? +(liste.getBoundingClientRect().bottom / h).toFixed(1) : 0,
        hautDeLaListe: liste ? Math.round(liste.getBoundingClientRect().top) : null,
        // Cibles tactiles sous 44 px de haut.
        ciblesTropPetites: [...document.querySelectorAll("button, a")].filter((b) => {
          const r = b.getBoundingClientRect();
          return r.height > 0 && r.height < 44;
        }).length,
      };
    });
    vue[onglet] = m;
    await page.screenshot({ path: `${dossier}/${prefixe}-${nomVue}-${onglet}.png` });
  }
  // Recherche au comptoir (après la vague 3 seulement) : un prénom, sans accent.
  const champ = page.getByRole("searchbox", { name: /Chercher une commande/ });
  if (await champ.count()) {
    await champ.fill("lea");
    await page.waitForTimeout(300);
    vue.recherche = await page.evaluate(() => document.querySelectorAll(":is(.tab-liste, .tab-tableau-liste):not(.tab-detail *) > li").length);
    await page.screenshot({ path: `${dossier}/${prefixe}-${nomVue}-recherche.png` });
    await champ.fill("");
  }
  mesures.vues[nomVue] = vue;
  await ctx.close();
}

// Temps des gestes : accepter la plus ancienne, puis « Prête » sur la première en cours, jusqu'à la carte à jour.
const ctx = await navigateur.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const page = await ctx.newPage();
await connecter(page, process.env.COMPTE ?? "cuisine-bureau@laferme.test");
const gestes = {};
const premiere = page.locator(".tab-liste > li").first();
const num = await premiere.locator(".tab-num").innerText();
let t = Date.now();
await premiere.getByRole("button", { name: /^Accepter pour/ }).click();
await page.locator(".tab-liste > li .tab-num", { hasText: new RegExp(`^${num}$`) }).waitFor({ state: "detached" });
gestes.accepter_ms = Date.now() - t;
await page.getByRole("button", { name: /^En cours/ }).click();
// Un geste : la carte (avant) ou la ligne du tableau (après) a son bouton « Prête ».
const prete = page.locator(":is(.tab-liste, .tab-tableau-liste):not(.tab-detail *) > li", { has: page.getByRole("button", { name: /^Prête( au comptoir)?$/ }) }).first();
const numP = await prete.locator(".tab-num, .tab-ligne-num").innerText();
t = Date.now();
await prete.getByRole("button", { name: /^Prête( au comptoir)?$/ }).click();
await page
  .locator(":is(.tab-liste, .tab-tableau-liste):not(.tab-detail *) > li", { has: page.locator(".tab-num, .tab-ligne-num", { hasText: new RegExp(`^${numP}$`) }) })
  .getByRole("button", { name: /^Retirée/ })
  .first()
  .waitFor();
gestes.prete_ms = Date.now() - t;
mesures.gestes = gestes;
await navigateur.close();
await writeFile(`${dossier}/${prefixe}-mesures.json`, JSON.stringify(mesures, null, 2));
console.log(JSON.stringify(mesures, null, 1));
