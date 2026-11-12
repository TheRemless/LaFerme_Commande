import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { rembourserApresCoup } from "@/lib/commandes";
import { fonctionSql } from "@/lib/db/serveur";
import { centimes, dateValide } from "@/lib/gestion";
import { exigerGerant } from "@/lib/personnel/session";

// Commandes passées et remboursement après coup (audit du gérant, G02 et G04). Tout passe en POST :
// un nom ou un téléphone cherché ne doit jamais apparaître dans une adresse (journaux, historique).
// { action: "liste", debut?, fin?, recherche? } | { action: "jours", debut, fin } | { action: "fiche", id }
// | { action: "rembourser", id, montant, motif, cle }
const UUID = /^[0-9a-f-]{36}$/;

export async function POST(requete: Request) {
  const g = await exigerGerant(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c) return refus("Requête illisible.", 400);
  const sansCache = { headers: { "Cache-Control": "no-store" } };

  if (c.action === "liste" || c.action === "jours") {
    const debut = c.debut === undefined || c.debut === null || c.debut === "" ? null : dateValide(c.debut);
    const fin = c.fin === undefined || c.fin === null || c.fin === "" ? null : dateValide(c.fin);
    if ((c.debut && !debut) || (c.fin && !fin) || (debut && fin && fin < debut)) return refus("Période invalide.");
    if (debut && fin && Date.parse(fin) - Date.parse(debut) > 400 * 86_400_000) return refus("Période trop longue (un an au plus).");
    if (c.action === "jours") {
      if (!debut || !fin) return refus("Période invalide.");
      return NextResponse.json(await fonctionSql("jours_gestion", { p_debut: debut, p_fin: fin }), sansCache);
    }
    const recherche = typeof c.recherche === "string" ? c.recherche.trim().slice(0, 60) : "";
    return NextResponse.json(await fonctionSql("commandes_gestion", { p_debut: debut, p_fin: fin, p_recherche: recherche || null }), sansCache);
  }

  if (typeof c.id !== "string" || !UUID.test(c.id)) return refus("Commande inconnue.", 404);

  if (c.action === "fiche") {
    const fiche = await fonctionSql("commande_gestion", { p_id: c.id });
    return fiche ? NextResponse.json(fiche, sansCache) : refus("Commande inconnue.", 404);
  }

  if (c.action === "rembourser") {
    // Jusqu'au total de la commande, contrôlé en base ; ici seulement une borne large (grosse commande de groupe).
    const montant = centimes(c.montant, 100_000);
    if (montant === null || montant <= 0) return refus("Montant invalide : un montant en francs, par exemple 21 ou 4.50.");
    if (typeof c.motif !== "string") return refus("Écrivez un motif.");
    const m = c.motif.trim().replace(/\s+/g, " ");
    if (m.length < 3 || m.length > 200) return refus("Écrivez un motif (3 à 200 caractères). Le client le reçoit par e-mail.");
    if (typeof c.cle !== "string" || !/^[A-Za-z0-9-]{8,80}$/.test(c.cle)) return refus("Rechargez la fiche de la commande.");
    const r = await rembourserApresCoup(c.id, montant, /[.!?]$/.test(m) ? m : `${m}.`, c.cle, g.personnel.id);
    return NextResponse.json(r, { status: r.ok ? 200 : 409, ...sansCache });
  }
  return refus("Action inconnue.");
}
