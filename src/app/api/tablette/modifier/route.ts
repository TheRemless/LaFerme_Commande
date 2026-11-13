import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { lirePublic } from "@/lib/db/lecture";
import { fonctionSql } from "@/lib/db/serveur";
import { modifierCommande } from "@/lib/modifier-commande";
import { exigerPersonnel, type Personnel } from "@/lib/personnel/session";

// Modifier une commande depuis la tablette (vague 3, contrat de bo-commandes #65) : prénom, nom, téléphone et
// consignes de livraison. L'adresse se change au back-office (recherche d'adresse et zone). Le gérant toujours ;
// l'équipe de service seulement si le réglage modification_par_equipe est vrai (construit désactivé, décision de
// Jérémy). La base revérifie (modifier_commande) ; modifierCommande prévient le client et imprime « MODIFIÉE ».
// GET : { autorise }. POST { commande, prenom?, nom?, telephone?, details?, de? }.
const SANS_CACHE = { "Cache-Control": "no-store" };

async function autorise(p: Personnel): Promise<boolean> {
  if (p.role === "gerant") return true;
  // Responsable de service au rôle ouvert (D1) : droit « modifier_commande », sans le réglage de l'équipe.
  if (p.role === "responsable" && (await fonctionSql<boolean>("droit_personnel", { p_personnel: p.id, p_action: "modifier_commande" }))) return true;
  const reglages = await lirePublic<{ cle: string; valeur: unknown }>("reglages").catch(() => []);
  return reglages.find((r) => r.cle === "modification_par_equipe")?.valeur === true;
}

export async function GET(requete: Request) {
  const g = await exigerPersonnel(requete, { lecture: true });
  if ("reponse" in g) return g.reponse;
  return NextResponse.json({ autorise: await autorise(g.personnel) }, { headers: SANS_CACHE });
}

export async function POST(requete: Request) {
  const g = await exigerPersonnel(requete);
  if ("reponse" in g) return g.reponse;
  if (!(await autorise(g.personnel))) return refus("Seul le gérant peut modifier cette commande.", 403);
  const c = await corpsJson(requete);
  if (!c || typeof c.commande !== "string" || !/^[0-9a-f-]{36}$/.test(c.commande)) return refus("Commande inconnue.", 404);
  const r = await modifierCommande(
    c.commande,
    { prenom: c.prenom, nom: c.nom, telephone: c.telephone, details: c.details },
    g.personnel,
    { de: typeof c.de === "string" ? c.de : undefined, depuis: "tablette" },
  );
  if (!r.ok) return refus(r.message);
  return NextResponse.json(r, { headers: SANS_CACHE });
}
