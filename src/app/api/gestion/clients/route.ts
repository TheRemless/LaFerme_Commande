import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { fonctionSql } from "@/lib/db/serveur";
import { emailClient, filtresClients, MARQUES, motifMarque, texteNote } from "@/lib/gestion-clients";
import type { ActionDroit } from "@/lib/personnel/droits";
import { exigerDroit, exigerGerant } from "@/lib/personnel/session";

// Clients du back-office (vague 3, bo-commandes) : un client est un e-mail, avec ou sans compte. Tout passe en
// POST : un e-mail, un nom ou un téléphone n'apparaît jamais dans une adresse.
// { action: "liste", ...filtres } | { action: "fiche", email } | { action: "noter", email, texte }
// | { action: "marquer", email, marque: "surveiller" | "bloque" | null, motif? } (désactivé par défaut, D2)
const ERREURS: Record<string, [string, number]> = {
  client_inconnu: ["Client introuvable.", 404],
  note_invalide: ["Écrivez une note de 2 à 500 caractères.", 422],
  marque_desactivee: ["Marquer un client n'est pas encore activé.", 409],
  marque_invalide: ["Marque inconnue.", 422],
  motif_invalide: ["Écrivez un motif de 3 à 200 caractères.", 422],
};

function erreurConnue(e: unknown): NextResponse | null {
  const m = e instanceof Error ? e.message : String(e);
  const cle = Object.keys(ERREURS).find((k) => m.includes(k));
  return cle ? refus(ERREURS[cle][0], ERREURS[cle][1]) : null;
}

// Responsable de service (D1) : la liste et la fiche d'un client ; notes et marque restent au gérant.
const DROITS: Record<string, ActionDroit> = { liste: "voir_commandes", fiche: "voir_commandes" };

export async function POST(requete: Request) {
  const c = await corpsJson(requete);
  const droit = typeof c?.action === "string" && Object.hasOwn(DROITS, c.action) ? DROITS[c.action] : undefined;
  const g = droit ? await exigerDroit(requete, droit) : await exigerGerant(requete);
  if ("reponse" in g) return g.reponse;
  if (!c) return refus("Requête illisible.", 400);
  const sansCache = { headers: { "Cache-Control": "no-store" } };

  if (c.action === "liste") {
    const f = filtresClients(c);
    if (!f.ok) return refus(f.erreur);
    return NextResponse.json(await fonctionSql("clients_gestion", { p: f.valeur }), sansCache);
  }

  const email = emailClient(c.email);
  if (!email) return refus("Client introuvable.", 404);

  try {
    if (c.action === "fiche") {
      const fiche = await fonctionSql("fiche_client_gestion", { p_email: email });
      return fiche ? NextResponse.json(fiche, sansCache) : refus("Client introuvable.", 404);
    }
    if (c.action === "noter") {
      const texte = texteNote(c.texte);
      if (!texte) return refus("Écrivez une note de 2 à 500 caractères.");
      return NextResponse.json(await fonctionSql("ajouter_note_client", { p_email: email, p_texte: texte, p_personnel: g.personnel.id }), sansCache);
    }
    if (c.action === "marquer") {
      const marque = c.marque === null ? null : (MARQUES as readonly unknown[]).includes(c.marque) ? (c.marque as string) : undefined;
      if (marque === undefined) return refus("Marque inconnue.");
      const motif = marque === null ? null : motifMarque(c.motif);
      if (marque !== null && !motif) return refus("Écrivez un motif de 3 à 200 caractères.");
      return NextResponse.json(
        { marque: await fonctionSql("marquer_client", { p_email: email, p_marque: marque, p_motif: motif, p_personnel: g.personnel.id }) },
        sansCache,
      );
    }
  } catch (e) {
    const r = erreurConnue(e);
    if (r) return r;
    throw e;
  }
  return refus("Action inconnue.");
}
