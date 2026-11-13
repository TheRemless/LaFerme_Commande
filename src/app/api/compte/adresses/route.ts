import { NextResponse } from "next/server";
import { corpsJson, exigerCompte, refus } from "@/lib/comptes/api";
import { ipCourt, ipDe } from "@/lib/comptes/securite";
import { fonctionSql } from "@/lib/db/serveur";
import { detailsValides } from "@/lib/validation";

// Adresses enregistrées : retirer une adresse, ou corriger ses consignes de livraison (mêmes contrôles qu'à la
// commande). La base ne touche qu'aux adresses du compte de la session.
// POST { supprimer: id } | { modifier: id, details: { etage, sonnette, code, instructions } }
export async function POST(requete: Request) {
  const g = await exigerCompte(requete);
  if ("reponse" in g) return g.reponse;
  const corps = await corpsJson(requete);
  const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v);
  const ip = ipCourt(ipDe(requete));
  if (corps?.modifier !== undefined) {
    if (!uuid(corps.modifier)) return refus("Adresse inconnue.", 404);
    const details = detailsValides(corps.details);
    if (!details) return refus("Indiquez le nom sur la sonnette. Étage et code : 30 caractères au plus, instructions : 140.");
    const ok = await fonctionSql<boolean>("modifier_details_adresse", { p_compte: g.compte.id, p_adresse: corps.modifier, p_details: details, p_ip_court: ip });
    return ok ? NextResponse.json({ modifiee: true }) : refus("Adresse inconnue.", 404);
  }
  const id = corps?.supprimer;
  if (!uuid(id)) return refus("Adresse inconnue.", 404);
  await fonctionSql("supprimer_adresse", { p_compte: g.compte.id, p_adresse: id, p_ip_court: ip });
  return NextResponse.json({ supprimee: true });
}
