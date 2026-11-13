// Fiche d'un plat ouverte depuis l'adresse : /carte#pizza-tonno (le slug seul, jamais une donnée du client).
// Pour partager un plat ou le voir « comme le client » depuis le back-office (lien de bo-carte).

const FORME = /^#([a-z0-9-]{1,80})$/;

// Le slug porté par l'ancre de l'adresse, ou null.
export function platDeLAdresse(): string | null {
  try {
    return FORME.exec(window.location.hash)?.[1] ?? null;
  } catch {
    return null;
  }
}

// L'ancre à garder en passant par l'accueil (client qui n'a pas encore choisi livraison ou à emporter).
export function ancrePlat(): string {
  const s = platDeLAdresse();
  return s ? `#${s}` : "";
}

// Fiche refermée : l'ancre part de l'adresse, sans nouvelle entrée dans l'historique.
export function oublierPlatDeLAdresse(): void {
  try {
    if (!platDeLAdresse()) return;
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
  } catch {
    // Adresse inchangeable : sans conséquence.
  }
}
