// Texte de chaque ligne du journal des modifications (titre, résumé, lignes masquées, retour arrière possible).
// Sans React : testé dans tests/unit/journal-lignes.test.ts.
import { LIBELLES_COMPTES, type RoleCompte } from "@/lib/export-cresus";
import { heureDe } from "@/lib/heures";
import { nomObjet } from "@/lib/journal";
import { jourTexte } from "@/lib/service";

export type Entree = {
  id: number;
  personnel_nom: string;
  objet: string;
  cle: string;
  avant: Record<string, unknown> | null;
  apres: Record<string, unknown> | null;
  le: string;
  annule_par?: number | null;
};

const JOURS = ["", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const chf = (c: unknown) => `CHF ${(Number(c ?? 0) / 100).toFixed(2)}`;
const heure = (v: unknown) => (typeof v === "string" && v ? heureDe(v) : "");

// Objets ajoutés pendant la vague 3 par d'autres rubriques (contrats : docs/coup-de-feu.md, docs/zones-services.md,
// docs/livreurs.md, docs/pilotage.md). Rien de reconnu : null, et le résumé général prend le relais.
function resumeVague3(e: Entree): string | null {
  const a = e.apres as Record<string, unknown> | unknown[] | null;
  switch (e.objet) {
    case "coup_de_feu": {
      if (e.cle === "finir") return e.personnel_nom === "Fin automatique" ? "Fini à l'heure prévue" : "Fini";
      const x = (a ?? {}) as { jusqua?: string; applique?: Record<string, unknown> };
      const ap = x.applique ?? {};
      const parts = [
        ap.retard_minutes ? `+${ap.retard_minutes} min` : "",
        ap.livraison_fermee ? "livraison fermée" : "",
        ap.capacite_livraisons_par_creneau !== undefined ? `${ap.capacite_livraisons_par_creneau} livraisons par créneau` : "",
        ap.capacite_retraits_par_creneau !== undefined ? `${ap.capacite_retraits_par_creneau} retraits par créneau` : "",
      ].filter(Boolean);
      return `Lancé${parts.length ? ` : ${parts.join(", ")}` : ""}${x.jusqua ? `, jusqu'à ${heure(x.jusqua)}` : ""}`;
    }
    case "zone_services": {
      const v = Array.isArray(a) ? a : [];
      const t = v.includes("midi") && v.includes("soir") ? "midi et soir" : v.includes("soir") ? "le soir seulement" : v.includes("midi") ? "le midi seulement" : "aucun service";
      return `Zone ${e.cle} : ${t}`;
    }
    case "zone_fermeture": {
      if (!a) return `Zone ${e.cle} rouverte`;
      const x = a as { jusqua?: string; motif?: string };
      return `Zone ${e.cle} fermée${x.jusqua ? ` jusqu'à ${heure(x.jusqua)}` : ""}${x.motif ? ` : ${x.motif}` : ""}`;
    }
    case "livreur_semaine": {
      const v = (Array.isArray(a) ? a : []) as { jour?: number; service?: string }[];
      return v.length ? `${e.cle} : ${v.map((j) => `${JOURS[j.jour ?? 0] ?? ""} ${j.service ?? ""}`.trim()).join(", ")}` : `${e.cle} : aucun service`;
    }
    case "livreur_jour": {
      if (!a) return `${e.cle} : comme d'habitude`;
      const x = a as { jour?: string; service?: string; present?: boolean; motif?: string };
      const quand = `${x.jour ? jourCourt(x.jour) : ""} ${x.service ?? ""}`.trim();
      return x.present ? `${e.cle} en plus ${quand}` : `${e.cle} absent ${quand}${x.motif ? ` : ${x.motif}` : ""}`;
    }
    case "cloture": {
      const x = (a ?? {}) as Record<string, unknown>;
      const compte = x.especes_comptees_centimes === null && x.carte_comptoir_centimes === null
        ? "rien compté"
        : `compté ${chf(Number(x.especes_comptees_centimes ?? 0) + Number(x.carte_comptoir_centimes ?? 0))}, écart ${chf(x.ecart_centimes)}`;
      return `Jour du ${jourCourt(e.cle)} : attendu au comptoir ${chf(x.attendu_comptoir_centimes)}, ${compte}${e.avant ? " (reclôturé)" : ""}`;
    }
    default:
      return null;
  }
}

// Ce qui se remet depuis le journal (audit du gérant, G11), comme dans annuler_journal en base.
const REGLAGES_ANNULABLES = ["plafond_comptoir_centimes", "capacite_livraisons_par_creneau", "capacite_retraits_par_creneau", "alerte_acceptation_minutes"];
export function annulable(e: Entree): boolean {
  if (e.annule_par) return false;
  if (e.objet === "reglage") return REGLAGES_ANNULABLES.includes(e.cle) && e.avant !== null;
  return ["zone", "horaire", "plat", "option", "fermeture", "ouverture", "zone_npa"].includes(e.objet);
}

const REGLAGES: Record<string, (v: unknown) => string> = {
  plafond_comptoir_centimes: (v) => `Paiement au comptoir jusqu'à CHF ${(Number(v) / 100).toFixed(2)}`,
  capacite_livraisons_par_creneau: (v) => `${v} livraisons par créneau`,
  capacite_retraits_par_creneau: (v) => `${v} retraits par créneau`,
  alerte_acceptation_minutes: (v) => `Alerte après ${v} min`,
  retard_minutes: (v) => (Number(v) ? `+${v} min` : "aucun retard"),
};

// Nom du réglage sur chaque ligne du journal. Un réglage ajouté plus tard sans nom ici s'affiche sous sa clé.
const NOMS_REGLAGES: Record<string, string> = {
  plafond_comptoir_centimes: "paiement au comptoir",
  capacite_livraisons_par_creneau: "livraisons par créneau",
  capacite_retraits_par_creneau: "retraits par créneau",
  alerte_acceptation_minutes: "alerte d'acceptation",
  retard_minutes: "retard ajouté aux heures",
  livraison_fermee: "livraison fermée",
  pause_auto: "pause automatique",
  pause_jusqu_a: "pause des commandes",
  creneau_minutes: "durée d'un créneau",
  avance_jours: "commande à l'avance",
  plafond_codes_clients_jour: "codes de connexion par jour",
  alerte_email: "adresse des alertes",
  annulation_client_active: "annulation par le client",
  plats_populaires_actifs: "plats populaires",
  suggestion_panier_active: "suggestion au panier",
  debit_pizza_quart_heure: "pizzas par quart d'heure",
  debit_cuisine_quart_heure: "plats de cuisine par quart d'heure",
  livraisons_par_livreur_heure: "livraisons par livreur et par heure",
  allongement_max_minutes: "allongement maximal",
  fourchette_livraison_minutes: "fourchette de livraison",
  fourchette_retrait_minutes: "fourchette de retrait",
  preparation_minutes: "temps de préparation",
  impression_avance_livraison_minutes: "impression à l'avance (livraison)",
  impression_avance_retrait_minutes: "impression à l'avance (retrait)",
};
const nomReglage = (cle: string) => NOMS_REGLAGES[cle] ?? cle.replace(/_/g, " ");

// Identifiant de plat (« pizza-miss-italia ») lisible quand la ligne ne garde pas le nom.
const lisible = (cle: string) => (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(cle) ? cle.replace(/-/g, " ") : cle);

export function quoi(e: Entree): string {
  switch (e.objet) {
    case "plat":
      return `Plat ${String((e.apres ?? e.avant)?.nom ?? lisible(e.cle))}`;
    case "plat_ajoute":
      return `Plat ajouté ${String(e.apres?.nom ?? e.cle)}`;
    case "plat_archive":
      return `Plat ${lisible(e.cle)}`;
    case "plat_du_jour":
      return `Plat du jour ${String(e.apres?.nom ?? e.cle)}`;
    case "categorie":
      return `Catégorie ${e.cle}`;
    case "photo":
      return `Photo ${e.cle}`;
    case "option":
      // Clé « groupe/nom » ; sans groupe, le nom seul.
      return `Supplément ${e.cle.includes("/") ? e.cle.split("/").slice(1).join("/") : e.cle}`;
    case "zone":
      return `Zone ${e.cle}`;
    case "zone_npa":
      return `Commune ${e.cle}`;
    case "horaire":
      return "Horaire";
    case "fermeture":
      return "Fermeture";
    case "ouverture":
      return "Ouverture exceptionnelle";
    case "reglage":
      return `Réglage, ${nomReglage(e.cle)}`;
    case "personnel":
      return `Équipe, ${e.cle}`;
    case "remboursement":
      return `Commande ${e.cle}`;
    case "import":
      return "Import du tableau";
    case "imprimante":
      return `Imprimante ${e.cle}`;
    case "zone_services":
    case "zone_fermeture":
      return `${nomObjet(e.objet)}, zone ${e.cle}`;
    case "cloture":
      return "Clôture du jour";
    case "plan_comptes":
      return `Plan de comptes Crésus, ${LIBELLES_COMPTES[e.cle as RoleCompte] ?? lisible(e.cle)}`;
    default:
      return `${nomObjet(e.objet)}${e.cle ? `, ${lisible(e.cle)}` : ""}`;
  }
}

const LIBELLES: Record<string, string> = {
  nom: "Nom",
  description: "Description",
  prix_centimes: "Prix",
  prix_a_valider: "Prix à valider",
  commandable: "Commandable",
  station: "Station",
  photo: "Photo",
  provenance: "Provenance",
  provenances_a_fournir: "Provenances à fournir",
  allergenes: "Allergènes",
  categorie_id: "Catégorie",
  groupes: "Options",
  archive_le: "Archivé le",
  jour_service: "Service",
  actif: "Proposé",
  frais_centimes: "Frais",
  minimum_centimes: "Minimum",
  delai_min: "Délai de",
  delai_max: "Délai à",
  active: "Zone ouverte",
  proposition: "Proposition",
  premiere_heure: "Première heure",
  derniere_heure: "Dernière heure",
  derniere_commande: "Dernière commande",
  derniere_commande_pizzas: "Dernière pizza",
  rupture: "Rupture",
  rupture_jour: "Rupture du jour",
};

function valeurLisible(cle: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "vide";
  if (typeof v === "string" && /^\d{2}:\d{2}:\d{2}$/.test(v)) return v.slice(0, 5);
  if (cle.endsWith("_centimes") && typeof v === "number") return (v / 100).toFixed(2);
  if (typeof v === "boolean") return v ? "oui" : "non";
  if (Array.isArray(v)) return v.join(", ") || "vide";
  return String(v);
}

const ROLE: Record<string, string> = { service: "tablette", gerant: "tablette et back-office", livreur: "livreur", responsable: "responsable de service" };
// Un rôle ajouté plus tard sans libellé s'affiche sous son nom, jamais « undefined ».
const role = (r: string | undefined) => (r ? (ROLE[r] ?? r) : "aucun");

function jourCourt(d: unknown): string {
  return jourTexte(String(d).slice(0, 10));
}

export function resume(e: Entree): string {
  const v3 = resumeVague3(e);
  if (v3 !== null) return v3;
  if (e.objet === "reglage") {
    const f = REGLAGES[e.cle] ?? ((v: unknown) => valeurLisible(e.cle, v));
    return `${e.avant === null ? "vide" : f(e.avant)} → ${f(e.apres)}`;
  }
  if (e.objet === "fermeture" || e.objet === "ouverture") {
    const x = (e.apres ?? e.avant ?? {}) as { debut?: string; fin?: string; jour?: string; service?: string | null; motif?: string };
    const quand = x.jour
      ? `le ${jourCourt(x.jour)}, ${x.service === "midi" ? "midi" : "soir"}`
      : x.service
        ? `le ${jourCourt(x.debut)}, ${x.service}`
        : `du ${jourCourt(x.debut)} au ${jourCourt(x.fin)}`;
    return `${e.apres ? "Ajout" : "Suppression"} : ${quand}, ${x.motif ?? ""}`;
  }
  if (e.objet === "zone_npa") {
    const av = e.avant as { zone_numero?: number } | null;
    const ap = e.apres as { zone_numero?: number } | null;
    if (!av) return `Ajoutée à la zone ${ap?.zone_numero}`;
    if (!ap) return `Retirée de la zone ${av.zone_numero}`;
    return `Zone ${av.zone_numero} → zone ${ap.zone_numero}`;
  }
  if (e.objet === "plan_comptes") return `Compte ${valeurLisible(e.cle, e.avant)} → ${valeurLisible(e.cle, e.apres)}`;
  if (e.objet === "plat_archive") return e.apres?.archive ? "Archivé" : "Remis à la carte";
  if (e.objet === "remboursement" && e.apres) {
    const a = e.apres as { montant_centimes?: number; motif?: string; moyen?: string };
    return `Commande ${e.cle} : CHF ${((a.montant_centimes ?? 0) / 100).toFixed(2)} remboursés${a.moyen === "especes" ? " en espèces" : ""}. ${a.motif ?? ""}`;
  }
  if (e.objet === "personnel") {
    const av = (e.avant ?? {}) as { nom?: string; role?: string; actif?: boolean };
    const ap = (e.apres ?? {}) as { nom?: string; role?: string; actif?: boolean; sessions_coupees?: number };
    if (ap.sessions_coupees !== undefined) return `Déconnecté de ${ap.sessions_coupees} appareil${ap.sessions_coupees > 1 ? "s" : ""}`;
    if (!e.avant || av.actif === false) return `Ajouté : ${ap.nom}, accès ${role(ap.role)}`;
    if (ap.actif === false) return `Retiré : ${av.nom}`;
    const ch = [av.nom !== ap.nom ? `nom ${av.nom} → ${ap.nom}` : "", av.role !== ap.role ? `accès ${role(av.role)} → ${role(ap.role)}` : ""].filter(Boolean);
    return ch.length ? ch.join(" ; ") : SANS_CHANGEMENT;
  }
  if (!e.avant || !e.apres || Array.isArray(e.avant) || Array.isArray(e.apres)) {
    if (e.objet === "import") return `Import : ${JSON.stringify(e.apres)}`;
    if (!e.avant) return "Ajout";
    if (!e.apres) return "Suppression";
    return `${JSON.stringify(e.avant)} → ${JSON.stringify(e.apres)}`;
  }
  // « Proposition » passe à non à chaque enregistrement : sans intérêt pour le gérant.
  const cles = Object.keys(e.apres).filter((k) => k !== "proposition" && JSON.stringify(e.avant![k]) !== JSON.stringify(e.apres![k]));
  return cles.length
    ? cles.map((k) => `${LIBELLES[k] ?? k} : ${valeurLisible(k, e.avant![k])} → ${valeurLisible(k, e.apres![k])}`).join(" ; ")
    : SANS_CHANGEMENT;
}

// Une ligne sans changement visible (même valeur avant et après, ou seule « Proposition » change) ne s'affiche pas.
const SANS_CHANGEMENT = "Enregistré sans changement";
export function sansChangement(e: Entree): boolean {
  if (e.objet === "reglage") return JSON.stringify(e.avant) === JSON.stringify(e.apres);
  return resume(e) === SANS_CHANGEMENT;
}

