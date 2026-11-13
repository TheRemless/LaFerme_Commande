// Rubriques du back-office, dans l'ordre de la barre latérale. Une rubrique = une adresse /gestion/<chemin>
// et un dossier src/app/gestion/<chemin>/page.tsx. Ajouter une rubrique : une ligne ici, dans le groupe voulu.
// Chaque session du back-office n'édite que les lignes de son périmètre (voir .claude/vague-3/regles.md).
import type { NomIconeGestion } from "@/components/gestion/ui/icones";
import type { ActionDroit } from "@/lib/personnel/droits";

export type Rubrique = {
  /** Adresse complète, sans barre finale. */
  href: string;
  titre: string;
  icone: NomIconeGestion;
  /** Une phrase pour l'accueil et l'aide : ce qu'on y fait. */
  resume: string;
  /** Place réservée : la rubrique n'apparaît pas tant que sa page n'existe pas. Le propriétaire retire
   *  ce drapeau dans la PR qui ajoute src/app/gestion/<chemin>/page.tsx (tests/unit/gestion-navigation.test.ts le vérifie). */
  aVenir?: true;
  /** Ouverte aussi au responsable de service (D1, désactivé tant que Jérémy n'a pas tranché) pour ce droit. Sans : gérant seulement. */
  droit?: ActionDroit;
};

export type Groupe = { titre: string; rubriques: Rubrique[] };

export const ACCUEIL: Rubrique = { href: "/gestion", titre: "Accueil", icone: "accueil", resume: "La journée en un coup d'œil." };

export const GROUPES: Groupe[] = [
  { titre: "Service du jour", rubriques: [ACCUEIL] },
  {
    titre: "Commandes et clients",
    rubriques: [
      { href: "/gestion/commandes", titre: "Commandes", icone: "commandes", resume: "Retrouver une commande, voir son historique, rembourser.", droit: "voir_commandes" },
      // bo-commandes
      { href: "/gestion/clients", titre: "Clients", icone: "clients", resume: "Les clients, leurs commandes et leurs réclamations.", aVenir: true, droit: "voir_commandes" },
    ],
  },
  {
    titre: "Carte et offre",
    rubriques: [
      { href: "/gestion/carte", titre: "Carte", icone: "carte", resume: "Plats, prix, photos, allergènes, provenances et catégories." },
      { href: "/gestion/plat-du-jour", titre: "Plat du jour", icone: "jour", resume: "Le plat du jour, pour un midi, un soir ou les deux." },
      { href: "/gestion/supplements", titre: "Suppléments et pâtes", icone: "supplements", resume: "Prix et disponibilité des suppléments et des choix." },
      { href: "/gestion/import", titre: "Importer le tableau", icone: "importer", resume: "Le tableau de validation rempli, vérifié avant d'être appliqué." },
    ],
  },
  {
    titre: "Chiffres",
    rubriques: [
      { href: "/gestion/export", titre: "Export comptable", icone: "exporter", resume: "Les ventes d'une période en fichier CSV, pour la comptabilité." },
      // bo-pilotage
      { href: "/gestion/rapports", titre: "Rapports", icone: "rapports", resume: "Les ventes par jour, par service et par plat.", aVenir: true },
      { href: "/gestion/cloture", titre: "Clôture du jour", icone: "cloture", resume: "Le jour fermé : ventes, encaissements et remboursements.", aVenir: true },
      { href: "/gestion/journal", titre: "Journal", icone: "journal", resume: "Qui a changé quoi, quand, et le retour à l'ancienne valeur." },
    ],
  },
  {
    titre: "Réglages du restaurant",
    rubriques: [
      // bo-operations (propriétaire de /gestion/horaires : s'il la renomme, garder une redirection depuis l'ancienne adresse)
      { href: "/gestion/horaires", titre: "Livraison et horaires", icone: "horaires", resume: "Zones, horaires, fermetures, délais et capacité." },
      { href: "/gestion/livreurs", titre: "Livreurs", icone: "livreurs", resume: "Les livreurs et leurs tournées.", aVenir: true },
      { href: "/gestion/imprimantes", titre: "Imprimantes", icone: "imprimante", resume: "Les deux postes d'impression et leur état." },
    ],
  },
  {
    titre: "Équipe",
    rubriques: [{ href: "/gestion/equipe", titre: "Équipe", icone: "equipe", resume: "Qui a accès à la tablette et au back-office." }],
  },
];

export const RUBRIQUES: Rubrique[] = GROUPES.flatMap((g) => g.rubriques);

/** Ce que montrent le menu et l'accueil : les rubriques qui ont leur page, et les groupes qui en ont au moins une. */
export const GROUPES_VISIBLES: Groupe[] = GROUPES.map((g) => ({ ...g, rubriques: g.rubriques.filter((r) => !r.aVenir) })).filter((g) => g.rubriques.length > 0);

/** Le back-office est-il ouvert à ce rôle pour cette rubrique ? Le gérant partout, le responsable de service
 *  seulement là où la rubrique porte un droit (son tableau est en base : droit_personnel). */
export function rubriqueOuverte(r: Rubrique, role: "gerant" | "responsable"): boolean {
  return role === "gerant" || r.droit !== undefined;
}

/** Le menu d'un rôle : les groupes visibles, sans les rubriques fermées à ce rôle. */
export function groupesPour(role: "gerant" | "responsable"): Groupe[] {
  return GROUPES_VISIBLES.map((g) => ({ ...g, rubriques: g.rubriques.filter((r) => rubriqueOuverte(r, role)) })).filter((g) => g.rubriques.length > 0);
}

/** La rubrique d'une adresse : la plus longue qui la préfixe (une fiche /gestion/commandes/37 reste dans Commandes). */
// Pages hors menu (démonstration du kit, en local) : titre seulement, rattachées à l'accueil.
const HORS_MENU: Rubrique[] = [{ href: "/gestion/kit", titre: "Kit du back-office", icone: "accueil", resume: "Démonstration des composants." }];

export function rubriqueDe(chemin: string): { rubrique: Rubrique; groupe: Groupe } {
  const hors = HORS_MENU.find((r) => chemin === r.href);
  if (hors) return { rubrique: hors, groupe: GROUPES[0] };
  const propre = chemin.replace(/\/+$/, "") || "/gestion";
  let meilleure: { rubrique: Rubrique; groupe: Groupe } = { rubrique: ACCUEIL, groupe: GROUPES[0] };
  for (const groupe of GROUPES) {
    for (const rubrique of groupe.rubriques) {
      if (rubrique.href === "/gestion") continue;
      if ((propre === rubrique.href || propre.startsWith(`${rubrique.href}/`)) && rubrique.href.length > meilleure.rubrique.href.length) meilleure = { rubrique, groupe };
    }
  }
  return meilleure;
}

/** Titre d'une rubrique pour les métadonnées de sa page : le même que dans le menu et le h1. */
export function titreRubrique(href: string): string {
  const r = RUBRIQUES.find((x) => x.href === href);
  if (!r) throw new Error(`Rubrique inconnue : ${href}`);
  return r.titre;
}
