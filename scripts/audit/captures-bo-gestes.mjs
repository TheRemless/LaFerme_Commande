// Captures des gestes « pour la prochaine fois » (vague 3, bo-commandes) : plat offert et réduction proposés
// avant le remboursement. Les réglages D3 et codes promo restent éteints en base : ils sont allumés dans la
// seule réponse de la fiche (rendu), et le code affiché est un exemple. Instance locale, jeu de rush :
//   BASE_LOCALE_INSTANTANE=$PWD/.pglite/rush.tar.gz npx next dev -p 3222
//   AUDIT_BASE=http://localhost:3222 node scripts/audit/captures-bo-gestes.mjs docs/rendus/vague-3/bo-commandes
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { BASE, attendre, connecter, http } from "./lib.mjs";

if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) throw new Error(`Refusé hors instance locale : ${BASE}`);
const [dossier = "captures"] = process.argv.slice(2);
await mkdir(dossier, { recursive: true });
const gerant = await connecter("gerant.rush@exemple.test");
const [nom, valeur] = gerant.split("=");
const meilleurs = await http("POST", "/api/gestion/clients", { cookie: gerant, corps: { action: "liste", tri: "depense", page: 1, par_page: 10 } });
const client = await http("POST", "/api/gestion/clients", { cookie: gerant, corps: { action: "fiche", email: meilleurs.json.lignes[1].email } });
const ouverte = await http("POST", "/api/gestion/reclamations", {
  cookie: gerant,
  corps: { action: "ouvrir", commande_id: client.json.commandes_liste[0].id, type: "froid", source: "telephone", description: "Les pizzas sont arrivées tièdes. Le client a appelé à 20h50." },
});
const id = ouverte.json.id;
const navigateur = await chromium.launch({ channel: "chrome" });

for (const [l, h] of [[1440, 900], [375, 812]]) {
  for (const apres of [false, true]) {
    const contexte = await navigateur.newContext({ viewport: { width: l, height: h }, hasTouch: l < 1100 });
    await contexte.addCookies([{ name: nom, value: valeur, url: BASE }]);
    const p = await contexte.newPage();
    await p.route("**/api/gestion/reclamations", async (r) => {
      const corps = JSON.parse(r.request().postData() ?? "{}");
      if (corps.action !== "fiche") return r.continue();
      const vraie = await (await r.fetch()).json();
      const exemple = apres
        ? { geste: "reduction", statut: "en_cours", geste_detail: "CHF 10.00 sur la prochaine commande, code LAFERME-3F9A21C4",
            code: { code: "LAFERME-3F9A21C4", type: "montant", valeur: 1000, actif: true, utilise_commande: null } }
        : {};
      await r.fulfill({ json: { ...vraie, gestes_actifs: true, codes_actifs: true, ...exemple } });
    });
    await p.addInitScript((c) => sessionStorage.setItem("laferme.gestion.ouvrir", JSON.stringify({ type: "reclamation", cle: c, le: Date.now() })), id);
    await p.goto(`${BASE}/gestion/clients`);
    const fiche = p.getByRole("dialog");
    await fiche.getByText("Les pizzas sont arrivées tièdes.", { exact: false }).waitFor();
    if (!apres) {
      await fiche.getByLabel("Geste pour le client").selectOption("reduction");
      await fiche.getByLabel("Réduction en").selectOption("montant");
      await fiche.getByLabel("Montant en CHF").fill("10");
      await fiche.getByLabel("Geste pour le client").scrollIntoViewIfNeeded();
    }
    await attendre(400);
    await p.screenshot({ path: `${dossier}/gestes-${apres ? "code" : "reduction"}-${l}.jpg`, quality: 80, fullPage: l === 375 });
    await contexte.close();
  }
}
await navigateur.close();
console.log("Captures écrites dans", dossier);
