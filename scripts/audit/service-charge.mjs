// Audit « samedi soir » : service chargé simulé contre l'instance locale (base embarquée, port 3102).
// 30 commandes et plus, pointes de 5 à la fois, deux tablettes, deux fausses imprimantes CloudPRNT,
// panne d'imprimante, pause manuelle puis automatique. Jetable : ne modifie que la base embarquée.
// Lancer : node scripts/audit/service-charge.mjs > sortie.log
import { writeFile } from "node:fs/promises";
import { attendre, commander, connecter, http, journal, LIGNES, noter, payer, resumeMesures, t0 } from "./lib.mjs";

const SORTIE = process.env.AUDIT_SORTIE ?? "resultats-service.json";
const POLL_IMPRIMANTE_MS = Number(process.env.POLL_IMPRIMANTE_MS ?? 2000);
const POLL_TABLETTE_MS = 5000; // pas de Realtime en local : la tablette relit toutes les 5 s
const s = (n) => t0 + n * 1000;
const jusqua = async (n) => {
  const reste = s(n) - Date.now();
  if (reste > 0) await attendre(reste);
};

const etat = {
  fin: false,
  tablettesEnLigne: true,
  imprimantes: { pizza: { enLigne: true, sansConfirmer: false }, cuisine: { enLigne: true, sansConfirmer: false } },
  plans: new Map(), // étiquette → plan de la tablette
  creees: [], // commandes passées par les clients
  vues: new Map(), // id → { premiere: s, etiquette }
  faites: new Set(),
  imprimes: [], // tickets sortis
  pauses: [],
};

// ---------- Préparation ----------
const gerant = await connecter("gerant-bureau@laferme.test");
const tabA = await connecter("equipe-bureau@laferme.test");
const tabB = await connecter("cuisine-bureau@laferme.test");
// Jeudi midi ouvert toute la nuit, pour que l'heure réelle du test tombe pendant un service.
const h = await http("POST", "/api/gestion/service", {
  cookie: gerant,
  corps: { type: "horaire", id: 3, champs: { premiere_heure: "00:15", derniere_heure: "23:50", derniere_commande: "23:30", derniere_commande_pizzas: "23:40" } },
});
noter("horaires", { status: h.status, json: h.json });
const urls = {};
for (const station of ["pizza", "cuisine"]) {
  const r = await http("POST", "/api/gestion/imprimantes", { cookie: gerant, corps: { type: "ajouter", nom: `Audit ${station}`, station } });
  urls[station] = new URL(r.json.url).pathname;
}
noter("imprimantes", { urls: Object.keys(urls) });

// ---------- Fausses imprimantes CloudPRNT ----------
async function imprimante(station, mac) {
  const url = urls[station];
  while (!etat.fin) {
    const e = etat.imprimantes[station];
    if (e.enLigne) {
      const p = await http("POST", url, { entetes: { "X-Star-Mac": mac }, corps: { statusCode: "200%20OK", printerMAC: mac }, nom: "imprimante_post" });
      if (p.json?.jobReady) {
        const jeton = p.json.jobToken;
        const png = await http("GET", `${url}?type=image/png&token=${jeton}&mac=${mac}`, { nom: "imprimante_get_png" });
        const txt = await http("GET", `${url}?type=text/plain&token=${jeton}&mac=${mac}`, { nom: "imprimante_get_texte" });
        const numero = Number(txt.texte.match(/N[^0-9\n]{0,3}(\d{3})/)?.[1] ?? NaN);
        const ticket = { t: Number(((Date.now() - t0) / 1000).toFixed(1)), station, jeton, numero, reimpression: txt.texte.startsWith("REIMPRESSION"), png_octets: png.brut?.length ?? 0, png_status: png.status };
        etat.imprimes.push(ticket);
        noter("ticket", ticket);
        if (e.sansConfirmer) {
          // Panne au milieu du ticket : imprimé, mais la confirmation (DELETE) ne part jamais.
          e.sansConfirmer = false;
          noter("ticket_sans_confirmation", { station, jeton, numero });
        } else {
          await http("DELETE", `${url}?code=200%20OK&token=${jeton}&mac=${mac}`, { nom: "imprimante_delete" });
        }
        continue; // ticket suivant tout de suite (supposé : l'imprimante réinterroge après un ticket)
      }
    }
    await attendre(POLL_IMPRIMANTE_MS);
  }
}

// ---------- Tablettes ----------
const action = (cookie, commande, corps, nom) => http("POST", "/api/tablette/action", { cookie, corps: { commande, ...corps }, nom });

