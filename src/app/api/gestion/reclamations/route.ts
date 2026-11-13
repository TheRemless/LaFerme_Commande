import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { fonctionSql } from "@/lib/db/serveur";
import { filtresReclamations, gesteReclamation, nouvelleReclamation, suiviReclamation } from "@/lib/gestion-reclamations";
import { exigerGerant } from "@/lib/personnel/session";

// Réclamations des clients au back-office (vague 3, bo-commandes), gérant seulement. Tout en POST.
// { action: "liste", ...filtres } | { action: "fiche", id } | { action: "ouvrir", commande_id, type, description, source? }
// | { action: "suivre", id, texte?, statut?, resolution? } | { action: "geste", id, geste, detail? | remboursement_id }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ERREURS: Record<string, [string, number]> = {
  commande_inconnue: ["Commande inconnue.", 404],
  client_inconnu: ["Client introuvable.", 404],
  reclamation_inconnue: ["Réclamation introuvable.", 404],
  reclamation_close: ["Cette réclamation est close.", 409],
  geste_deja_note: ["Un geste est déjà noté sur cette réclamation.", 409],
  remboursement_invalide: ["Ce remboursement n'est pas celui de cette commande, ou il a échoué.", 409],
  gestes_desactives: ["Les gestes pour la prochaine commande ne sont pas encore activés.", 409],
  codes_desactives: ["Une réduction passe par un code promo : les codes promo ne sont pas encore activés.", 409],
  reduction_invalide: ["Indiquez un montant, ou un pourcentage de 1 à 100.", 422],
  resolution_manquante: ["Écrivez comment la réclamation s'est réglée.", 422],
  detail_invalide: ["Précisez le geste (3 à 200 caractères).", 422],
};

export async function POST(requete: Request) {
  const g = await exigerGerant(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c) return refus("Requête illisible.", 400);
  const sansCache = { headers: { "Cache-Control": "no-store" } };
  try {
    if (c.action === "liste") {
      const f = filtresReclamations(c);
      if (!f.ok) return refus(f.erreur);
      return NextResponse.json(await fonctionSql("reclamations_gestion", { p: f.valeur }), sansCache);
    }
    if (c.action === "ouvrir") {
      const f = nouvelleReclamation(c);
      if (!f.ok) return refus(f.erreur);
      return NextResponse.json(await fonctionSql("ouvrir_reclamation", { p: f.valeur, p_personnel: g.personnel.id }), sansCache);
    }
    if (typeof c.id !== "string" || !UUID.test(c.id)) return refus("Réclamation introuvable.", 404);
    if (c.action === "fiche") {
      const fiche = await fonctionSql("fiche_reclamation_gestion", { p_id: c.id });
      return fiche ? NextResponse.json(fiche, sansCache) : refus("Réclamation introuvable.", 404);
    }
    if (c.action === "suivre") {
      const f = suiviReclamation(c);
      if (!f.ok) return refus(f.erreur);
      return NextResponse.json(await fonctionSql("suivre_reclamation", { p_id: c.id, p: f.valeur, p_personnel: g.personnel.id }), sansCache);
    }
    if (c.action === "geste") {
      const f = gesteReclamation(c);
      if (!f.ok) return refus(f.erreur);
      return NextResponse.json(await fonctionSql("noter_geste_reclamation", { p_id: c.id, p: f.valeur, p_personnel: g.personnel.id }), sansCache);
    }
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const cle = Object.keys(ERREURS).find((k) => m.includes(k));
    if (cle) return refus(ERREURS[cle][0], ERREURS[cle][1]);
    throw e;
  }
  return refus("Action inconnue.");
}
