// Nombres du back-office : chiffres alignés (tabulaires dans le CSS). Écriture suisse comme sur les prix du site :
// point décimal, apostrophe pour les milliers (« 1’234.50 »).

// Écrit à la main : Intl donne « ' » sur le serveur (Node) et « ’ » dans certains navigateurs.
function milliers(entier: string): string {
  return entier.replace(/\B(?=(\d{3})+(?!\d))/g, "’");
}

export function nombre(n: number): string {
  const r = Math.round(n);
  return `${r < 0 ? "-" : ""}${milliers(String(Math.abs(r)))}`;
}

/** « 1’234.50 » (sans CHF : la colonne ou le libellé le dit). */
export function montant(centimes: number): string {
  const abs = Math.abs(Math.round(centimes));
  return `${centimes < 0 ? "-" : ""}${milliers(String(Math.floor(abs / 100)))}.${String(abs % 100).padStart(2, "0")}`;
}

/** Écart en pour cent entre une valeur et sa référence, arrondi à l'unité ; null si la référence est nulle. */
export function ecartPourcent(valeur: number, reference: number): number | null {
  if (!reference) return null;
  return Math.round(((valeur - reference) / Math.abs(reference)) * 100);
}

/** « +12 % », « −3 % » (vrai signe moins), « = » quand rien ne change. */
export function ecartTexte(e: number): string {
  if (e === 0) return "=";
  return `${e > 0 ? "+" : "−"}${Math.abs(e)} %`;
}
