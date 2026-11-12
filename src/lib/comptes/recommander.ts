import { calculerPanier, platDe, type Catalogue, type LignePanier } from "@/lib/panier";
import { nomClient } from "@/lib/nom-plat";

// « Recommander la même chose » : les lignes d'une ancienne commande, contrôlées contre la carte du jour.
// Un plat retiré, en rupture ou dont une option n'existe plus est laissé de côté avec la raison ;
// un prix qui a changé est signalé. Les montants viennent du catalogue actuel, jamais de l'ancienne commande.

export type AncienneLigne = LignePanier & { nom: string; unitaire_centimes: number };

export type Recommande = {
  lignes: LignePanier[];
  retirees: { nom: string; raison: string }[];
  prix: { nom: string; avant_centimes: number; apres_centimes: number }[];
};

export function recommander(cat: Catalogue, anciennes: AncienneLigne[]): Recommande {
  const candidates: LignePanier[] = anciennes.map((l) => ({
    slug: l.slug,
    qte: l.qte,
    choix: l.choix ?? {},
    retraits: l.retraits ?? [],
    note: l.note ?? "",
  }));
  const calcul = calculerPanier(cat, candidates, null);
  const r: Recommande = { lignes: [], retirees: [], prix: [] };
  calcul.lignes.forEach((l, i) => {
    const ancienne = anciennes[i];
    if (l.erreur) {
      r.retirees.push({ nom: nomClient(ancienne.nom, /^Pizza /.test(ancienne.nom)), raison: l.erreur });
      return;
    }
    r.lignes.push(candidates[i]);
    if (l.unitaire_centimes !== ancienne.unitaire_centimes) {
      r.prix.push({ nom: nomClient(l.nom, platDe(cat, l.slug)?.categorie_slug === "pizzas"), avant_centimes: ancienne.unitaire_centimes, apres_centimes: l.unitaire_centimes });
    }
  });
  return r;
}
