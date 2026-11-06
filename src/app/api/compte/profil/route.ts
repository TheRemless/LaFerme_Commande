import { NextResponse } from "next/server";
import { corpsJson, exigerCompte, refus } from "@/lib/comptes/api";
import { ipCourt, ipDe } from "@/lib/comptes/securite";
import { fonctionSql } from "@/lib/db/serveur";
import { clientValide } from "@/lib/validation";

export async function POST(requete: Request) {
  const g = await exigerCompte(requete);
  if ("reponse" in g) return g.reponse;
  const corps = await corpsJson(requete);
  // Même contrôle qu'au passage de commande ; l'e-mail reste celui du compte.
  const c = clientValide({ ...corps, email: g.compte.email });
  if (!c) return refus("Vérifiez le prénom, le nom et le téléphone.");
  await fonctionSql("modifier_profil", {
    p_compte: g.compte.id,
    p: { prenom: c.prenom, nom: c.nom, telephone: c.telephone },
    p_ip_court: ipCourt(ipDe(requete)),
  });
  return NextResponse.json({ enregistre: true });
}
