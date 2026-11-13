// Envoi d'essai réel des e-mails du site vers UNE adresse (accord de Jérémy du 13.11.2026, transmis par le chef).
// Lancé par Jérémy sur son Mac, quand le chef le dit. Procédure : docs/vague-3/client-compte.md, « Envoi d'essai ».
//
// Sans --envoyer : affiche la liste des e-mails, n'envoie rien. Avec --envoyer : envoie chaque e-mail par le
// SMTP d'Infomaniak (SMTP_UTILISATEUR, SMTP_MOT_DE_PASSE, COURRIEL_EXPEDITEUR tapés dans le terminal de
// Jérémy, jamais écrits dans un fichier ni dans une conversation).
// Aucune vraie base : refus si une variable mène à Supabase. Les plats et les prix viennent de la base
// embarquée (seed), la commande est fictive (n° 37) : ses liens de suivi mènent à « commande introuvable ».

import { creerBaseLocale } from "../src/lib/db/locale";
import type { Commande } from "../src/lib/db/serveur";
import { refusHorsBaseEmbarquee } from "./rush/garde";

const args = process.argv.slice(2);
const destinataire = args.find((a) => !a.startsWith("--"));
const envoyer = args.includes("--envoyer");
const etapes = args.includes("--etapes");
const origine = (args.find((a) => a.startsWith("--origine="))?.slice("--origine=".length) ?? process.env.ADRESSE_SITE ?? "").replace(/\/$/, "");

function arreter(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!destinataire || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destinataire)) {
  arreter("Usage : npm run courriels:essai -- <adresse e-mail> --origine=https://<site> [--etapes] [--envoyer]");
}
if (!/^https:\/\/[^/\s]+$/.test(origine)) {
  arreter("Donnez l'adresse publique du site (--origine=https://…) : le logo des e-mails est chargé depuis là.");
}
if (refusHorsBaseEmbarquee(process.env)) {
  arreter("Essai refusé : une variable mène à une vraie base (Supabase, Postgres ou Netlify). Relancer dans un terminal sans ces variables.");
}
process.env.CONTEXTE_DEPLOIEMENT = "local";

const db = await creerBaseLocale();
const plat = async (station: string) =>
  (await db.query<{ slug: string; nom: string; prix_centimes: number }>("select slug, nom, prix_centimes from plats where station = $1 order by slug limit 1", [station])).rows[0];
const pizza = await plat("pizza");
const cuisine = await plat("cuisine");
const taux = Number((await db.query<{ valeur: unknown }>("select valeur from reglages where cle = 'tva_emporter_pourcent'")).rows[0]?.valeur);
const frais = (await db.query<{ frais_centimes: number }>("select frais_centimes from zones_livraison order by numero limit 1")).rows[0]?.frais_centimes;
if (!pizza || !cuisine || !Number.isFinite(taux) || frais === undefined) arreter("Base embarquée incomplète : plats, TVA ou zone manquants.");

const sousTotal = pizza.prix_centimes * 2 + cuisine.prix_centimes;
function commande(mode: "livraison" | "retrait", moyen: "en_ligne" | "comptoir"): Commande {
  const total = sousTotal + (mode === "livraison" ? frais : 0);
  return {
    id: "00000000-0000-0000-0000-000000000037",
    numero: 37,
    jour: new Date().toISOString().slice(0, 10),
    jeton_suivi: "essai-sans-commande",
    mode,
    statut: "nouvelle",
    statut_paiement: moyen === "en_ligne" ? "paye" : "a_encaisser_retrait",
    moyen_paiement: moyen,
    client_prenom: "Essai",
    client_nom: "La Ferme",
    client_telephone: "079 000 00 00",
    client_email: destinataire!,
    adresse: mode === "livraison" ? { rue: "Route de Chancy", numero: "132", npa: "1213", localite: "Onex" } : null,
    details_livraison: mode === "livraison" ? { etage: "1", sonnette: "Essai", code: "", instructions: "" } : null,
    quand_type: "asap",
    quand_date: null,
    quand_minutes: null,
    heure_confirmee: new Date(Date.now() + 40 * 60_000).toISOString(),
    zone_numero: mode === "livraison" ? 1 : null,
    pizzas_seulement: false,
    avertissement: null,
    sous_total_centimes: sousTotal,
    frais_centimes: mode === "livraison" ? frais : 0,
    total_centimes: total,
    tva_centimes: Math.round((total * taux) / (100 + taux)),
    taux_tva_pourcent: taux,
    stripe_session_id: null,
    stripe_payment_intent: null,
    motif: null,
    compte_id: null,
    compte_demande: false,
    allergie: "Essai d'allergie",
    origine,
    cree_le: new Date().toISOString(),
    lignes: [
      { position: 0, plat_slug: pizza.slug, nom: pizza.nom, station: "pizza", qte: 2, unitaire_centimes: pizza.prix_centimes, total_centimes: pizza.prix_centimes * 2, choix: {}, retraits: [], note: "" },
      { position: 1, plat_slug: cuisine.slug, nom: cuisine.nom, station: "cuisine", qte: 1, unitaire_centimes: cuisine.prix_centimes, total_centimes: cuisine.prix_centimes, choix: {}, retraits: [], note: "" },
    ],
  };
}

