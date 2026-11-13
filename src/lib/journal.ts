// Journal du back-office : types, contrôle des filtres envoyés par l'écran et noms des objets pour l'équipe.
// La recherche se fait en base (journal_gestion_chercher), en POST : un nom cherché n'apparaît pas dans une adresse.

import { dateValide } from "@/lib/gestion";

export type EntreeJournal = {
  id: number;
  personnel_nom: string;
  objet: string;
  cle: string;
  avant: Record<string, unknown> | unknown[] | null;
  apres: Record<string, unknown> | unknown[] | null;
  le: string;
  annule_par?: number | null;
};

export type PageJournal = { entrees: EntreeJournal[]; suivant: number | null };
export type FiltresJournal = { auteurs: { nom: string; lignes: number }[]; objets: { objet: string; lignes: number }[] };

export type Recherche = { auteur?: string; objet?: string; debut?: string; fin?: string; recherche?: string; avant_id?: number; limite?: number };

const texte = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

// Ce que l'écran envoie, contrôlé avant la base. Un champ vide ne filtre pas.
export function lireRecherche(c: Record<string, unknown>): { ok: true; valeur: Recherche } | { ok: false; erreur: string } {
  const v: Recherche = {};
  const auteur = texte(c.auteur, 80);
  const objet = texte(c.objet, 30);
  const recherche = texte(c.recherche, 60);
  if (auteur) v.auteur = auteur;
  if (objet) {
    if (!/^[a-z_]{2,30}$/.test(objet)) return { ok: false, erreur: "Objet inconnu." };
    v.objet = objet;
  }
  if (recherche) v.recherche = recherche;
  for (const k of ["debut", "fin"] as const) {
    if (c[k] === undefined || c[k] === null || c[k] === "") continue;
    const d = dateValide(c[k]);
    if (!d) return { ok: false, erreur: "Date invalide." };
    v[k] = d;
  }
  if (v.debut && v.fin && v.fin < v.debut) return { ok: false, erreur: "La fin est avant le début." };
  if (c.avant_id !== undefined && c.avant_id !== null) {
    if (!Number.isSafeInteger(c.avant_id) || (c.avant_id as number) < 1) return { ok: false, erreur: "Page inconnue." };
    v.avant_id = c.avant_id as number;
  }
  if (c.limite !== undefined) {
    if (!Number.isInteger(c.limite) || (c.limite as number) < 1 || (c.limite as number) > 200) return { ok: false, erreur: "Nombre de lignes invalide." };
    v.limite = c.limite as number;
  }
  return { ok: true, valeur: v };
}

// Nom de chaque objet du journal, dans les mots de l'équipe (liste de filtre et titre d'une ligne).
export const NOMS_OBJETS: Record<string, string> = {
  plat: "Plat",
  plat_ajoute: "Plat ajouté",
  plat_archive: "Plat archivé ou remis",
  plat_du_jour: "Plat du jour",
  ordre_plats: "Ordre des plats",
  categorie: "Catégorie",
  photo: "Photo",
  option: "Supplément",
  option_nom: "Nom d'un supplément",
  options: "Suppléments",
  groupe: "Groupe d'options",
  groupe_plats: "Plats d'un groupe",
  groupe_ordre: "Ordre des groupes",
  groupe_defauts: "Choix par défaut",
  retraits: "Retraits",
  rupture: "Rupture",
  rupture_option: "Rupture d'un supplément",
  rupture_groupee: "Rupture groupée",
  disponibilite: "Disponibilité d'un plat",
  zone: "Zone",
  zone_npa: "Commune",
  zone_services: "Services d'une zone",
  zone_fermeture: "Zone fermée ou rouverte",
  horaire: "Horaire",
  fermeture: "Fermeture",
  ouverture: "Ouverture exceptionnelle",
  reglage: "Réglage",
  coup_de_feu: "Coup de feu",
  livreur_semaine: "Semaine d'un livreur",
  livreur_jour: "Livreur, un jour",
  personnel: "Équipe",
  remboursement: "Remboursement",
  commande: "Commande modifiée",
  note_commande: "Note sur une commande",
  note_client: "Note sur un client",
  client: "Client",
  import: "Import du tableau",
  imprimante: "Imprimante",
  cloture: "Clôture du jour",
  plan_comptes: "Plan de comptes Crésus",
};

export const nomObjet = (objet: string) => NOMS_OBJETS[objet] ?? objet.replace(/_/g, " ");
