// Code promo dans le navigateur : gardé dans l'onglet seulement (sessionStorage), jamais dans le compte.
// Un QR peut l'apporter dans l'adresse (?code=FLYER) : il est rangé puis retiré de l'adresse, qui ne porte
// jamais rien d'autre que le code. Le serveur seul décide de la remise.

const CLE_CODE = "laferme.code";

export function lireCode(): string | null {
  try {
    return window.sessionStorage.getItem(CLE_CODE);
  } catch {
    return null;
  }
}

export function noterCode(code: string | null): void {
  try {
    if (code) window.sessionStorage.setItem(CLE_CODE, code);
    else window.sessionStorage.removeItem(CLE_CODE);
  } catch {
    // Stockage bloqué : le code reste à l'écran le temps de la page.
  }
}

export function retenirCodeDeLUrl(): void {
  try {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    if (code === null) return;
    const propre = code.trim().toUpperCase();
    if (/^[A-Z0-9-]{3,20}$/.test(propre)) noterCode(propre);
    url.searchParams.delete("code");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // Adresse illisible : rien à retenir.
  }
}

// Cagnotte demandée au paiement (vague 3) : gardée dans l'onglet comme le code. TOUT : tout ce qui peut servir.
// Le serveur seul décide du montant (aperçu au panier, puis la base au paiement, sous verrou).
const CLE_CAGNOTTE = "laferme.cagnotte";
export const CAGNOTTE_TOUT = 1_000_000;

export function lireCagnotte(): number {
  try {
    const n = Number(window.sessionStorage.getItem(CLE_CAGNOTTE));
    return Number.isInteger(n) && n > 0 ? Math.min(n, CAGNOTTE_TOUT) : 0;
  } catch {
    return 0;
  }
}

export function noterCagnotte(centimes: number): void {
  try {
    if (centimes > 0) window.sessionStorage.setItem(CLE_CAGNOTTE, String(Math.min(Math.round(centimes), CAGNOTTE_TOUT)));
    else window.sessionStorage.removeItem(CLE_CAGNOTTE);
  } catch {
    // Stockage bloqué : la case reste cochée le temps de la page.
  }
}
