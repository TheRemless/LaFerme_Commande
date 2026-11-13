// Captures : allergie et personne qui reçoit la commande sur la tablette (vague 3). Base locale, AUDIT_BASE=http://localhost:3228.
import { chromium } from "@playwright/test";
import { BASE, connecter, http, LIGNES, payer } from "../audit/lib.mjs";

const r = await http("POST", "/api/commandes", {
  corps: {
    cle: `nouveautes-${Date.now()}`, mode: "retrait", moyen: "en_ligne", quand: { type: "asap" },
    client: { prenom: "Léa", nom: "Rossi", telephone: `079 555 ${String(Date.now()).slice(-2)} ${String(Date.now()).slice(-4, -2)}`, email: `nouveautes${Date.now()}@laferme.test` },
    allergie: "arachides et fruits à coque", destinataire: { nom: "Marc Dupont", telephone: "078 111 22 33" },
    lignes: [LIGNES.margheritaOptions, LIGNES.lasagne],
  },
});
if (r.status !== 200) throw new Error(`${r.status} ${r.texte}`);
await payer(r.json.redirection.match(/paiement-test\/([0-9a-f-]+)/)[1]);
const nav = await chromium.launch({ channel: "chrome" });
const [nom, valeur] = (await connecter("equipe-bureau@laferme.test")).split("=");
const ctx = await nav.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
await ctx.addCookies([{ name: nom, value: valeur, url: BASE }]);
const page = await ctx.newPage();
await page.goto(`${BASE}/tablette`);
await page.getByRole("button", { name: "Continuer sans son" }).click();
const carte = page.locator(".tab-commande", { hasText: "Allergie : arachides" }).first();
await carte.waitFor();
await carte.scrollIntoViewIfNeeded();
await page.screenshot({ path: "docs/rendus/vague-3/tablette/nouveautes-carte-paysage-1180.png" });
await carte.getByRole("button", { name: /^Accepter pour/ }).click();
await page.getByRole("button", { name: /^En cours/ }).click();
const ligne = page.locator(".tab-ligne", { has: page.locator(".tab-ligne-allergie") }).first();
await ligne.waitFor();
await page.evaluate(() => window.scrollTo(0, 0));
await ligne.scrollIntoViewIfNeeded();
await page.screenshot({ path: "docs/rendus/vague-3/tablette/nouveautes-ligne-paysage-1180.png" });
await page.goto(`${BASE}/tablette/poste/cuisine`);
await page.locator(".poste-allergie").first().waitFor();
await page.locator(".poste-commande", { has: page.locator(".poste-allergie") }).first().scrollIntoViewIfNeeded();
await page.screenshot({ path: "docs/rendus/vague-3/tablette/nouveautes-poste-cuisine-1180.png" });
await nav.close();
console.log("captures faites");
