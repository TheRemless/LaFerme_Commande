import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { rembourserApresCoup } from "@/lib/commandes";
import { fonctionSql } from "@/lib/db/serveur";
import { centimes, dateValide } from "@/lib/gestion";
import { filtresListe, texteNote, UUID } from "@/lib/gestion-commandes";
import { modifierCommande } from "@/lib/modifier-commande";
import { exigerGerant } from "@/lib/personnel/session";

// Commandes passées et remboursement après coup (audit du gérant, G02 et G04). Tout passe en POST :
// un nom ou un téléphone cherché ne doit jamais apparaître dans une adresse (journaux, historique).
// { action: "liste", debut?, fin?, recherche? } | { action: "jours", debut, fin } | { action: "fiche", id }
// | { action: "rembourser", id, montant, motif, cle }
// Vague 3 (bo-commandes) : { action: "liste_page", ...filtres (src/lib/gestion-commandes.ts) }
// | { action: "fiche_complete", id } | { action: "courriel", id, courriel } | { action: "noter", id, texte }
// | { action: "modifier", id, de?, prenom?, nom?, telephone?, details?, adresse? } (vague 3, sans toucher au montant)

export async function POST(requete: Request) {
  const g = await exigerGerant(requete);
  if ("reponse" in g) return g.reponse;
  const c = await corpsJson(requete);
  if (!c) return refus("Requête illisible.", 400);
  const sansCache = { headers: { "Cache-Control": "no-store" } };

  if (c.action === "liste_page") {
    const f = filtresListe(c);
    if (!f.ok) return refus(f.erreur);
    return NextResponse.json(await fonctionSql("liste_commandes_gestion", { p: f.valeur }), sansCache);
  }

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

  if (c.action === "fiche_complete") {
    const [fiche, reclamations] = await Promise.all([
      fonctionSql<Record<string, unknown> | null>("fiche_commande_gestion", { p_id: c.id }),
      // Réclamations de la commande (vague 3) : absentes tant que la base n'est pas migrée.
      fonctionSql<{ lignes: unknown[] }>("reclamations_gestion", { p: { commande_id: c.id, par_page: 100 } }).catch(() => null),
    ]);
    return fiche ? NextResponse.json({ ...fiche, reclamations: reclamations?.lignes ?? [] }, sansCache) : refus("Commande inconnue.", 404);
  }

  if (c.action === "courriel") {
    if (typeof c.courriel !== "string" || !UUID.test(c.courriel)) return refus("E-mail inconnu.", 404);
    const m = await fonctionSql("courriel_commande_gestion", { p_commande: c.id, p_courriel: c.courriel });
    return m ? NextResponse.json(m, sansCache) : refus("E-mail inconnu.", 404);
  }

  if (c.action === "noter") {
    const texte = texteNote(c.texte);
    if (!texte) return refus("Écrivez une note de 2 à 500 caractères.");
    try {
      return NextResponse.json(await fonctionSql("ajouter_note_commande", { p_commande: c.id, p_texte: texte, p_personnel: g.personnel.id }), sansCache);
    } catch (e) {
      if (e instanceof Error && e.message.includes("commande_inconnue")) return refus("Commande inconnue.", 404);
      throw e;
    }
  }

  if (c.action === "modifier") {
    const de = typeof c.de === "string" ? c.de : undefined;
    const r = await modifierCommande(c.id, { prenom: c.prenom, nom: c.nom, telephone: c.telephone, details: c.details, adresse: c.adresse }, g.personnel, { de, depuis: "gestion" });
    return NextResponse.json(r, { status: r.ok ? 200 : 409, ...sansCache });
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
    // Réponse ambiguë de Stripe : 503, pour que la fiche garde sa clé (un nouvel essai reprend le même
    // remboursement au lieu d'en créer un second ; audit de sécurité 2, S2-04).
    return NextResponse.json(r, { status: r.ok ? 200 : r.enCours ? 503 : 409, ...sansCache });
  }
  return refus("Action inconnue.");
}
