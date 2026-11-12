// Captures avant et après de l'impression des commandes à l'avance (SS-11, G08) sur la tablette : commande
// acceptée pour demain soir, commande à accepter pour demain, commande acceptée pour ce soir.
// AUDIT_BASE=http://localhost:3110 node scripts/audit/captures-avance.mjs <dossier> <prefixe>
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { BASE, attendre, commander, connecter, http, LIGNES, payer } from "./lib.mjs";

const [dossier = "captures", prefixe = "apres"] = process.argv.slice(2);
await mkdir(dossier, { recursive: true });
const gerant = await connecter("gerant-bureau@laferme.test");
const tab = await connecter("equipe-bureau@laferme.test");

// Services ouverts toute la journée aujourd'hui et demain (l'heure réelle du test tombe la nuit à Genève).
const zurich = (d) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(d);
const jourIso = (d) => ((x) => (x === 0 ? 7 : x))(new Date(`${zurich(d)}T12:00:00Z`).getUTCDay());
const service = await http("GET", "/api/gestion/service", { cookie: gerant });
const auj = new Date();
const demain = new Date(Date.now() + 86_400_000);
for (const d of [auj, demain]) {
  const h = service.json.horaires.find((x) => x.jour === jourIso(d));
  if (h)
    await http("POST", "/api/gestion/service", {
      cookie: gerant,
      corps: {
        type: "horaire",
        id: h.id,
        champs: {
          premiere_heure: "00:15",
          derniere_heure: "23:50",
          derniere_commande: "23:30",
          derniere_commande_pizzas: "23:40",
        },
      },
    });
}
await http("POST", "/api/gestion/imprimantes", {
  cookie: gerant,
  corps: { type: "ajouter", nom: "Pizza", station: "pizza" },
});
await http("POST", "/api/gestion/imprimantes", {
  cookie: gerant,
  corps: { type: "ajouter", nom: "Cuisine", station: "cuisine" },
});

const file = async () => (await http("GET", "/api/tablette/file", { cookie: tab })).json.commandes;
const action = (commande, corps) =>
  http("POST", "/api/tablette/action", {
    cookie: tab,
    corps: { commande, ...corps },
  });
const trouver = async (prenom) => (await file()).find((c) => c.client_prenom === prenom);
// Payées en ligne (doublure locale) : le comptoir est limité à deux commandes en attente par client.
const passer = async (etiquette, lignes, quand) => {
  const o = await commander({
    etiquette,
    mode: "retrait",
    moyen: "en_ligne",
    lignes,
    quand,
  });
  if (!o.idPaiement) throw new Error(`Commande ${etiquette} : ${o.status} ${o.erreur}`);
  await payer(o.idPaiement, "paye");
};

const demainIso = zurich(demain);
const aujIso = zurich(auj);
await passer("Demain", [LIGNES.margherita, LIGNES.pesto], {
  type: "creneau",
  date: demainIso,
  minutes: 19 * 60 + 30,
});
const a = await trouver("Demain");
const accepte = await action(a.id, {
  action: "accepter",
  heure: a.heure_proposee,
  de: "nouvelle",
});
await passer("Samuel", [LIGNES.prosciutto], {
  type: "creneau",
  date: demainIso,
  minutes: 20 * 60,
});
await passer("Soir", [LIGNES.margherita], {
  type: "creneau",
  date: aujIso,
  minutes: 23 * 60,
});
const s = await trouver("Soir");
await action(s.id, {
  action: "accepter",
  heure: s.heure_proposee,
  de: "nouvelle",
});

const [nom, valeur] = tab.split("=");
const navigateur = await chromium.launch({ channel: "chrome" });
for (const [vue, taille] of [
  ["bureau", { width: 1180, height: 900 }],
  ["mobile", { width: 390, height: 844 }],
]) {
  const contexte = await navigateur.newContext({ viewport: taille });
  await contexte.addCookies([{ name: nom, value: valeur, url: BASE }]);
  const page = await contexte.newPage();
  await page.goto(`${BASE}/tablette`);
  await page.getByRole("button", { name: "Continuer sans son" }).click();
  await page.getByText("Chargement…").waitFor({ state: "detached", timeout: 120_000 });
  await page.getByRole("button", { name: /^À l'avance/ }).click();
  await attendre(800);
  await page.screenshot({
    path: `${dossier}/${prefixe}-avance-${vue}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: /^En cours/ }).click();
  await attendre(500);
  await page.screenshot({
    path: `${dossier}/${prefixe}-en-cours-${vue}.png`,
    fullPage: true,
  });
  await contexte.close();
}
await navigateur.close();
console.log(JSON.stringify({ accepte: accepte.json, demain: demainIso, soir: aujIso }));
