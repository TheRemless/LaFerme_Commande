import "server-only";
import { chargerCatalogue } from "@/lib/catalogue";
import { estimationAsap } from "@/lib/estimation";
import { courrielConfirmation, courrielManque, courrielRemboursement, courrielRemboursementGeste } from "@/lib/courriel/modeles";
import { prixChf } from "@/lib/prix";
import { envoyerCourriel } from "@/lib/courriel/envoi";
import { chargerConfigService } from "@/lib/config-service";
import { appliquerPaiement, commandeParId, fonctionSql, type Commande } from "@/lib/db/serveur";
import type { Catalogue } from "@/lib/panier";
import { pauseEnCours, quandPossible, type ConfigService } from "@/lib/service";
import { type EtatRemboursement, paiementDisponible, passerelle, remboursementSimule } from "@/lib/paiement/passerelle";
import { alerter } from "@/lib/surveillance";
import { signalerTablette } from "@/lib/tablette";

// Ce qui suit un événement de paiement. Une seule source de vérité : appliquer_paiement en base,
// qui n'accepte chaque événement qu'une fois. Le courriel ne part que si l'événement a changé la commande.

async function envoyerConfirmation(c: Commande): Promise<void> {
  // La commande devient visible sur la tablette : on la prévient tout de suite.
  await signalerTablette();
  const cat = await chargerCatalogue().catch(() => null);
  const config = await chargerConfigService().catch(() => null);
  let estimation: number | null = null;
  try {
    estimation = config ? estimationAsap(config, c) : null;
  } catch {
    estimation = null;
  }
  // Heure en fourchette comme à l'accueil (vague 3, client-compte).
  const m = courrielConfirmation(c, cat, estimation, config);
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
  const epuises = [
    ...new Set([
      ...c.lignes.filter((l) => cat?.plats[l.plat_slug]?.rupture_motif).map((l) => l.nom),
      // Supplément épuisé entre la commande et le paiement (audit du gérant, G07).
      ...c.lignes.flatMap((l) =>
        Object.entries(l.choix ?? {}).flatMap(([g, noms]) => noms.filter((n) => cat?.groupes[g]?.options.find((o) => o.nom === n)?.rupture)),
      ),
    ]),
  ];
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
  // Stripe a refusé tout de suite : rien n'est rendu (la tablette propose de recommencer).
  if (r.statut === "failed" || r.statut === "canceled") {
    console.error(`Remboursement de la commande ${c.numero} refusé par Stripe (${r.statut}).`);
    return { rembourse: false };
  }
  // Accepté par Stripe : le client lit « remboursé », comme avant. Une ligne suit le remboursement jusqu'à sa
  // confirmation (charge.refund.updated) ; un échec plus tard alerte le restaurant (audit de sécurité 2, S2-03).
  const applique = await appliquerPaiement(`remboursement:${r.id}`, c.id, "rembourse");
  await fonctionSql("noter_remboursement_refus", { p_commande: c.id, p_refund_id: r.id, p_fait: r.statut === "succeeded", p_motif: motif }).catch((e) =>
    console.error(`Suivi du remboursement de la commande ${c.numero} non noté : ${e instanceof Error ? e.message : e}`),
  );
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
  moyen: "stripe" | "especes" | "deduction";
  statut: "en_cours" | "fait" | "echec";
  erreur: string | null;
  stripe_refund_id?: string | null;
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
  // Responsable de service sans le droit « rembourser », ou rôle éteint (D1, auteur_droit).
  droit_refuse: "Réservé au gérant.",
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
): Promise<{ ok: boolean; message: string; enCours?: boolean }> {
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
  const stripe = await rembourserChezStripe(r, c, montantCentimes, cle);
  if ("refus" in stripe) return stripe.refus;
  r = stripe.r;
  const envoyer = stripe.envoyer;
  if (envoyer) {
    const m = courrielRemboursementGeste(c, montantCentimes, motif);
    await envoyerCourriel({ commandeId: c.id, destinataire: c.client_email, ...m }).catch((e) =>
      console.error(`Courriel de remboursement non envoyé pour la commande ${c.numero} : ${e instanceof Error ? e.message : e}`),
    );
  }
  if (r.statut === "echec") return { ok: false, message: "Ce remboursement a déjà échoué. Rechargez la fiche pour en refaire un." };
  const montant = (montantCentimes / 100).toFixed(2);
  if (r.moyen === "especes") return { ok: true, message: `CHF ${montant} notés comme rendus en espèces.` };
  if (r.statut === "en_cours") return { ok: true, message: `Remboursement de CHF ${montant} demandé à Stripe, en attente de sa confirmation. Le client reçoit un e-mail.` };
  return { ok: true, message: r.deja && !envoyer ? `Remboursement de CHF ${montant} déjà fait.` : `CHF ${montant} remboursés. Le client reçoit un e-mail.` };
}

