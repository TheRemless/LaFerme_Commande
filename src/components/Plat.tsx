import type { LignePlat } from "@/lib/carte";
import { nomClient } from "@/lib/nom-plat";

// Les pizzas s'appellent « Pizza Margherita » en base, « Margherita » à l'écran sous le titre Pizzas.
export function nomAffiche(plat: Pick<LignePlat, "nom" | "categorie_slug">): string {
  return nomClient(plat.nom, plat.categorie_slug === "pizzas");
}
