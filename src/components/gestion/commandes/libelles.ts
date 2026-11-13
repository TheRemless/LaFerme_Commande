// Mots de l'écran Commandes du back-office : ceux que l'équipe dit en cuisine et au comptoir.

export const STATUT: Record<string, string> = {
  nouvelle: "À accepter",
  acceptee: "Acceptée",
  en_preparation: "En préparation",
  prete: "Prête",
  partie: "Partie",
  terminee: "Terminée",
  refusee: "Refusée ou annulée",
};

// Ordre des pastilles, celui du service.
export const ORDRE_STATUTS = ["nouvelle", "acceptee", "en_preparation", "prete", "partie", "terminee", "refusee"] as const;

export const PAIEMENT: Record<string, string> = {
  paye: "Payée en ligne",
  encaisse: "Payée au comptoir",
  a_encaisser_retrait: "À encaisser au comptoir",
  rembourse: "Remboursée",
  echec: "Paiement échoué",
  en_attente: "Paiement en attente",
};

export const MODE: Record<string, string> = { livraison: "Livraison", retrait: "À emporter" };

const STATION: Record<string, string> = { pizza: "pizza", cuisine: "cuisine" };
const ETAT_TICKET: Record<string, string> = {
  en_attente: "en attente",
  envoyee: "envoyé",
  imprimee: "imprimé",
  echec: "pas imprimé",
  sans_imprimante: "à l'écran (sans imprimante)",
};
const LIVRAISON: Record<string, string> = {
  vue: "Adresse ouverte par le livreur",
  adresse_modifiee: "Adresse changée, livreur prévenu",
  depart: "Livreur parti",
  livree: "Livrée",
  client_absent: "Client absent",
};
const PAIEMENT_EVT: Record<string, string> = {
  "checkout.session.completed": "Paiement reçu",
  "checkout.session.expired": "Paiement abandonné",
  "charge.refunded": "Remboursement confirmé par Stripe",
};

// Auteur lisible : « tablette:Léa » → « Léa (tablette) », « gestion:Gérant » → « Gérant (back-office) ».
export function auteur(par: string | null | undefined): string {
  if (!par) return "";
  const [lieu, ...reste] = par.split(":");
  const nom = reste.join(":");
  if (!nom) return par === "client" ? "le client" : par === "stripe" ? "Stripe" : par === "webhook" ? "Stripe" : par;
  const ou: Record<string, string> = { tablette: "tablette", gestion: "back-office", livreur: "livreur" };
  return `${nom} (${ou[lieu] ?? lieu})`;
}

export type Evenement = { type: string; le: string; par?: string | null; [cle: string]: unknown };

const chf = (c: unknown) => `CHF ${(Number(c) / 100).toFixed(2)}`;

// Une ligne de la chronologie : titre court et détail facultatif.
export function evenementTexte(e: Evenement): { titre: string; detail?: string } {
  switch (e.type) {
    case "creation":
      return { titre: "Commande passée" };
    case "paiement":
      return { titre: PAIEMENT_EVT[String(e.detail)] ?? `Paiement : ${String(e.detail)}` };
    case "statut": {
      const detail = typeof e.detail === "string" ? e.detail : undefined;
      if (e.de === e.vers) {
        if (detail?.startsWith("heure ")) return { titre: "Heure changée", detail: heureDetail(detail.slice(6)) };
        if (detail?.startsWith("modifiee ")) return { titre: "Commande modifiée", detail: champsModifies(detail.slice(9)) };
        if (detail?.startsWith("recreee")) return { titre: detail.startsWith("recreee depuis") ? "Recréée" : "Recréée en une nouvelle commande", detail: detail.replace(/^recreee (depuis|en) /, "n° ") };
        return { titre: detail ?? "Mise à jour" };
      }
      if (e.vers === "encaisse") return { titre: "Encaissée au comptoir" };
      if (e.vers === "remboursement") return { titre: "Remboursement demandé", detail };
      if (e.vers === "courriel_non_envoye") return { titre: "E-mail non envoyé (limite du jour)", detail };
      return { titre: STATUT[String(e.vers)] ?? String(e.vers), detail: e.vers === "acceptee" && detail ? heureDetail(detail) : detail };
    }
    case "ticket":
      return { titre: `Ticket ${STATION[String(e.station)] ?? String(e.station)}${e.reimpression ? " réimprimé" : ""}`, detail: ETAT_TICKET[String(e.etat)] ?? String(e.etat) };
    case "livreur":
      return { titre: `Confiée à ${String(e.nom)}`, detail: e.retiree_le ? `retirée (${String(e.raison ?? "")})` : undefined };
    case "livraison":
      return { titre: LIVRAISON[String(e.evenement)] ?? String(e.evenement), detail: typeof e.detail === "string" ? e.detail : undefined };
    case "courriel":
      return { titre: "E-mail envoyé", detail: String(e.sujet) };
    case "remboursement":
      return { titre: `Remboursement de ${chf(e.montant_centimes)}`, detail: `${String(e.motif)} (${e.statut === "fait" ? "fait" : e.statut === "echec" ? "échoué" : "en cours"})` };
    case "note":
      return { titre: "Note", detail: String(e.texte) };
    default:
      return { titre: e.type };
  }
}

// Postgres écrit « 2026-11-13 19:15:00+00 » (timestamptz en texte) : on le ramène au format ISO.
const CHAMPS: Record<string, string> = {
  client_prenom: "prénom",
  client_nom: "nom",
  client_telephone: "téléphone",
  details_livraison: "consignes de livraison",
  adresse: "adresse",
  zone_numero: "zone",
};
function champsModifies(liste: string): string {
  return liste
    .split(",")
    .map((c) => CHAMPS[c.trim()] ?? c.trim())
    .join(", ");
}

function heureDetail(brut: string): string {
  const iso = brut.trim().replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return brut;
  return `pour ${d.toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" })}`;
}

export function heureCourte(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" });
}

export function jourCourt(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-CH", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Zurich" });
}
