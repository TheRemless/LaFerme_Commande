import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { exigerGerant } from "@/lib/personnel/session";
import { rechercher, texteRecherche } from "@/lib/recherche-gestion";

// Recherche globale du back-office (⌘K). POST seulement : le texte cherché (nom, téléphone) reste hors de l'adresse.
export async function POST(requete: Request) {
  // Requête du site seulement, comme toute écriture : une page tierce ne peut pas la déclencher.
  const g = await exigerGerant(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  const q = texteRecherche(c?.q);
  if (!q) return refus("Tapez au moins deux lettres ou un numéro.");
  return NextResponse.json(await rechercher(q), { headers: { "Cache-Control": "no-store" } });
}
