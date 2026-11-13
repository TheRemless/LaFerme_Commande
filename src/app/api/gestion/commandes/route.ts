import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { rembourserApresCoup } from "@/lib/commandes";
import { fonctionSql } from "@/lib/db/serveur";
import { centimes, dateValide } from "@/lib/gestion";
import { filtresListe, texteNote, UUID } from "@/lib/gestion-commandes";
import { actionGestion, type ActionGestion } from "@/lib/actions-gestion";
import { modifierCommande } from "@/lib/modifier-commande";
import type { ActionDroit } from "@/lib/personnel/droits";
import { exigerDroit, exigerGerant } from "@/lib/personnel/session";
import { recreerCommande } from "@/lib/recreer-commande";
import { quandValide } from "@/lib/validation";

// Commandes passées et remboursement après coup (audit du gérant, G02 et G04). Tout passe en POST :
// un nom ou un téléphone cherché ne doit jamais apparaître dans une adresse (journaux, historique).
// { action: "liste", debut?, fin?, recherche? } | { action: "jours", debut, fin } | { action: "fiche", id }
// | { action: "rembourser", id, montant, motif, cle }
// | { action: "recreer", id, quand, cle } (vague 3, désactivé par défaut : commande_telephone_active)
// Vague 3 (bo-commandes) : { action: "liste_page", ...filtres (src/lib/gestion-commandes.ts) }
// | { action: "fiche_complete", id } | { action: "courriel", id, courriel } | { action: "noter", id, texte }
// | { action: "modifier", id, de?, prenom?, nom?, telephone?, details?, adresse? } (vague 3, sans toucher au montant)
// | { action: "heure", id, heure } | { action: "annuler", id, motif, de? } | { action: "reimprimer", id, station? }
// | { action: "renvoyer_courriel", id, courriel } (vague 3, src/lib/actions-gestion.ts)
// | { action: "offrir", id, geste } : un plat offert en attente pour ce client est mis dans cette commande (D3)

const RELANCE_MAX_MS = 23 * 3_600_000;

// Responsable de service (D1, liste de bo-socle) : voir les commandes, rembourser, modifier, annuler. Le reste
// (note, heure, réimpression, renvoi d'e-mail, recréer, plat offert) reste au gérant. La base revérifie.
const DROITS: Record<string, ActionDroit> = {
  options_filtres: "voir_commandes",
  liste_page: "voir_commandes",
  liste: "voir_commandes",
  jours: "voir_commandes",
  fiche: "voir_commandes",
  fiche_complete: "voir_commandes",
  courriel: "voir_commandes",
  rembourser: "rembourser",
  modifier: "modifier_commande",
  annuler: "annuler_apres_prete",
};

export async function POST(requete: Request) {
  const c = await corpsJson(requete);
  const droit = typeof c?.action === "string" && Object.hasOwn(DROITS, c.action) ? DROITS[c.action] : undefined;
  const g = droit ? await exigerDroit(requete, droit) : await exigerGerant(requete);
  if ("reponse" in g) return g.reponse;
  if (!c) return refus("Requête illisible.", 400);
  const sansCache = { headers: { "Cache-Control": "no-store" } };

  if (c.action === "options_filtres") {
    return NextResponse.json(await fonctionSql("options_filtres_commandes", {}), sansCache);
  }

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
    if (!fiche) return refus("Commande inconnue.", 404);
    // Plats offerts en attente pour ce client (D3) : liste vide tant que gestes_commerciaux_actifs est faux.
    const platsOfferts = await fonctionSql<unknown[]>("gestes_en_attente", { p_email: fiche.client_email ?? "" }).catch(() => []);
    return NextResponse.json({ ...fiche, reclamations: reclamations?.lignes ?? [], plats_offerts: platsOfferts }, sansCache);
  }

  if (c.action === "offrir") {
    if (typeof c.id !== "string" || !UUID.test(c.id) || typeof c.geste !== "string" || !UUID.test(c.geste)) return refus("Geste inconnu.", 404);
    try {
      const ok = await fonctionSql<boolean>("appliquer_geste", { p_geste: c.geste, p_commande: c.id, p_personnel: g.personnel.id });
      return ok ? NextResponse.json({ ok: true }, sansCache) : refus("Ce plat offert est déjà donné, ou il est pour un autre client.", 409);
    } catch (e) {
      if (e instanceof Error && e.message.includes("gestes_desactives")) return refus("Offrir un plat à la prochaine commande n'est pas encore activé.", 409);
      throw e;
    }
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

  if (c.action === "recreer") {
    // Clé envoyée par l'écran : un double appui ne crée pas deux commandes.
    if (typeof c.cle !== "string" || !/^[A-Za-z0-9-]{16,64}$/.test(c.cle)) return refus("Rechargez la fiche de la commande.");
    const r = await recreerCommande(c.id, quandValide(c.quand), c.cle, g.personnel);
    return NextResponse.json(r, { status: r.ok ? 200 : 409, ...sansCache });
  }

  if (c.action === "heure" || c.action === "annuler" || c.action === "reimprimer" || c.action === "renvoyer_courriel") {
    const r = await actionGestion(c.id, c as unknown as ActionGestion, g.personnel);
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
    // Relance d'un remboursement resté « en cours » : Stripe oublie ses clés d'idempotence après environ
    // 24 heures. Au-delà de 23 heures, une relance pourrait rembourser une seconde fois : on la refuse.
    const deja = await fonctionSql<{ remboursements?: { cle: string; cree_le: string }[] } | null>("commande_gestion", { p_id: c.id });
    const ancien = deja?.remboursements?.find((x) => x.cle === c.cle);
    if (ancien && Date.now() - Date.parse(ancien.cree_le) > RELANCE_MAX_MS) {
      return refus("Ce remboursement date de plus de 23 heures. Vérifiez dans Stripe s'il est passé avant de rembourser à nouveau.", 409);
    }
    const r = await rembourserApresCoup(c.id, montant, /[.!?]$/.test(m) ? m : `${m}.`, c.cle, g.personnel.id);
    // Réponse ambiguë de Stripe : 503, pour que la fiche garde sa clé (un nouvel essai reprend le même
    // remboursement au lieu d'en créer un second ; audit de sécurité 2, S2-04).
    return NextResponse.json(r, { status: r.ok ? 200 : r.enCours ? 503 : 409, ...sansCache });
  }
  return refus("Action inconnue.");
}
