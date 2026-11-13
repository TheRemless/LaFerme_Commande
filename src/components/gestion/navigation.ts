// Rubriques du back-office, dans l'ordre de la barre latérale. Une rubrique = une adresse /gestion/<chemin>
// et un dossier src/app/gestion/<chemin>/page.tsx. Ajouter une rubrique : une ligne ici, dans le groupe voulu.
// Chaque session du back-office n'édite que les lignes de son périmètre (voir .claude/vague-3/regles.md).
import type { NomIconeGestion } from "@/components/gestion/ui/icones";

export type Rubrique = {
  /** Adresse complète, sans barre finale. */
  href: string;
  titre: string;
  icone: NomIconeGestion;
  /** Une phrase pour l'accueil et l'aide : ce qu'on y fait. */
  resume: string;
};

export type Groupe = { titre: string; rubriques: Rubrique[] };

export const ACCUEIL: Rubrique = { href: "/gestion", titre: "Accueil", icone: "accueil", resume: "La journée en un coup d'œil." };

export const GROUPES: Groupe[] = [
  { titre: "Service du jour", rubriques: [ACCUEIL] },
  {
    titre: "Commandes et clients",
    rubriques: [{ href: "/gestion/commandes", titre: "Commandes", icone: "commandes", resume: "Retrouver une commande, voir son historique, rembourser." }],
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
      { href: "/gestion/journal", titre: "Journal", icone: "journal", resume: "Qui a changé quoi, quand, et le retour à l'ancienne valeur." },
    ],
  },
  {
    titre: "Réglages du restaurant",
    rubriques: [
      { href: "/gestion/horaires", titre: "Livraison et horaires", icone: "horaires", resume: "Zones, horaires, fermetures, délais et capacité." },
      { href: "/gestion/imprimantes", titre: "Imprimantes", icone: "imprimante", resume: "Les deux postes d'impression et leur état." },
    ],
  },
  {
    titre: "Équipe",
    rubriques: [{ href: "/gestion/equipe", titre: "Équipe", icone: "equipe", resume: "Qui a accès à la tablette et au back-office." }],
  },
];

export const RUBRIQUES: Rubrique[] = GROUPES.flatMap((g) => g.rubriques);

/** La rubrique d'une adresse : la plus longue qui la préfixe (une fiche /gestion/commandes/37 reste dans Commandes). */
export function rubriqueDe(chemin: string): { rubrique: Rubrique; groupe: Groupe } {
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
