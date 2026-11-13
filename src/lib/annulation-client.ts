import "server-only";
import { rembourserCommande } from "@/lib/commandes";
import { courrielRefus, courrielRefusRemboursementEnCours } from "@/lib/courriel/modeles";
import { envoyerCourriel } from "@/lib/courriel/envoi";
import { commandeParId, fonctionSql, type Commande } from "@/lib/db/serveur";
import { TELEPHONE_RESTAURANT } from "@/lib/livraisons-textes";
import { MOTIF_DEMANDE_CLIENT } from "@/lib/motifs";
import { alerter } from "@/lib/surveillance";
import { signalerTablette } from "@/lib/tablette";

// Le client annule sa commande depuis le suivi tant qu'elle n'est pas acceptée (vague 3, arbitrage C1).
// Désactivé par défaut : réglage annulation_client_active (décision de Jérémy). La base tranche sous verrou
// entre l'annulation et l'acceptation ; le serveur rembourse en entier (TWINT sans capture différée), prévient
// le client et la tablette. Même chemin que le refus de la tablette, avec le motif « à votre demande ».

export type ResultatAnnulation = { ok: true; message: string } | { ok: false; status: 403 | 404 | 409; message: string };

const APPELER = `appelez-nous au ${TELEPHONE_RESTAURANT}`;

async function prevenir(c: Commande, m: { sujet: string; texte: string; html: string }): Promise<void> {
  await envoyerCourriel({ commandeId: c.id, destinataire: c.client_email, ...m }).catch((e) =>
    console.error(`Courriel « ${m.sujet} » non envoyé : ${e instanceof Error ? e.message : e}`),
  );
}

export async function annulerParClient(jeton: string): Promise<ResultatAnnulation> {
  const r = await fonctionSql<{ resultat: string; id?: string }>("annuler_par_client", { p_jeton: jeton, p_motif: MOTIF_DEMANDE_CLIENT });
  switch (r.resultat) {
    case "desactivee":
      return { ok: false, status: 403, message: `Pour annuler, ${APPELER}.` };
    case "inconnue":
      return { ok: false, status: 404, message: "Commande introuvable." };
    case "deja_annulee":
      return { ok: true, message: "Votre commande est déjà annulée." };
    case "deja_acceptee":
      return { ok: false, status: 409, message: `Votre commande est déjà acceptée. Pour la changer, ${APPELER}.` };
    case "impossible":
      return { ok: false, status: 409, message: `Cette commande ne peut plus être annulée en ligne. ${APPELER.charAt(0).toUpperCase()}${APPELER.slice(1)}.` };
  }
  const c = r.id ? await commandeParId(r.id) : null;
  if (!c) return { ok: false, status: 404, message: "Commande introuvable." };
  await signalerTablette();
  if (c.moyen_paiement === "en_ligne" && c.statut_paiement === "paye") {
    const remb = await rembourserCommande(c.id, MOTIF_DEMANDE_CLIENT).catch((e) => {
      console.error(`Remboursement impossible pour la commande ${c.numero} : ${e instanceof Error ? e.message : e}`);
      return { rembourse: false };
    });
    if (remb.rembourse) return { ok: true, message: "Votre commande est annulée. Le remboursement est en route, vous recevez un e-mail." };
    // Même suite que le refus de la tablette (SS-04) : le client sait, le restaurant relance.
    await prevenir(c, courrielRefusRemboursementEnCours(c, MOTIF_DEMANDE_CLIENT));
    await alerter(`Commande ${c.numero} : remboursement à refaire`, [
      `Le client a annulé la commande ${c.numero} depuis son suivi, mais le remboursement de ${(c.total_centimes / 100).toFixed(2)} CHF n'est pas passé.`,
      "Sur la tablette, onglet « Terminées », touchez « Rembourser ». Si ça ne passe toujours pas, remboursez depuis Stripe.",
    ], "alerte", "remboursement").catch((e) => console.error(`Alerte non envoyée : ${e instanceof Error ? e.message : e}`));
    return { ok: true, message: "Votre commande est annulée. Le remboursement part dans les prochaines heures, vous recevez un e-mail." };
  }
  await prevenir(c, courrielRefus(c, MOTIF_DEMANDE_CLIENT));
  return { ok: true, message: "Votre commande est annulée." };
}
