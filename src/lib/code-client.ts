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