async function deroulerCommande(c) {
  const plan = etat.plans.get(c.client_prenom) ?? "normal";
  const attenteMs = 2000 + Math.random() * 8000;
  await attendre(attenteMs);
  if (plan === "refus") {
    const r = await action(tabA, c.id, { action: "refuser", motif: "Un des plats commandés est épuisé." }, "tablette_refuser");
    noter("refus", { etiquette: c.client_prenom, numero: c.numero, status: r.status, message: r.json?.message, ms: Math.round(r.ms) });
    return;
  }
  if (plan === "course-acc") {
    const [a, b] = await Promise.all([
      action(tabA, c.id, { action: "accepter", heure: c.heure_proposee }, "tablette_accepter"),
      action(tabB, c.id, { action: "accepter", heure: c.heure_proposee }, "tablette_accepter"),
    ]);
    noter("course_double_acceptation", { etiquette: c.client_prenom, numero: c.numero, A: a.status, B: b.status, msgB: b.json?.message ?? a.json?.message });
  } else if (plan === "course-acc-ref") {
    const [a, b] = await Promise.all([
      action(tabA, c.id, { action: "accepter", heure: c.heure_proposee }, "tablette_accepter"),
      action(tabB, c.id, { action: "refuser", motif: "La cuisine est complète pour ce service." }, "tablette_refuser"),
    ]);
    noter("course_accepter_refuser", { etiquette: c.client_prenom, numero: c.numero, accepter: a.status, refuser: b.status, msg: b.json?.message ?? a.json?.message });
    if (a.status !== 200) return;
  } else {
    const r = await action(tabA, c.id, { action: "accepter", heure: c.heure_proposee }, "tablette_accepter");
    noter("acceptee", { etiquette: c.client_prenom, numero: c.numero, status: r.status, ms: Math.round(r.ms) });
    if (r.status !== 200) return;
  }
  if (plan === "annule-apres") {
    await attendre(15000);
    const r = await action(tabA, c.id, { action: "refuser", motif: "Client injoignable, commande annulée." }, "tablette_refuser");
    noter("annulee_apres_acceptation", { etiquette: c.client_prenom, numero: c.numero, status: r.status, message: r.json?.message });
    return;
  }
  if (plan === "laisser") return;
  await attendre(10000);
  await action(tabA, c.id, { action: "statut", vers: "en_preparation" }, "tablette_statut");
  await attendre(15000);
  await action(tabA, c.id, { action: "statut", vers: c.mode === "livraison" ? "partie" : "prete" }, "tablette_statut");
  if (c.statut_paiement === "a_encaisser_retrait") await action(tabA, c.id, { action: "encaisser" }, "tablette_encaisser");
  await attendre(10000);
  const fin = await action(tabA, c.id, { action: "statut", vers: "terminee" }, "tablette_statut");
  noter("terminee", { etiquette: c.client_prenom, numero: c.numero, status: fin.status });
}

let dernierEtatFile = null;
async function tablette(cookie, nom, agit) {
  while (!etat.fin) {
    if (etat.tablettesEnLigne) {
      const r = await http("GET", "/api/tablette/file", { cookie, nom: "tablette_file" });
      if (r.status === 200) {
        if (agit) dernierEtatFile = r.json;
        const aujourdhui = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(new Date());
        for (const c of r.json.commandes) {
          if (!etat.vues.has(c.id)) {
            etat.vues.set(c.id, { premiere: (Date.now() - t0) / 1000, etiquette: c.client_prenom, numero: c.numero });
          }
          const pourPlusTard = c.quand_type === "creneau" && c.quand_date > aujourdhui;
          if (agit && c.statut === "nouvelle" && !pourPlusTard && !etat.faites.has(c.id) && etat.plans.get(c.client_prenom) !== "ignorer") {
            etat.faites.add(c.id);
            deroulerCommande(c).catch((e) => noter("erreur_tablette", { etiquette: c.client_prenom, e: String(e) }));
          }
        }
        if (agit && r.json.reglages?.pause) {
          const p = r.json.reglages.pause;
          const cle = `${p.active}-${p.jusqua}-${p.auto}`;
          if (etat.pauses.at(-1)?.cle !== cle) {
            etat.pauses.push({ cle, t: (Date.now() - t0) / 1000, ...p });
            noter("pause_vue_par_tablette", p);
          }
        }
      } else noter("tablette_erreur", { nom, status: r.status });
    }
    await attendre(POLL_TABLETTE_MS);
  }
}

