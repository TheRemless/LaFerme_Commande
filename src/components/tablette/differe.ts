// Retour arrière sur la tablette (vague 3, P0 du contrôle de produit-gestion) : un geste qui change un statut ou
// écrit un encaissement ne part qu'après quelques secondes, avec « Annuler » en bas de l'écran. Rien n'est écrit,
// imprimé ni envoyé au client (e-mail « prête », « en route ») pendant ce temps : annuler ne laisse aucune trace.
// Accepter et refuser ont déjà leur propre confirmation ; « Prête » d'un poste (vue par poste) a « Rouvrir ».

export const DELAI_ANNULER_MS = 5000;
const DIFFERES = new Set(["statut", "encaisser", "retiree_payee"]);

export const estDiffere = (corps: Record<string, unknown>) => DIFFERES.has(String(corps.action));

// « Prête au comptoir », « Retirée, encaissée en espèces »… : ce qui partira, dit comme sur le bouton.
export function texteGeste(corps: Record<string, unknown>, mode: "livraison" | "retrait" | undefined): string {
  const moyen = corps.moyen === "carte" ? "par carte" : corps.moyen === "especes" ? "en espèces" : "";
  if (corps.action === "encaisser") return `Encaissée ${moyen}`.trim();
  if (corps.action === "retiree_payee") return `Retirée, encaissée ${moyen}`.trim();
  if (corps.action === "statut") {
    if (corps.vers === "prete") return "Prête au comptoir";
    if (corps.vers === "partie") return "Partie en livraison";
    if (corps.vers === "terminee") return mode === "livraison" ? "Livrée" : "Retirée";
  }
  return "Geste";
}