const m = await import("../src/lib/courriel/modeles");
const livraison = commande("livraison", "en_ligne");
const retrait = commande("retrait", "comptoir");
const dans = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
const MOTIF = "Motif d'essai, écrit par l'équipe au moment du refus.";

const liste: { nom: string; courriel: { sujet: string; texte: string; html: string } }[] = [
  { nom: "Confirmation, livraison payée en ligne, allergie signalée", courriel: m.courrielConfirmation(livraison, null) },
  { nom: "Confirmation, à emporter, à payer au comptoir", courriel: m.courrielConfirmation({ ...retrait, allergie: "" }, null) },
  { nom: "Nouvelle heure", courriel: m.courrielNouvelleHeure(livraison, dans(55)) },
  { nom: "Refus, remboursement en cours", courriel: m.courrielRefusRemboursementEnCours(livraison, MOTIF) },
  { nom: "Refus, remboursé", courriel: m.courrielRemboursement(livraison, MOTIF) },
  { nom: "Refus, rien à rembourser (comptoir)", courriel: m.courrielRefus(retrait, MOTIF) },
  { nom: "Remboursement après la remise", courriel: m.courrielRemboursementGeste(livraison, pizza.prix_centimes, MOTIF) },
  { nom: "Plat manquant, remboursé", courriel: m.courrielManque(livraison, cuisine.nom.toLowerCase(), cuisine.prix_centimes, "stripe", livraison.total_centimes - cuisine.prix_centimes) },
  { nom: "Commande modifiée par l'équipe", courriel: m.courrielModification(livraison, ["adresse", "client_telephone"]) },
  { nom: "Livraison non remise, client absent", courriel: m.courrielClientAbsent(livraison, dans(-5)) },
  { nom: "Code de connexion", courriel: m.courrielCode("000000") },
  { nom: "Connexion de l'équipe bloquée", courriel: m.courrielBlocagePersonnel(dans(24 * 60)) },
  ...(etapes
    ? [
        { nom: "Étape (désactivée par défaut) : acceptée", courriel: m.courrielAcceptation(livraison, dans(40)) },
        { nom: "Étape (désactivée par défaut) : prête", courriel: m.courrielPrete({ ...retrait, statut: "prete" }) },
        { nom: "Étape (désactivée par défaut) : en route", courriel: m.courrielPrete({ ...livraison, statut: "partie" }) },
      ]
    : []),
];

console.log(`${liste.length} e-mails vers ${destinataire}, liens et logo sur ${origine} :`);
for (const [i, e] of liste.entries()) console.log(`${String(i + 1).padStart(2)}. ${e.nom} : « ${e.courriel.sujet} »`);
if (!envoyer) {
  console.log("\nRien n'est parti. Relancer avec --envoyer pour envoyer.");
  process.exit(0);
}

const { courrielConfigure, envoyerParSmtp } = await import("../src/lib/courriel/envoi");
if (!courrielConfigure()) arreter("SMTP_UTILISATEUR, SMTP_MOT_DE_PASSE et COURRIEL_EXPEDITEUR doivent être posées dans ce terminal.");
for (const [i, e] of liste.entries()) {
  // Préfixe du sujet : l'essai se distingue d'une vraie commande dans la boîte de réception.
  await envoyerParSmtp(destinataire!, `[Essai ${i + 1}/${liste.length}] ${e.courriel.sujet}`, e.courriel.texte, e.courriel.html);
  console.log(`Parti : ${i + 1}. ${e.nom}`);
  await new Promise((r) => setTimeout(r, 2000));
}
console.log("Terminé. Rien n'a été écrit dans une vraie base.");
