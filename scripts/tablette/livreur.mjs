// Captures de la page livreur (vague 3) : tournée de trois arrêts donnée à Marco, téléphone de 375 et 320 px.
// Base locale après scripts/tablette/rush.mjs, AUDIT_BASE=http://localhost:3228.
import { chromium, devices } from "@playwright/test";
import { BASE, connecter, http } from "../audit/lib.mjs";

const tab = await connecter(process.env.COMPTE ?? "equipe-bureau@laferme.test");
const etat = (await http("GET", "/api/tablette/livraisons", { cookie: tab })).json;
const marco = etat.livreurs.find((l) => l.nom === "Marco");
const dejaDonnees = new Set(etat.livraisons.map((l) => l.commande_id));
const file = (await http("GET", "/api/tablette/file", { cookie: tab })).json.commandes;
const libres = file.filter((c) => c.mode === "livraison" && ["acceptee", "en_preparation"].includes(c.statut) && !dejaDonnees.has(c.id)).slice(0, 3);
for (const c of libres) await http("POST", "/api/tablette/livraisons", { cookie: tab, corps: { action: "attribuer", commande: c.id, livreur: marco.id } });
console.log("attribuées", libres.length);
const [nom, valeur] = (await connecter("marco@laferme.test")).split("=");
const nav = await chromium.launch({ channel: "chrome" });
for (const [vue, largeur] of [["375", 375], ["320", 320]]) {
  const ctx = await nav.newContext({ ...devices["iPhone 13"], viewport: { width: largeur, height: 740 } });
  await ctx.addCookies([{ name: nom, value: valeur, url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/livreur`);
  await page.locator(".liv-arret").first().waitFor();
  await page.screenshot({ path: `docs/rendus/vague-3/tablette/livreur-${vue}.png` });
  await page.screenshot({ path: `docs/rendus/vague-3/tablette/livreur-${vue}-entier.png`, fullPage: true });
  // En route : « Je pars avec les 3 », puis l'arrêt en cours seul ouvert et ses gestes sous le pouce.
  if (vue === "375") {
    await page.getByRole("button", { name: /^Je pars avec les/ }).click();
    await page.locator(".liv-pouce").waitFor();
    await page.getByText("Envoi en cours…").waitFor({ state: "detached" }).catch(() => undefined);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `docs/rendus/vague-3/tablette/livreur-${vue}-en-route.png` });
  }
  await ctx.close();
}
await nav.close();
