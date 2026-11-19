// TVA par taux, même règle que ventilation_commande en base (supabase/migrations/20261217150000_tva_par_plat.sql).
// Le site s'en sert pour l'aperçu du panier ; la base recalcule à la commande et fait foi. Aucun taux ici : ils
// viennent de la table taux_tva (catalogue). docs/compta/tva-et-cagnotte.md, règles R1, R3, R9, R15.

// Frais d'une commande mixte (question F3) : tous au taux le plus haut, ou au prorata des lignes.
export type RegleFrais = "normal" | "prorata";
// Rabais en francs et remboursement global d'une commande mixte (F4) : d'abord au taux le plus bas, ou au prorata.
export type RegleRabais = "reduit_dabord" | "prorata";
export type ReglesTva = { frais: RegleFrais; rabais: RegleRabais };

// Options prudentes, aussi quand un réglage manque ou est illisible : la TVA n'est jamais sous-déclarée.
export const REGLES_TVA_PRUDENTES: ReglesTva = { frais: "normal", rabais: "reduit_dabord" };

export function reglesTva(reglages: { cle: string; valeur: unknown }[]): ReglesTva {
  const lire = (cle: string) => reglages.find((r) => r.cle === cle)?.valeur;
  const frais = lire("frais_tva_mixte");
  const rabais = lire("rabais_tva_mixte");
  return {
    frais: frais === "prorata" ? "prorata" : REGLES_TVA_PRUDENTES.frais,
    rabais: rabais === "prorata" ? "prorata" : REGLES_TVA_PRUDENTES.rabais,
  };
}

export const tvaComprise = (ttc: number, taux: number): number => Math.round((ttc * taux) / (100 + taux));

// Plus de 0,5 % vol. : boisson alcoolique, taux normal (art. 25 LTVA). Même seuil que categorie_tva en base.
export const SEUIL_ALCOOL_POURCENT = 0.5;
export function tauxDuPlat(teneurAlcool: number | null | undefined, taux: { normal: number; reduit: number }): number {
  return (teneurAlcool ?? 0) > SEUIL_ALCOOL_POURCENT ? taux.normal : taux.reduit;
}

// Répartit un montant selon des poids, au centime (plus forts restes ; à égalité, le taux le plus haut).
export function repartirCentimes(montant: number, poids: number[]): number[] {
  const n = poids.length;
  if (n === 0) return [];
  const p = poids.map((x) => Math.max(x, 0));
  const total = p.reduce((s, x) => s + x, 0);
  if (total === 0) return p.map((_, i) => (i === n - 1 ? montant : 0));
  const parts = p.map((x) => Math.floor((montant * x) / total));
  const restes = p.map((x, i) => (montant * x) / total - parts[i]);
  let reste = montant - parts.reduce((s, x) => s + x, 0);
  while (reste > 0) {
    let j = n - 1;
    for (let i = n - 1; i >= 0; i--) if (restes[i] > restes[j]) j = i;
    parts[j] += 1;
    restes[j] = -1;
    reste -= 1;
  }
  return parts;
}

// Impute un montant dans l'ordre (taux croissants), chaque part plafonnée ; le surplus va au dernier.
export function imputerDansLordre(montant: number, plafonds: number[]): number[] {
  let reste = montant;
  const parts = plafonds.map((c) => {
    const x = Math.min(reste, Math.max(c, 0));
    reste -= x;
    return x;
  });
  if (parts.length > 0) parts[parts.length - 1] += reste;
  return parts;
}

export type BaseTva = {
  // Lignes du panier, chacune à son taux.
  lignes: { taux: number; ttc: number }[];
  frais: number;
  // Remise du code sur les plats, et sur les frais (code « livraison »).
  remisePlats: number;
  remiseFrais: number;
  cagnotte: number;
  regles: ReglesTva;
};
export type PartTva = {
  taux: number;
  ttc: number;
  tva: number;
  frais_ttc: number;
  frais_tva: number;
  rabais_ttc: number;
  rabais_tva: number;
  cagnotte_ttc: number;
  cagnotte_tva: number;
};

// Parts par taux croissant. Somme des ttc = lignes + frais − remises − cagnotte.
export function ventilerTva(b: BaseTva): PartTva[] {
  const parTaux = new Map<number, number>();
  for (const l of b.lignes) parTaux.set(l.taux, (parTaux.get(l.taux) ?? 0) + l.ttc);
  // Un taux dont les lignes valent 0 CHF (plat offert) ne compte pas : même règle qu'en base.
  const taux = [...parTaux.keys()].filter((t) => parTaux.get(t) !== 0).sort((a, c) => a - c);
  const lignes = taux.map((t) => parTaux.get(t) ?? 0);
  const n = taux.length;
  if (n === 0) return [];
  const frais = n === 1 ? [b.frais] : b.regles.frais === "prorata" ? repartirCentimes(b.frais, lignes) : lignes.map((_, i) => (i === n - 1 ? b.frais : 0));
  const remFrais = repartirCentimes(b.remiseFrais, frais);
  const imputer = b.regles.rabais === "prorata" ? repartirCentimes : imputerDansLordre;
  const remPlats = imputer(b.remisePlats, lignes);
  const cag = imputer(
    b.cagnotte,
    lignes.map((x, i) => x - remPlats[i]),
  );
  return taux
    .map((t, i) => {
      const ttc = lignes[i] - remPlats[i] - cag[i] + frais[i] - remFrais[i];
      const rabais = remPlats[i] + remFrais[i];
      return {
        taux: t,
        ttc,
        tva: tvaComprise(ttc, t),
        frais_ttc: frais[i],
        frais_tva: tvaComprise(frais[i], t),
        rabais_ttc: rabais,
        rabais_tva: tvaComprise(rabais, t),
        cagnotte_ttc: cag[i],
        cagnotte_tva: tvaComprise(cag[i], t),
      };
    })
    .filter((p) => p.ttc !== 0 || p.frais_ttc !== 0 || lignes[taux.indexOf(p.taux)] !== 0);
}

export function tvaTotale(b: BaseTva): number {
  return ventilerTva(b).reduce((s, p) => s + p.tva, 0);
}

// Libellé « dont TVA » : un taux, ou les taux présents.
export function libelleTaux(taux: number[]): string {
  const f = (t: number) => `${String(t).replace(".", ",")} %`;
  const uniques = [...new Set(taux)].sort((a, b) => a - b);
  return uniques.length <= 1 ? f(uniques[0] ?? 0) : `${uniques.slice(0, -1).map(f).join(", ")} et ${f(uniques[uniques.length - 1])}`;
}
