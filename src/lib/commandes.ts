import "server-only";
import { chargerCatalogue } from "@/lib/catalogue";
import { estimationAsap } from "@/lib/estimation";
import { courrielConfirmation, courrielRemboursement, courrielRemboursementGeste } from "@/lib/courriel/modeles";
import { envoyerCourriel } from "@/lib/courriel/envoi";
import { chargerConfigService } from "@/lib/config-service";
import { appliquerPaiement, commandeParId, fonctionSql, type Commande } from "@/lib/db/serveur";
import type { Catalogue } from "@/lib/panier";
import { pauseEnCours, quandPossible, type ConfigService } from "@/lib/service";
import { paiementDisponible, passerelle, remboursementSimule } from "@/lib/paiement/passerelle";
import { signalerTablette } from "@/lib/tablette";

// Ce qui suit un événement de paiement. Une seule source de vérité : appliquer_paiement en base,
// qui n'accepte chaque événement qu'une fois. Le courriel ne part que si l'événement a changé la commande.

async function envoyerConfirmation(c: Commande): Promise<void> {
  // La commande devient visible sur la tablette : on la prévient tout de suite.
  await signalerTablette();
  const cat = await chargerCatalogue().catch(() => null);
  const estimation = await chargerConfigService()
    .then((config) => estimationAsap(config, c))
    .catch(() => null);
  const m = courrielConfirmation(c, cat, estimation);
  await envoyerCourriel({ commandeId: c.id, destinataire: c.client_email, ...m }).catch((e) => {
    // Le paiement est acquis : un courriel qui échoue ne doit pas le défaire. La tablette montre la commande.
    console.error(`Courriel de confirmation non envoyé pour la commande ${c.numero} : ${e instanceof Error ? e.message : e}`);
  });
}

// Ce qui a changé entre la commande et son paiement (le client peut rester 30 minutes sur la page de
// paiement) : pause, plat épuisé, heure qui ne tient plus. Noté sur la commande pour la tablette (SS-08).
export function avertissementsPaiement(c: Commande, config: ConfigService, cat: Catalogue | null, maintenant = new Date()): string[] {
  const a: string[] = [];
  if (pauseEnCours(config, maintenant, c.mode)) a.push("Payée pendant la pause des commandes en ligne.");
  const epuises = [...new Set(c.lignes.filter((l) => cat?.plats[l.plat_slug]?.rupture_motif).map((l) => l.nom))];
  if (epuises.length) a.push(`Épuisé depuis la commande : ${epuises.join(", ")}.`);
  const zone = config.zones.find((z) => z.numero === c.zone_numero);
  const quand = c.quand_type === "creneau" && c.quand_date && c.quand_minutes !== null ? { type: "creneau" as const, date: c.quand_date, minutes: c.quand_minutes } : { type: "asap" as const };
  if (!quandPossible({ ...config, pause: undefined }, maintenant, c.mode, zone, c.pizzas_seulement, quand)) {
    a.push(quand.type === "asap" ? "Payée après la dernière heure de commande." : "L'heure demandée ne tient plus au moment du paiement.");
  }
  return a;
}

