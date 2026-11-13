// Rush de la tablette (vague 3) : remplit la base embarquée comme un vendredi à 19h30 et le décrit en JSON.
// 6 commandes à accepter, 15 en cours (acceptées, en préparation, prêtes, parties), 3 pour demain, 10 terminées.
// Jetable, local seulement : AUDIT_BASE=http://localhost:3228 node scripts/tablette/rush.mjs
import { BASE, commander, connecter, http, LIGNES, payer } from "../audit/lib.mjs";

const gerant = await connecter("gerant-bureau@laferme.test");
const tab = await connecter("equipe-bureau@laferme.test");

// Tous les services d'aujourd'hui et de demain ouverts toute la journée : l'heure réelle du test peut tomber le matin.
const zurich = (d) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(d);
const jourIso = (d) => ((x) => (x === 0 ? 7 : x))(new Date(`${zurich(d)}T12:00:00Z`).getUTCDay());
const service = await http("GET", "/api/gestion/service", { cookie: gerant });
const demain = new Date(Date.now() + 86_400_000);
for (const d of [new Date(), demain])
  for (const h of service.json.horaires.filter((x) => x.jour === jourIso(d)))
    await http("POST", "/api/gestion/service", {
      cookie: gerant,
      corps: { type: "horaire", id: h.id, champs: { premiere_heure: "00:15", derniere_heure: "23:50", derniere_commande: "23:30", derniere_commande_pizzas: "23:40" } },
    });
for (const [nom, station] of [["Pizza", "pizza"], ["Cuisine", "cuisine"]]) await http("POST", "/api/gestion/imprimantes", { cookie: gerant, corps: { type: "ajouter", nom, station } });

const PRENOMS = ["Léa", "Marco", "Inès", "Paolo", "Chloé", "Yann", "Sofia", "Luca", "Emma", "Noah", "Zoé", "Hugo", "Mila", "Enzo", "Lina", "Tom", "Nora", "Elio", "Jade", "Rémi", "Alba", "Gino", "Iris", "Théo", "Maya", "Sami", "Rose", "Dario", "Lou", "Nils", "Anna", "Ugo", "Clara", "Milo"];
const PANIERS = [
  [LIGNES.margherita, LIGNES.prosciutto],
  [LIGNES.margheritaOptions],
  [LIGNES.lasagne, LIGNES.chevre],
  [LIGNES.pesto, LIGNES.margherita],
  [{ ...LIGNES.margherita, qte: 3 }, LIGNES.gambas],
  [LIGNES.prosciutto, LIGNES.lasagne, LIGNES.chevre],
];
let n = 0;
async function passer(mode, quand = { type: "asap" }) {
  const prenom = PRENOMS[n % PRENOMS.length];
  const lignes = PANIERS[n % PANIERS.length];
  n += 1;
  const moyen = mode === "livraison" || n % 3 === 0 ? "en_ligne" : "comptoir";
  const r = await commander({ etiquette: prenom, mode, moyen, lignes, quand });
  if (r.status !== 200) throw new Error(`Commande ${prenom} refusée : ${r.status} ${r.erreur}`);
  if (r.idPaiement) await payer(r.idPaiement);
  return prenom;
}
const file = async () => (await http("GET", "/api/tablette/file", { cookie: tab })).json.commandes;
const agir = (c, corps) => http("POST", "/api/tablette/action", { cookie: tab, corps: { commande: c.id, ...corps } });
const deCe = async (prenom) => (await file()).find((c) => c.client_prenom === prenom);

// Dans l'ordre de leur arrivée : les plus anciennes sont les plus avancées.
const plan = [
  ...Array.from({ length: 10 }, (_, i) => ({ mode: i % 2 ? "livraison" : "retrait", fin: "terminee" })),
  ...Array.from({ length: 2 }, () => ({ mode: "livraison", fin: "partie" })),
  ...Array.from({ length: 3 }, () => ({ mode: "retrait", fin: "prete" })),
  ...Array.from({ length: 4 }, (_, i) => ({ mode: i % 2 ? "livraison" : "retrait", fin: "en_preparation" })),
  ...Array.from({ length: 6 }, (_, i) => ({ mode: i % 3 === 0 ? "livraison" : "retrait", fin: "acceptee" })),
  ...Array.from({ length: 3 }, (_, i) => ({ mode: i % 2 ? "livraison" : "retrait", fin: "demain" })),
  ...Array.from({ length: 6 }, (_, i) => ({ mode: i % 2 ? "livraison" : "retrait", fin: "nouvelle" })),
];
const resume = {};
for (const p of plan) {
  const quand = p.fin === "demain" ? { type: "creneau", date: zurich(demain), minutes: 19 * 60 + 30 } : { type: "asap" };
  const prenom = await passer(p.mode, quand);
  resume[p.fin] = (resume[p.fin] ?? 0) + 1;
  if (p.fin === "nouvelle" || p.fin === "demain") continue;
  const c = await deCe(prenom);
  await agir(c, { action: "accepter", heure: c.heure_proposee, de: "nouvelle" });
  if (p.fin === "acceptee") continue;
  await agir(c, { action: "statut", vers: "en_preparation", de: "acceptee" });
  if (p.fin === "en_preparation") continue;
  const prete = p.mode === "livraison" ? "partie" : "prete";
  await agir(c, { action: "statut", vers: prete, de: "en_preparation" });
  if (p.fin !== "terminee") continue;
  if (c.statut_paiement === "a_encaisser_retrait") await agir(c, { action: "retiree_payee" });
  else await agir(c, { action: "statut", vers: "terminee", de: prete });
}
// Deux commandes en préparation promises dans une minute : deux minutes plus tard, elles sont en retard.
// (Une heure passée est refusée par le serveur.) Mesurer après : node scripts/tablette/mesurer.mjs, 2 min plus tard.
const enPrep = (await file()).filter((c) => c.statut === "en_preparation").slice(0, 2);
for (const c of enPrep) {
  const r = await agir(c, { action: "heure", heure: new Date(Date.now() + 60_000).toISOString() });
  if (r.status !== 200) console.error(`Heure refusée pour ${c.numero} : ${r.status} ${r.texte}`);
}
const f = await file();
console.log(JSON.stringify({ base: BASE, plan: resume, file: f.length, statuts: f.reduce((a, c) => ({ ...a, [c.statut]: (a[c.statut] ?? 0) + 1 }), {}) }));
