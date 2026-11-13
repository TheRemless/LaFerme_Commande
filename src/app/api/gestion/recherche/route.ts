import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { exigerDroit } from "@/lib/personnel/session";
import { rechercher, texteRecherche } from "@/lib/recherche-gestion";

// Recherche globale du back-office (⌘K). POST seulement : le texte cherché (nom, téléphone) reste hors de l'adresse.
// Gérant, et responsable de service (D1, droit voir_commandes) : commandes et clients, sans les plats (la carte
// lui est fermée).
export async function POST(requete: Request) {
  // Requête du site seulement, comme toute écriture : une page tierce ne peut pas la déclencher.
  const g = await exigerDroit(requete, "voir_commandes");
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  const q = texteRecherche(c?.q);
  if (!q) return refus("Tapez au moins deux lettres ou un numéro.");
  return NextResponse.json(await rechercher(q, { plats: g.personnel.role === "gerant" }), { headers: { "Cache-Control": "no-store" } });
}