// Remboursement Stripe d'une ligne « en cours » (G02 et manque signalé, G07). La clé du geste sert de clé
// d'idempotence chez Stripe. Seul un refus net de Stripe passe la ligne en échec ; une relance ou une réponse
// ambiguë (délai, réseau) la laisse en cours, à relancer avec la même clé, sans doublon.
async function rembourserChezStripe(
  r: LigneRemboursement,
  c: Commande,
  montantCentimes: number,
  cle: string,
): Promise<{ r: LigneRemboursement; envoyer: boolean } | { refus: { ok: false; message: string; enCours?: boolean } }> {
  if (r.moyen !== "stripe" || r.statut !== "en_cours") return { r, envoyer: r.statut === "fait" && !r.deja && r.moyen === "stripe" };
  // Déjà accepté par Stripe, en attente de sa confirmation : rien à redemander (S2-03).
  if (r.stripe_refund_id) {
    return { refus: { ok: false, message: "Ce remboursement attend la confirmation de Stripe. Rechargez dans quelques minutes.", enCours: true } };
  }
  try {
    const pi = c.stripe_payment_intent ?? "";
    // Relance : la première demande a pu aboutir chez Stripe sans que sa réponse arrive (délai, réseau). On
    // reprend ce remboursement au lieu d'en créer un second, que Stripe accepterait après 24 heures.
    const repris = !remboursementSimule(pi, cle) && r.deja ? ((await passerelle().retrouverRemboursement?.(pi, r.id)) ?? null) : null;
    const s = remboursementSimule(pi, cle) ?? repris ?? (await passerelle().rembourser(pi, { montantCentimes, cle, remboursementId: r.id }));
    if (s.statut === "failed" || s.statut === "canceled") {
      await fonctionSql("terminer_remboursement", { p_id: r.id, p_ok: false, p_refund_id: s.id, p_erreur: `Stripe : ${s.statut}` });
      return { refus: { ok: false, message: "Stripe a refusé le remboursement. Rien n'a été rendu. Réessayez plus tard ou vérifiez dans Stripe." } };
    }
    if (s.statut !== "succeeded") {
      // Accepté mais pas encore rendu (TWINT notamment) : la ligne reste en cours, hors de l'export, jusqu'à
      // l'événement charge.refund.updated. Le client est prévenu dès maintenant, comme avant (S2-03).
      const notee = await fonctionSql<LigneRemboursement>("noter_remboursement_stripe", { p_id: r.id, p_refund_id: s.id });
      return { r: notee, envoyer: notee.change === true };
    }
    const fini = await fonctionSql<LigneRemboursement>("terminer_remboursement", { p_id: r.id, p_ok: true, p_refund_id: s.id, p_erreur: null });
    return { r: fini, envoyer: fini.statut === "fait" && fini.change === true };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    if (r.deja || !refusNetStripe(e)) {
      console.error(`Relance du remboursement de la commande ${c.numero} pas encore aboutie : ${detail}`);
      return { refus: { ok: false, message: "Ce remboursement est encore en cours chez Stripe. Rechargez dans une minute.", enCours: true } };
    }
    console.error(`Remboursement de la commande ${c.numero} refusé par Stripe : ${detail}`);
    await fonctionSql("terminer_remboursement", { p_id: r.id, p_ok: false, p_refund_id: null, p_erreur: detail });
    return { refus: { ok: false, message: "Stripe a refusé le remboursement. Rien n'a été rendu. Réessayez plus tard ou vérifiez dans Stripe." } };
  }
}

// État final d'un remboursement annoncé par Stripe (webhook charge.refund.updated, ou la doublure). Seul
// « succeeded » rend la ligne « faite » (elle entre alors dans l'export) ; « failed » ou « canceled » la passe
// en échec et alerte le restaurant, une seule fois. Les états intermédiaires et les remboursements inconnus
// (faits dans le tableau de bord Stripe) ne changent rien (audit de sécurité 2, S2-03).
export async function appliquerEtatRemboursement(
  refundId: string,
  etat: EtatRemboursement,
  raison: string | null,
  remboursementId?: string | null,
): Promise<boolean> {
  // Réponse de Stripe perdue à la création : la ligne n'a pas l'identifiant du remboursement. On la retrouve
  // par l'identifiant gardé dans les metadata, une seule fois (seulement une ligne en cours, sans identifiant).
  if (remboursementId && /^[0-9a-f-]{36}$/.test(remboursementId)) {
    await fonctionSql("noter_remboursement_stripe", { p_id: remboursementId, p_refund_id: refundId });
  }
  if (etat !== "succeeded" && etat !== "failed" && etat !== "canceled") return false;
  const ok = etat === "succeeded";
  const r = await fonctionSql<(LigneRemboursement & { numero: number }) | null>("maj_remboursement_stripe", {
    p_refund_id: refundId,
    p_ok: ok,
    p_erreur: ok ? null : `Stripe : ${raison ?? etat}`,
  });
  if (!r || r.change !== true) return false;
  if (!ok) {
    await alerter(`Commande ${r.numero} : remboursement échoué chez Stripe`, [
      `Stripe n'a pas pu rendre CHF ${(r.montant_centimes / 100).toFixed(2)} au client de la commande ${r.numero} (${raison ?? etat}).`,
      "Le client a déjà reçu l'e-mail de remboursement. Rappelez-le, puis remboursez-le depuis le tableau de bord Stripe ou en espèces.",
      "Dans le back-office, la fiche de la commande montre ce remboursement « échoué ». Il n'entre pas dans l'export comptable.",
    ], "alerte", "remboursement").catch((e) => console.error(`Alerte de remboursement échoué non envoyée (commande ${r.numero}) : ${e instanceof Error ? e.message : e}`));
  }
  return true;
}

