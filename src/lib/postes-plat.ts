// Poste d'un plat : où il se prépare (enum station, migrations 20261105120000 et 20261215150000).
// « comptoir » (décision de Jérémy, 14.11.2026) : ni ticket de préparation ni débit. L'équipe du comptoir met
// l'article dans le sac, il figure seulement sur le ticket du sac et sur l'écran comptoir de la tablette.
export type PostePlat = "pizza" | "cuisine" | "comptoir";

export const POSTES_PLAT: readonly (readonly [PostePlat, string])[] = [
  ["pizza", "Four"],
  ["cuisine", "Cuisine"],
  ["comptoir", "Comptoir"],
];

export function estPostePlat(v: unknown): v is PostePlat {
  return v === "pizza" || v === "cuisine" || v === "comptoir";
}

export function libellePoste(p: string): string {
  return POSTES_PLAT.find(([v]) => v === p)?.[1] ?? p;
}

// Aide d'une ligne sous le choix du poste, au back-office.
export const AIDE_POSTE =
  "Le four et la cuisine reçoivent un ticket de préparation. Un article au comptoir n'en a pas, l'équipe le met dans le sac.";

// Règle des pizzas : un panier qui ne passe que par le four se commande plus tard le soir. Le comptoir ne le retient
// pas (une boisson ne demande pas la cuisine), mais il faut au moins une pizza.
export function pizzasSeulement(postes: readonly string[]): boolean {
  return (
    postes.includes("pizza") &&
    postes.every((p) => p === "pizza" || p === "comptoir")
  );
}
