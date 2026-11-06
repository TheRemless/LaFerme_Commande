import type { LignePlat } from "@/lib/carte";

// Les pizzas s'appellent « Pizza Margherita » en base, « Margherita » à l'écran sous le titre Pizzas.
export function nomAffiche(plat: Pick<LignePlat, "nom" | "categorie_slug">): string {
  if (plat.categorie_slug !== "pizzas") return plat.nom;
  const n = plat.nom.replace(/^Pizza /, "");
  return n.charAt(0).toUpperCase() + n.slice(1);
}