async function noterAvertissements(c: Commande): Promise<void> {
  const [config, cat] = await Promise.all([chargerConfigService(), chargerCatalogue().catch(() => null)]);
  const a = avertissementsPaiement(c, config, cat);
  if (a.length) await fonctionSql("noter_avertissement", { p_commande: c.id, p_texte: a.join(" ") });
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
    if (apres) {
      // Un avertissement raté ne défait pas le paiement : la commande arrive quand même sur la tablette.
      await noterAvertissements(apres).catch((e) => console.error(`Avertissement non noté pour la commande ${apres.numero} : ${e instanceof Error ? e.message : e}`));
      await envoyerConfirmation(apres);
    }
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

// ---------- Remboursement après coup (audit du gérant, G02) ----------

type LigneRemboursement = {
  id: string;
  commande_id: string;
  montant_centimes: number;
  moyen: "stripe" | "especes";
  statut: "en_cours" | "fait" | "echec";
  erreur: string | null;
  deja?: boolean;
  change?: boolean;
};

const ERREURS_REMBOURSEMENT: Record<string, string> = {
  statut_non_remboursable: "Cette commande n'est pas encore prête. Pour l'annuler, utilisez « Annuler la commande » sur la tablette.",
  pas_encaissee: "Cette commande n'a pas été encaissée, ou elle est déjà remboursée en entier.",
  montant_trop_eleve: "Le montant dépasse ce qui reste à rembourser sur cette commande.",
  montant_invalide: "Montant invalide.",
  motif_invalide: "Écrivez un motif (3 caractères au moins). Le client le reçoit par e-mail.",
  cle_reutilisee: "Ce formulaire a déjà servi pour un autre montant. Rechargez la fiche de la commande.",
  cle_invalide: "Rechargez la fiche de la commande.",
  commande_inconnue: "Commande introuvable.",
  sans_paiement_en_ligne: "Paiement en ligne introuvable pour cette commande : vérifiez dans Stripe.",
  "Réservé au gérant": "Réservé au gérant.",
};

// Erreurs où Stripe a répondu et refusé : rien n'est parti (requête invalide, droits, carte).
function refusNetStripe(e: unknown): boolean {
  const type = (e as { type?: string } | null)?.type;
  return type === "StripeInvalidRequestError" || type === "StripeCardError" || type === "StripePermissionError" || type === "StripeAuthenticationError";
}

export function messageErreurRemboursement(e: unknown): string | null {
  const m = e instanceof Error ? e.message : String(e);
  const cle = Object.keys(ERREURS_REMBOURSEMENT).find((k) => m.includes(k));
  return cle ? ERREURS_REMBOURSEMENT[cle] : null;
}

// Rembourse tout ou partie d'une commande déjà prête, partie ou terminée. La base réserve le montant (jamais
// plus que le total, une seule ligne par clé), puis Stripe rembourse avec la même clé : un double appui ou
// une reprise après coupure ne rembourse pas deux fois. Au comptoir, le rendu en espèces est seulement noté.
export async function rembourserApresCoup(
  commandeId: string,
  montantCentimes: number,
  motif: string,
  cle: string,
  personnelId: string,
): Promise<{ ok: boolean; message: string }> {
  let r: LigneRemboursement;
  try {
    r = await fonctionSql<LigneRemboursement>("demander_remboursement", {
      p_commande: commandeId,
      p_montant: montantCentimes,
      p_motif: motif,
      p_cle: cle,
      p_personnel: personnelId,
    });
  } catch (e) {
    const message = messageErreurRemboursement(e);
    if (message) return { ok: false, message };
    throw e;
  }
  const c = await commandeParId(commandeId);
  if (!c) return { ok: false, message: "Commande introuvable." };
  let envoyer = r.statut === "fait" && !r.deja && r.moyen === "stripe";
  if (r.moyen === "stripe" && r.statut === "en_cours") {
    try {
      const pi = c.stripe_payment_intent ?? "";
      const s = remboursementSimule(pi, cle) ?? (await passerelle().rembourser(pi, { montantCentimes, cle }));
      r = await fonctionSql<LigneRemboursement>("terminer_remboursement", { p_id: r.id, p_ok: true, p_refund_id: s.id, p_erreur: null });
      envoyer = r.statut === "fait" && r.change === true;
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      // Relance d'un geste déjà en cours (double appui, deuxième onglet), ou Stripe sans réponse claire (délai,
      // réseau, erreur de son côté) : le remboursement a pu partir. On ne le marque pas en échec ; une relance
      // plus tard, même clé, le termine sans doublon. Seul un refus net de Stripe le passe en échec.
      if (r.deja || !refusNetStripe(e)) {
        console.error(`Relance du remboursement de la commande ${c.numero} pas encore aboutie : ${detail}`);
        return { ok: false, message: "Ce remboursement est encore en cours chez Stripe. Rechargez la fiche dans une minute." };
      }
      console.error(`Remboursement de la commande ${c.numero} refusé par Stripe : ${detail}`);
      await fonctionSql("terminer_remboursement", { p_id: r.id, p_ok: false, p_refund_id: null, p_erreur: detail });
      return { ok: false, message: "Stripe a refusé le remboursement. Rien n'a été rendu. Réessayez plus tard ou vérifiez dans Stripe." };
    }
  }
  if (envoyer) {
    const m = courrielRemboursementGeste(c, montantCentimes, motif);
    await envoyerCourriel({ commandeId: c.id, destinataire: c.client_email, ...m }).catch((e) =>
      console.error(`Courriel de remboursement non envoyé pour la commande ${c.numero} : ${e instanceof Error ? e.message : e}`),
    );
  }
  if (r.statut === "echec") return { ok: false, message: "Ce remboursement a déjà échoué. Rechargez la fiche pour en refaire un." };
  const montant = (montantCentimes / 100).toFixed(2);
  if (r.moyen === "especes") return { ok: true, message: `CHF ${montant} notés comme rendus en espèces.` };
  return { ok: true, message: r.deja && !envoyer ? `Remboursement de CHF ${montant} déjà fait.` : `CHF ${montant} remboursés. Le client reçoit un e-mail.` };
}