// ---------- Manque signalé depuis la tablette (audit du gérant, G07 option A) ----------

export type ElementManque = { ligne: number; qte: number } | { ligne: number; groupe: string; nom: string };

const ERREURS_MANQUE: Record<string, string> = {
  deja_signale: "C'est déjà signalé pour cette commande.",
  ligne_inconnue: "Choix invalide. Rechargez la page.",
  option_absente: "Choix invalide. Rechargez la page.",
  elements_invalides: "Choisissez ce qui manque.",
  statut_non_remboursable: "Acceptez d'abord la commande.",
  reserve_au_gerant: "Commande déjà prête ou partie : seul le gérant peut rembourser ce qui manque.",
  pas_encaissee: "Commande pas payée, ou déjà remboursée.",
  montant_trop_eleve: "Plus rien à rembourser sur cette commande.",
  personnel_inactif: "Session terminée. Reconnectez-vous.",
  cle_reutilisee: "Rechargez la page puis recommencez.",
  cle_invalide: "Rechargez la page puis recommencez.",
  commande_inconnue: "Commande introuvable.",
};

// Calcule (confirmer = false) ou rembourse (confirmer = true) ce qui manque sur une commande acceptée. Le montant
// vient de la base. Payée en ligne : Stripe ; au comptoir pas encore payé : déduit de ce qu'il reste à encaisser.
export async function signalerManque(
  commandeId: string,
  elements: ElementManque[],
  cle: string,
  personnelId: string,
  confirmer: boolean,
): Promise<{ ok: boolean; message: string; montant_centimes?: number; description?: string }> {
  let r: LigneRemboursement & { description: string; montant_centimes: number };
  try {
    r = await fonctionSql("signaler_manque", { p_commande: commandeId, p_elements: elements, p_cle: cle, p_personnel: personnelId, p_confirmer: confirmer });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    const k = Object.keys(ERREURS_MANQUE).find((x) => m.includes(x));
    if (k) return { ok: false, message: ERREURS_MANQUE[k] };
    throw e;
  }
  const montant = prixChf(r.montant_centimes);
  if (!confirmer) {
    return { ok: true, montant_centimes: r.montant_centimes, description: r.description, message: `À rembourser : ${montant} (${r.description}).` };
  }
  const c = await commandeParId(commandeId);
  if (!c) return { ok: false, message: "Commande introuvable." };
  const stripe = await rembourserChezStripe(r, c, r.montant_centimes, cle);
  if ("refus" in stripe) return stripe.refus;
  const envoyer = r.moyen === "stripe" ? stripe.envoyer : !r.deja;
  // Ce qui reste à encaisser au comptoir, tous les manques déduits.
  const deduit = r.moyen === "deduction"
    ? (await fonctionSql<{ commande_id: string; deduit_centimes: number }[]>("manques_en_cours", {})).find((x) => x.commande_id === c.id)?.deduit_centimes ?? r.montant_centimes
    : 0;
  if (envoyer) {
    const m = courrielManque(c, r.description, r.montant_centimes, r.moyen, c.total_centimes - deduit);
    await envoyerCourriel({ commandeId: c.id, destinataire: c.client_email, ...m }).catch((e) =>
      console.error(`Courriel du manque non envoyé pour la commande ${c.numero} : ${e instanceof Error ? e.message : e}`),
    );
  }
  await signalerTablette();
  const base = { ok: true, montant_centimes: r.montant_centimes, description: r.description };
  if (r.moyen === "deduction") return { ...base, message: `${montant} déduits. À encaisser : ${prixChf(c.total_centimes - deduit)}. Le client est prévenu par e-mail.` };
  if (r.moyen === "especes") return { ...base, message: `Rendez ${montant} au client en espèces. Le client est prévenu par e-mail.` };
  return { ...base, message: `${montant} remboursés. Le client est prévenu par e-mail.` };
}
