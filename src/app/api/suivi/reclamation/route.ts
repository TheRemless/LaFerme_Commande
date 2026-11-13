import { NextResponse } from "next/server";
import { corpsJson, refus } from "@/lib/comptes/api";
import { requeteDuSite } from "@/lib/comptes/origine-requete";
import { fonctionSql } from "@/lib/db/serveur";
import { texteLibre, TYPES_RECLAMATION } from "@/lib/gestion-reclamations";
import { TELEPHONE_RESTAURANT } from "@/lib/livraisons-textes";
import { alerter } from "@/lib/surveillance";

// Le client signale un problème depuis son suivi (vague 3, bo-commandes ; formulaire de client-compte).
// Le jeton voyage dans le corps, jamais dans l'adresse. La base limite à trois réclamations par commande,
// acceptée ou terminée, dans les 14 jours. Le restaurant reçoit une alerte par e-mail (numéro et type, rien d'autre).
// POST { jeton, type, description } → 200 { ok, message } | 404 | 409 | 422 { erreur }
export async function POST(requete: Request) {
  if (!requeteDuSite(requete)) return refus("Requête refusée.", 403);
  const c = await corpsJson(requete);
  if (!c || typeof c.jeton !== "string" || !/^[A-Za-z0-9_-]{20,64}$/.test(c.jeton)) return refus("Commande introuvable.", 404);
  if (!(TYPES_RECLAMATION as readonly unknown[]).includes(c.type)) return refus("Choisissez ce qui ne va pas.");
  const description = texteLibre(c.description, 3, 500);
  if (!description) return refus("Décrivez le problème en quelques mots (500 caractères au plus).");
  const r = await fonctionSql<{ resultat: string; numero?: number }>("reclamation_client", { p_jeton: c.jeton, p_type: c.type, p_description: description });
  if (r.resultat === "inconnue") return refus("Commande introuvable.", 404);
  if (r.resultat === "impossible") return refus(`Pour cette commande, appelez-nous au ${TELEPHONE_RESTAURANT}.`, 409);
  if (r.resultat === "trop") return refus(`Nous avons déjà votre message. Pour la suite, appelez-nous au ${TELEPHONE_RESTAURANT}.`, 409);
  await alerter(`Commande ${r.numero} : réclamation du client`, [
    `Le client de la commande ${r.numero} signale un problème (${c.type}) depuis son suivi.`,
    "Le détail est dans le back-office, rubrique Réclamations.",
  ]).catch((e) => console.error(`Alerte de réclamation non envoyée : ${e instanceof Error ? e.message : e}`));
  return NextResponse.json({ ok: true, message: "Merci, le restaurant a reçu votre message." }, { headers: { "Cache-Control": "no-store" } });
}