// ---------- Clients ----------
let n = 0;
const etiquette = () => `C${String(++n).padStart(2, "0")}`;
async function client(options, plan = "normal", { payerApresMs = 1500, issue = "paye" } = {}) {
  const e = etiquette();
  etat.plans.set(e, plan);
  const r = await commander({ etiquette: e, ...options });
  const info = { etiquette: e, plan, mode: options.mode ?? "retrait", moyen: options.moyen ?? "comptoir", t: (Date.now() - t0) / 1000, status: r.status, erreur: r.erreur, ms: Math.round(r.ms), quand: options.quand ?? { type: "asap" } };
  etat.creees.push(info);
  noter("commande", info);
  if (r.idPaiement) {
    info.id = r.idPaiement;
    (async () => {
      await attendre(payerApresMs);
      const p = await payer(r.idPaiement, issue);
      info.paiement = { issue, status: p.status, t: (Date.now() - t0) / 1000 };
      noter("paiement", { etiquette: e, issue, status: p.status });
    })();
  }
  return info;
}
const melange = (i) => {
  const types = [
    { mode: "retrait", moyen: "comptoir", lignes: [LIGNES.margheritaOptions, LIGNES.lasagne] },
    { mode: "livraison", moyen: "en_ligne", lignes: [LIGNES.margherita, LIGNES.prosciutto, LIGNES.pesto] },
    { mode: "retrait", moyen: "en_ligne", lignes: [LIGNES.prosciutto] },
    { mode: "livraison", moyen: "en_ligne", lignes: [LIGNES.gambas, LIGNES.chevre] },
    { mode: "retrait", moyen: "comptoir", lignes: [LIGNES.pesto, LIGNES.margherita] },
  ];
  return types[i % types.length];
};
const cuisine = (i) =>
  [
    { mode: "retrait", moyen: "comptoir", lignes: [LIGNES.pesto, LIGNES.margherita] },
    { mode: "livraison", moyen: "en_ligne", lignes: [LIGNES.gambas, LIGNES.chevre] },
  ][i % 2];

// Essai de commande pour savoir si le site accepte (pause ou non) : une commande comptoir qui, acceptée, est refusée ensuite.
async function sonde(libelle) {
  const info = await client({ mode: "retrait", moyen: "comptoir", lignes: [LIGNES.margherita] }, "refus");
  noter("sonde", { libelle, status: info.status, erreur: info.erreur });
  return info.status === 200;
}

const boucles = [imprimante("pizza", "00:11:62:aa:00:01"), imprimante("cuisine", "00:11:62:aa:00:02"), tablette(tabA, "A", true), tablette(tabB, "B", false)];

