import "server-only";
import { chargerCatalogue } from "@/lib/catalogue";
import { courrielConfirmation, courrielRemboursement } from "@/lib/courriel/modeles";
import { envoyerCourriel } from "@/lib/courriel/envoi";
import { appliquerPaiement, commandeParId, type Commande } from "@/lib/db/serveur";
import { paiementDisponible, passerelle, remboursementSimule } from "@/lib/paiement/passerelle";
import { signalerTablette } from "@/lib/tablette";

// Ce qui suit un événement de paiement. Une seule source de vérité : appliquer_paiement en base,
// qui n'accepte chaque événement qu'une fois. Le courriel ne part que si l'événement a changé la commande.

async function envoyerConfirmation(c: Commande): Promise<void> {
  // La commande devient visible sur la tablette : on la prévient tout de suite.
  await signalerTablette();
  const cat = await chargerCatalogue().catch(() => null);
  const m = courrielConfirmation(c, cat);
  await envoyerCourriel({ commandeId: c.id, destinataire: c.client_email, ...m }).catch((e) => {
    // Le paiement est acquis : un courriel qui échoue ne doit pas le défaire. La tablette montre la commande.
    console.error(`Courriel de confirmation non envoyé pour la commande ${c.numero} : ${e instanceof Error ? e.message : e}`);
  });
}

export type PreuvePaiement = { sessionId: string; montantCentimes: number | null; devise: string | null; paymentIntent?: string };

// Un paiement ne confirme la commande que s'il vient de sa session en cours, en francs, pour son montant exact.
// Sinon (ancienne session, lien de paiement étranger, montant différent) : rien n'est confirmé et on le signale.
export async function confirmerPaiement(commandeId: string, evenement: string, preuve: PreuvePaiement): Promise<boolean> {
  const c = await commandeParId(commandeId);
  if (!c) return false;
  if (c.stripe_session_id !== preuve.sessionId || preuve.devise?.toLowerCase() !== "chf" || preuve.montantCentimes !== c.total_centimes) {
    console.error(`Paiement non rapproché pour la commande ${c.numero} : session ou montant différents, à vérifier dans Stripe.`);
    return false;
  }
  const applique = await appliquerPaiement(evenement, commandeId, "paye", preuve.paymentIntent, preuve.montantCentimes);
  if (applique) {
    const apres = await commandeParId(commandeId);
    if (apres) await envoyerConfirmation(apres);
  }
  return applique;
}

// Seule la session en cours de la commande peut l'annuler : l'expiration d'un ancien essai ne compte pas.
export async function annulerPaiement(commandeId: string, evenement: string, sessionId: string): Promise<boolean> {
  const c = await commandeParId(commandeId);
  if (!c || c.stripe_session_id !== sessionId) return false;
  return appliquerPaiement(evenement, commandeId, "echec");
}

// Commande payée au comptoir : confirmée tout de suite, sans passer par le paiement en ligne.
export async function confirmerCommandeComptoir(commandeId: string): Promise<void> {
  const c = await commandeParId(commandeId);
  if (c) await envoyerConfirmation(c);
}

// Réconciliation : au retour du client ou à chaque affichage du suivi tant que le paiement est en attente,
// on relit la session chez Stripe. Rattrape un webhook en retard, perdu ou absent (previews).
export async function reconcilier(c: Commande): Promise<Commande> {
  if (c.statut_paiement !== "en_attente" || !c.stripe_session_id || !paiementDisponible()) return c;
  const p = passerelle();
  if (p.nom !== "stripe") return c;
  const etat = await p.lireSession(c.stripe_session_id);
  let change = false;
  if (etat.statut === "paye") {
    change = await confirmerPaiement(c.id, `session:${c.stripe_session_id}:paye`, {
      sessionId: c.stripe_session_id,
      montantCentimes: etat.montantCentimes,
      devise: etat.devise,
      paymentIntent: etat.paymentIntent,
    });
  }
  if (etat.statut === "echec") change = await annulerPaiement(c.id, `session:${c.stripe_session_id}:echec`, c.stripe_session_id);
  return change ? ((await commandeParId(c.id)) ?? c) : c;
}

// Remboursement total d'une commande payée en ligne (refus depuis la tablette, lot 7).
// TWINT n'a pas de capture différée : on encaisse au paiement et on rembourse au refus.
export async function rembourserCommande(commandeId: string, motif: string): Promise<{ rembourse: boolean }> {
  const c = await commandeParId(commandeId);
  if (!c || c.moyen_paiement !== "en_ligne" || c.statut_paiement !== "paye" || !c.stripe_payment_intent) return { rembourse: false };
  const r = remboursementSimule(c.stripe_payment_intent) ?? (await passerelle().rembourser(c.stripe_payment_intent));
  const applique = await appliquerPaiement(`remboursement:${r.id}`, c.id, "rembourse");
  if (applique) {
    const m = courrielRemboursement(c, motif);
    await envoyerCourriel({ commandeId: c.id, destinataire: c.client_email, ...m }).catch((e) =>
      console.error(`Courriel de remboursement non envoyé pour la commande ${c.numero} : ${e instanceof Error ? e.message : e}`),
    );
  }
  return { rembourse: applique };
}
