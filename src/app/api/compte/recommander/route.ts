import { NextResponse } from "next/server";
import { corpsJson, exigerCompte, refus } from "@/lib/comptes/api";
import { recommander, type AncienneLigne } from "@/lib/comptes/recommander";
import { chargerCatalogue } from "@/lib/catalogue";
import { fonctionSql } from "@/lib/db/serveur";

export async function POST(requete: Request) {
  const g = await exigerCompte(requete);
  if ("reponse" in g) return g.reponse;
  const corps = await corpsJson(requete);
  const id = corps?.commande;
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) return refus("Commande inconnue.", 404);
  // Seulement une commande du compte de la session : sinon la base renvoie null.
  const anciennes = await fonctionSql<AncienneLigne[] | null>("lignes_commande_compte", { p_compte: g.compte.id, p_commande: id });
  if (!anciennes) return refus("Commande inconnue.", 404);
  return NextResponse.json(recommander(await chargerCatalogue(), anciennes));
}
