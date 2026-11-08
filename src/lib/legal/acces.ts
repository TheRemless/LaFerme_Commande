import { aCompleter, type PageLegale } from "@/lib/legal/types";

// Les ébauches légales s'affichent en préversion. En production, une page ne s'ouvre qu'une fois relue
// et validée (variable PAGES_LEGALES_VALIDEES=1) ET sans aucun passage « [à fournir] » restant.
export function pagesLegalesValidees(): boolean {
  return process.env.PAGES_LEGALES_VALIDEES === "1";
}

export function pageLegalePubliable(page: PageLegale): boolean {
  if (process.env.CONTEXTE_DEPLOIEMENT !== "production") return true;
  return pagesLegalesValidees() && aCompleter(page) === 0;
}
