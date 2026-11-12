// Vérification de bout en bout des correctifs « samedi soir » contre l'instance locale : faux client
// CloudPRNT, annulation après acceptation, renvoi d'un ticket non confirmé, capacité par créneau,
// deux tablettes au même instant. node scripts/audit/verifier-correctifs.mjs
import { attendre, commander, connecter, http, LIGNES } from "./lib.mjs";

const bilan = {};
const gerant = await connecter("gerant-mobile@laferme.test");
const tabA = await connecter("equipe-mobile@laferme.test");
const tabB = await connecter("cuisine-bureau@laferme.test");
const urls = {};
for (const station of ["pizza", "cuisine"]) {
  const r = await http("POST", "/api/gestion/imprimantes", { cookie: gerant, corps: { type: "ajouter", nom: `Vérif ${station}`, station } });
  urls[station] = new URL(r.json.url).pathname;
}
const MAC = { pizza: "00:11:62:bb:00:01", cuisine: "00:11:62:bb:00:02" };
async function poll(station, { confirmer = true } = {}) {
  const p = await http("POST", urls[station], { entetes: { "X-Star-Mac": MAC[station] }, corps: { statusCode: "200%20OK", printerMAC: MAC[station] } });
  if (!p.json?.jobReady) return null;
  const t = await http("GET", `${urls[station]}?type=text/plain&token=${p.json.jobToken}&mac=${MAC[station]}`);
  if (confirmer) await http("DELETE", `${urls[station]}?code=200%20OK&token=${p.json.jobToken}&mac=${MAC[station]}`);
  return t.texte;
}
// Les deux imprimantes se lient à leur MAC et vident ce qui traîne.
for (const s of ["pizza", "cuisine"]) while (await poll(s));
const file = async (cookie = tabA) => (await http("GET", "/api/tablette/file", { cookie })).json.commandes;
const trouver = async (prenom) => (await file()).find((c) => c.client_prenom === prenom);
const action = (cookie, commande, corps) => http("POST", "/api/tablette/action", { cookie, corps: { commande, ...corps } });

// SS-03 : acceptée, ticket pizza sorti, cuisine débranchée, puis annulée.
await commander({ etiquette: "Annule", lignes: [LIGNES.margherita, LIGNES.pesto] });
const a = await trouver("Annule");
await action(tabA, a.id, { action: "accepter", heure: a.heure_proposee, de: "nouvelle" });
const ticketPizza = await poll("pizza");
const refus = await action(tabA, a.id, { action: "refuser", motif: "Client injoignable.", de: "acceptee" });
const apresPizza = await poll("pizza");
const apresCuisine = await poll("cuisine");
bilan.SS03 = { pizza_imprime: Boolean(ticketPizza), refus: refus.json, annonce_pizza: apresPizza?.split("\n").slice(0, 3), cuisine_apres: apresCuisine };

// SS-07 : ticket téléchargé sans confirmation, renvoyé avec la mention (attente de 2 min 5 s).
await commander({ etiquette: "Renvoi", lignes: [LIGNES.margherita] });
const r = await trouver("Renvoi");
await action(tabA, r.id, { action: "accepter", heure: r.heure_proposee, de: "nouvelle" });
const premier = await poll("pizza", { confirmer: false });
await attendre(125_000);
const second = await poll("pizza");
bilan.SS07 = { premier: premier?.split("\n")[0], second: second?.split("\n")[0] };

// SS-06 : tablette A accepte, tablette B refuse, au même instant.
await commander({ etiquette: "Course", lignes: [LIGNES.margherita] });
const c = await trouver("Course");
const [acc, ref] = await Promise.all([
  action(tabA, c.id, { action: "accepter", heure: c.heure_proposee, de: "nouvelle" }),
  action(tabB, c.id, { action: "refuser", motif: "La cuisine est complète pour ce service.", de: "nouvelle" }),
]);
bilan.SS06 = { accepter: acc.status, refuser: ref.status, message: ref.json?.message ?? acc.json?.message };
for (const s of ["pizza", "cuisine"]) while (await poll(s));

// SS-02 : capacité des retraits au même créneau (valeur en base).
const aujourdhui = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(new Date());
const statuts = [];
for (let i = 0; i < 6; i++) {
  const o = await commander({ etiquette: `Cap${i}`, lignes: [LIGNES.margherita], quand: { type: "creneau", date: aujourdhui, minutes: 23 * 60 } });
  statuts.push(o.status === 200 ? 200 : `${o.status} ${o.erreur}`);
}
bilan.SS02 = statuts;
console.log(JSON.stringify(bilan, null, 2));