// ---------- Déroulé ----------
for (let i = 0; i < 8; i++) {
  await jusqua(10 + i * 12);
  await client(melange(i));
}
// Pointe : 5 commandes à la même seconde.
await jusqua(130);
noter("pointe", { n: 5 });
await Promise.all([0, 1, 2, 3, 4].map((i) => client(melange(i + 1))));
// Courses entre deux tablettes.
await jusqua(150);
for (const plan of ["course-acc", "course-acc", "course-acc", "course-acc-ref", "course-acc-ref"]) await client({ mode: "retrait", moyen: "en_ligne", lignes: [LIGNES.margherita, LIGNES.pesto] }, plan);
// Rupture en plein service : une commande en cours de paiement, une autre après.
await jusqua(190);
await client({ mode: "retrait", moyen: "en_ligne", lignes: [LIGNES.lasagne] }, "normal", { payerApresMs: 40_000 });
await jusqua(200);
const rup = await http("POST", "/api/tablette/plats", { cookie: tabA, corps: { slug: "lasagne-de-boeuf", rupture: true }, nom: "tablette_rupture" });
noter("rupture", { status: rup.status });
await jusqua(205);
await client({ mode: "retrait", moyen: "comptoir", lignes: [LIGNES.lasagne] });
// Imprimante cuisine hors ligne pendant 10 commandes, et une imprimante pizza qui plante au milieu d'un ticket.
await jusqua(240);
etat.imprimantes.cuisine.enLigne = false;
noter("imprimante_hors_ligne", { station: "cuisine" });
for (let i = 0; i < 5; i++) {
  await jusqua(250 + i * 10);
  await client(cuisine(i), i === 2 ? "annule-apres" : "normal");
  if (i === 1) etat.imprimantes.pizza.sansConfirmer = true;
}
await jusqua(320);
noter("pointe", { n: 5, cuisine_hors_ligne: true });
await Promise.all([0, 1, 2, 3, 4].map((i) => client(cuisine(i))));
await jusqua(430);
etat.imprimantes.cuisine.enLigne = true;
noter("imprimante_retour", { station: "cuisine" });
// Commandes à l'avance au même créneau (aujourd'hui 23h00) et pour samedi.
await jusqua(470);
const aujourdhui = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(new Date());
for (let i = 0; i < 8; i++) {
  await client({ ...(i % 2 ? { mode: "livraison", moyen: "en_ligne", lignes: [LIGNES.margherita, LIGNES.prosciutto] } : { mode: "retrait", moyen: "comptoir", lignes: [LIGNES.margherita] }), quand: { type: "creneau", date: aujourdhui, minutes: 23 * 60 } }, "laisser");
}
for (let i = 0; i < 2; i++) await client({ mode: "retrait", moyen: "comptoir", lignes: [LIGNES.margherita], quand: { type: "creneau", date: "2026-11-14", minutes: 19 * 60 + 30 } });
// Pause manuelle de 15 minutes.
await jusqua(520);
const p15 = await http("POST", "/api/tablette/reglages", { cookie: tabA, corps: { pause: 15 }, nom: "tablette_pause" });
noter("pause_manuelle", { status: p15.status, minutes: 15 });
await jusqua(525);
await sonde("pendant la pause de 15 min");
await jusqua(1430);
await sonde("pause de 15 min expirée");
for (let i = 0; i < 2; i++) await client(melange(i));
// Tablettes coupées 5 minutes (réseau) : la surveillance doit mettre en pause après 3 minutes.
await jusqua(1460);
await client({ mode: "retrait", moyen: "comptoir", lignes: [LIGNES.margherita] }, "normal");
etat.tablettesEnLigne = false;
noter("tablettes_hors_ligne", { duree_s: 300, apres_pause_datee_expiree: true });
for (let k = 1; k <= 5; k++) {
  await jusqua(1460 + k * 60);
  await sonde(`tablettes muettes depuis ${k} min (après une pause datée expirée)`);
}
await jusqua(1760);
etat.tablettesEnLigne = true;
noter("tablettes_retour", {});
await jusqua(1775);
const rep1 = await http("POST", "/api/tablette/reglages", { cookie: tabA, corps: { pause: "reprendre" }, nom: "tablette_pause" });
noter("reprendre", { status: rep1.status });
// Témoin : même coupure, mais la pause est « null » (reprise à la main avant).
await jusqua(1790);
etat.tablettesEnLigne = false;
noter("tablettes_hors_ligne", { duree_s: 240, apres_reprise: true });
for (let k = 1; k <= 4; k++) {
  await jusqua(1790 + k * 60);
  await sonde(`tablettes muettes depuis ${k} min (après reprise)`);
}
await jusqua(2030);
etat.tablettesEnLigne = true;
noter("tablettes_retour", {});
await jusqua(2045);
const rep2 = await http("POST", "/api/tablette/reglages", { cookie: tabA, corps: { pause: "reprendre" }, nom: "tablette_pause" });
noter("reprendre", { status: rep2.status });
// Dernières commandes du service.
for (let i = 0; i < 4; i++) {
  await jusqua(2060 + i * 8);
  await client(melange(i + 2));
}
// Réimpression d'une commande déjà imprimée.
await jusqua(2100);
const dejaImprimee = dernierEtatFile?.commandes.find((c) => ["prete", "partie", "terminee", "en_preparation"].includes(c.statut));
if (dejaImprimee) {
  const r = await action(tabA, dejaImprimee.id, { action: "reimprimer" }, "tablette_reimprimer");
  noter("reimpression", { numero: dejaImprimee.numero, status: r.status, message: r.json?.message });
}
await jusqua(2200);
etat.fin = true;
await Promise.allSettled(boucles);

// ---------- Bilan ----------
const final = await http("GET", "/api/tablette/file", { cookie: gerant });
const commandes = final.json.commandes;
const taches = final.json.impression.taches;
const numeros = commandes.map((c) => c.numero).sort((a, b) => a - b);
const doublons = numeros.filter((x, i) => numeros.indexOf(x) !== i);
const parCommande = {};
for (const t of etat.imprimes) {
  const k = `${t.numero}-${t.station}`;
  parCommande[k] = (parCommande[k] ?? 0) + 1;
}
const resultat = {
  debut: new Date(t0).toISOString(),
  duree_s: (Date.now() - t0) / 1000,
  poll_imprimante_ms: POLL_IMPRIMANTE_MS,
  clients: etat.creees,
  commandes_tablette: commandes.map((c) => ({ etiquette: c.client_prenom, numero: c.numero, statut: c.statut, paiement: c.statut_paiement, mode: c.mode, quand: c.quand_type === "creneau" ? `${c.quand_date} ${c.quand_minutes}` : "asap", heure_confirmee: c.heure_confirmee, lignes: c.lignes.map((l) => `${l.qte} ${l.nom} [${l.station}] ${l.details.join(" / ")}`) })),
  numeros,
  doublons_numeros: doublons,
  vues: [...etat.vues.values()],
  tickets: etat.imprimes,
  tickets_par_commande_poste: parCommande,
  taches: taches.map((t) => ({ commande: commandes.find((c) => c.id === t.commande_id)?.numero, station: t.station, etat: t.etat, reimpression: t.reimpression, tentatives: t.tentatives })),
  pauses: etat.pauses,
  reglages_final: final.json.reglages,
  mesures: resumeMesures(),
  journal,
};
await writeFile(SORTIE, JSON.stringify(resultat, null, 2));
noter("fin", { sortie: SORTIE, commandes: commandes.length, tickets: etat.imprimes.length });
process.exit(0);
