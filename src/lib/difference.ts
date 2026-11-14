import "server-only";
import { chargerCatalogue } from "@/lib/catalogue";
import { rembourserLigne, type LigneRemboursement } from "@/lib/commandes";
import { chargerConfigService } from "@/lib/config-service";
import { envoyerCourriel } from "@/lib/courriel/envoi";
import { courrielLienComplement, courrielPlatsModifies } from "@/lib/courriel/modeles";
import { commandeParId, fonctionSql, type Commande } from "@/lib/db/serveur";
import { imprimerModification } from "@/lib/impression/modification";
import { posteDuSac, ticketsDeCommande } from "@/lib/impression/ticket";
import { nomClient } from "@/lib/nom-plat";
import { passerelle } from "@/lib/paiement/passerelle";
import { calculerPanier, platDe, prixChoix, type Catalogue } from "@/lib/panier";
import type { Personnel } from "@/lib/personnel/session";
import { alerter } from "@/lib/surveillance";
import { signalerTablette } from "@/lib/tablette";
import { detailsTablette } from "@/lib/tablette-details";
import { detailsValides, lignesValides } from "@/lib/validation";
import { zoneServeur } from "@/lib/zone-serveur";

// Le client appelle pour changer sa commande (vague 3, bo-commandes ; décision du chef du 14.11.2026). Jamais de
// débit sur sa carte sans son accord sur le moment :
// - à encaisser (comptoir, téléphone) : appliquée tout de suite, le total change ;
// - payée et moins chère : appliquée, la différence remboursée (Stripe, ou espèces si payée au comptoir) ;
// - payée et plus chère : par défaut un lien de paiement de la différence, rien ne change avant le paiement
//   (webhook) ; repli au choix de l'équipe : complément à encaisser à la porte ou au comptoir.
// Ajout de plats : tickets « AJOUT » aux postes concernés, seulement les lignes ajoutées ; retraits : « MODIFIÉE ».
// Prix toujours recalculés ici depuis la base (calculerPanier), jamais pris du navigateur. Gérant ou responsable.

export type Reglement = "aucun" | "lien" | "porte" | "comptoir" | "remboursement";
type LigneSql = {
  slug: string;
  nom: string;
  station: string;
  qte: number;
  unitaire_centimes: number;
  total_centimes: number;
  choix: Record<string, string[]>;
  prix_choix: unknown;
  retraits: string[];
  note: string;
  pour: string;
};
type Calcul =
  | { ok: false; message: string }
  | {
      ok: true;
      c: Commande;
      catalogue: Catalogue;
      lignes: LigneSql[];
      ajouts: LigneSql[];
      retires: { nom: string; qte: number; station: string }[];
      totaux: { sous_total_centimes: number; frais_centimes: number; total_centimes: number; tva_centimes: number; pizzas_seulement: boolean };
      valeur: number;
      difference: number;
      adresse: unknown;
      details: unknown;
      zoneNumero: number | null;
      reglements: Reglement[];
    };

const CLE = /^[A-Za-z0-9-]{16,64}$/;
const MODIFIABLE = ["nouvelle", "acceptee", "en_preparation", "prete"];

function cleLigne(l: { slug: string; choix: Record<string, string[]>; retraits: string[]; note: string }): string {
  const choix = Object.keys(l.choix ?? {})
    .sort()
    .map((k) => [k, [...(l.choix[k] ?? [])].sort()]);
  return JSON.stringify([l.slug, choix, [...(l.retraits ?? [])].sort(), (l.note ?? "").trim()]);
}

export function texteLigne(cat: Catalogue | null, l: { slug?: string; nom: string; qte: number; station?: string }): string {
  const pizza = l.station === "pizza" || (!!cat && !!l.slug && platDe(cat, l.slug)?.categorie_slug === "pizzas");
  return `${l.qte} × ${nomClient(l.nom, pizza)}`;
}

async function calculer(commandeId: string, d: Record<string, unknown>): Promise<Calcul> {
  const c = await commandeParId(commandeId);
  if (!c) return { ok: false, message: "Commande introuvable." };
  if (!MODIFIABLE.includes(c.statut)) return { ok: false, message: "Une commande partie, terminée ou annulée ne change plus." };
  const voulues = lignesValides(d.lignes);
  if (!voulues || voulues.length === 0) return { ok: false, message: "Il faut au moins un plat. Pour tout retirer, annulez la commande." };
  const [catalogue, config] = await Promise.all([chargerCatalogue(), chargerConfigService()]);

  let adresse: unknown = null;
  let details: unknown = null;
  let zoneNumero: number | null = null;
  let livraison: { frais_centimes: number; minimum_centimes: number } | null = null;
  // Frais actuels : ceux de la dernière adresse appliquée (une commande payée garde ses frais payés au départ).
  const fraisActuels = await fonctionSql<number>("frais_commande", { p_commande: c.id }).catch(() => c.frais_centimes);
  if (c.mode === "livraison") {
    const zoneActuelle = config.zones.find((z) => z.numero === c.zone_numero);
    livraison = { frais_centimes: fraisActuels, minimum_centimes: zoneActuelle?.minimum_centimes ?? 0 };
    // Nouvelle adresse (une autre zone, plus chère ou non) : contrôlée comme au site, ses frais remplacent les anciens.
    if (d.adresse && typeof d.adresse === "object") {
      const r = await zoneServeur(config, d.adresse, true);
      if ("erreur" in r) return { ok: false, message: r.erreur };
      if (r.statut !== "livrable") return { ok: false, message: "Cette adresse est hors de notre zone de livraison, ou la zone est fermée." };
      const det = detailsValides(d.details ?? c.details_livraison);
      if (!det) return { ok: false, message: "Indiquez le nom sur la sonnette." };
      adresse = r.adresse;
      details = det;
      zoneNumero = r.zone.numero;
      livraison = { frais_centimes: r.zone.frais_centimes, minimum_centimes: r.zone.minimum_centimes };
    }
  }

  const totaux = calculerPanier(catalogue, voulues, livraison);
  const fausse = totaux.lignes.find((l) => l.erreur);
  if (fausse) return { ok: false, message: `${nomClient(fausse.nom, platDe(catalogue, fausse.slug)?.categorie_slug === "pizzas")} : ${fausse.erreur}` };
  if (totaux.manque_minimum_centimes > 0) return { ok: false, message: "Le minimum de commande de la zone n'est pas atteint." };

  // Prénom par ligne (« pour Léa ») gardé pour une ligne déjà là.
  const pourDe = new Map(c.lignes.map((l) => [cleLigne({ slug: l.plat_slug, choix: l.choix ?? {}, retraits: l.retraits ?? [], note: l.note ?? "" }), (l as { pour?: string }).pour ?? ""]));
  const lignes: LigneSql[] = totaux.lignes.map((l) => ({
    slug: l.slug,
    nom: l.nom,
    station: catalogue.plats[l.slug].station,
    qte: l.qte,
    unitaire_centimes: l.unitaire_centimes,
    total_centimes: l.total_centimes,
    choix: l.choix,
    prix_choix: prixChoix(catalogue, l),
    retraits: l.retraits,
    note: l.note.trim(),
    pour: pourDe.get(cleLigne({ slug: l.slug, choix: l.choix, retraits: l.retraits, note: l.note })) ?? "",
  }));

  // Ajouts et retraits, ligne par ligne (même plat, mêmes options) : pour les tickets et l'e-mail.
  const avant = new Map<string, { nom: string; qte: number; station: string }>();
  for (const l of c.lignes) {
    const k = cleLigne({ slug: l.plat_slug, choix: l.choix ?? {}, retraits: l.retraits ?? [], note: l.note ?? "" });
    const x = avant.get(k);
    avant.set(k, { nom: l.nom, station: l.station, qte: (x?.qte ?? 0) + l.qte });
  }
  const ajouts: LigneSql[] = [];
  for (const l of lignes) {
    const k = cleLigne(l);
    const deja = avant.get(k)?.qte ?? 0;
    if (l.qte > deja) ajouts.push({ ...l, qte: l.qte - deja, total_centimes: l.unitaire_centimes * (l.qte - deja) });
    if (avant.has(k)) avant.set(k, { ...avant.get(k)!, qte: Math.max(0, deja - l.qte) });
  }
  const retires = [...avant.values()].filter((x) => x.qte > 0);

  const valeur = c.lignes.reduce((t, l) => t + l.total_centimes, 0) + fraisActuels;
  const difference = totaux.total_centimes - valeur;
  const reglements: Reglement[] =
    c.statut_paiement === "a_encaisser_retrait"
      ? ["aucun"]
      : difference < 0
        ? ["remboursement"]
        : difference === 0
          ? ["aucun"]
          : ["lien", c.mode === "livraison" ? "porte" : "comptoir"];
  if (!["a_encaisser_retrait", "paye", "encaisse"].includes(c.statut_paiement)) return { ok: false, message: "Cette commande n'est pas payée : elle ne se modifie pas ici." };
  return { ok: true, c, catalogue, lignes, ajouts, retires, totaux, valeur, difference, adresse, details, zoneNumero, reglements };
}

export type Apercu =
  | { ok: false; message: string }
  | { ok: true; valeur: number; total: number; difference: number; reglements: Reglement[]; ajouts: string[]; retires: string[]; paye: boolean };

export async function apercuDifference(commandeId: string, d: Record<string, unknown>): Promise<Apercu> {
  const r = await calculer(commandeId, d);
  if (!r.ok) return r;
  return {
    ok: true,
    valeur: r.valeur,
    total: r.totaux.total_centimes,
    difference: r.difference,
    reglements: r.reglements,
    ajouts: r.ajouts.map((l) => texteLigne(r.catalogue, l)),
    retires: r.retires.map((l) => texteLigne(r.catalogue, l)),
    paye: r.c.statut_paiement !== "a_encaisser_retrait",
  };
}

const ERREURS: Record<string, string> = {
  droit_refuse: "Réservé au gérant ou au responsable de service.",
  deja_change: "La commande a changé entre-temps. Rechargez la fiche.",
  statut_non_modifiable: "Une commande partie, terminée ou annulée ne change plus.",
  modification_en_attente: "Une modification attend déjà son paiement. Abandonnez-la d'abord.",
  reglement_invalide: "Choisissez comment le client paie la différence.",
  paiement_non_modifiable: "Cette commande n'est pas payée : elle ne se modifie pas ici.",
  cle_reutilisee: "Rechargez la fiche et recommencez.",
  montant_trop_eleve: "Le remboursement dépasse ce qui reste payé sur cette commande.",
};

export type ResultatDifference = { ok: true; message: string; lien?: string; enAttente?: boolean } | { ok: false; message: string };

export async function modifierPlats(commandeId: string, d: Record<string, unknown>, p: Personnel, origine: string): Promise<ResultatDifference> {
  if (typeof d.cle !== "string" || !CLE.test(d.cle)) return { ok: false, message: "Rechargez la fiche et recommencez." };
  const r = await calculer(commandeId, d);
  if (!r.ok) return r;
  const reglement = typeof d.reglement === "string" ? d.reglement : null;
  if (r.reglements.length > 1 && !r.reglements.includes(reglement as Reglement)) return { ok: false, message: ERREURS.reglement_invalide };
  let m: Record<string, unknown> & { id: string; statut: string; reglement: Reglement; difference_centimes: number; applique?: boolean; deja?: boolean };
  try {
    m = await fonctionSql("preparer_modification", {
      p_commande: commandeId,
      p: {
        cle: d.cle,
        de: typeof d.de === "string" ? d.de : null,
        reglement,
        lignes: r.lignes,
        ajouts: r.ajouts,
        retires: r.retires,
        pizzas_seulement: r.totaux.pizzas_seulement,
        sous_total_centimes: r.totaux.sous_total_centimes,
        frais_centimes: r.totaux.frais_centimes,
        total_centimes: r.totaux.total_centimes,
        tva_centimes: r.totaux.tva_centimes,
        adresse: r.adresse,
        details_livraison: r.details,
        zone_numero: r.zoneNumero,
        valeur_avant: r.valeur,
      },
      p_personnel: p.id,
    });
  } catch (e) {
    const texte = e instanceof Error ? e.message : String(e);
    const cle = Object.keys(ERREURS).find((k) => texte.includes(k));
    if (cle) return { ok: false, message: ERREURS[cle] };
    throw e;
  }
  if (m.deja) return { ok: true, message: m.statut === "en_attente" ? "Le lien de paiement est déjà parti." : "Modification déjà enregistrée." };

  if (m.reglement === "lien") {
    const montant = m.difference_centimes;
    const suivi = `${origine}/suivi/${r.c.jeton_suivi}`;
    let session: { id: string; url: string };
    try {
      session = await passerelle().creerSession({
      commandeId: r.c.id,
      numero: r.c.numero,
      email: r.c.client_email,
      lignes: [{ libelle: `Complément, commande n° ${r.c.numero}`, qte: 1, unitaire_centimes: montant }],
      urlRetour: `${suivi}?retour=1`,
      urlAnnulation: suivi,
      origine,
      metadata: { type: "complement", modification_id: m.id },
      reference: `complement_${m.id}`,
      cheminDoublure: `/paiement-test/complement/${m.id}`,
      description: `La Ferme, complément de la commande ${r.c.numero}`,
      });
    } catch (e) {
      // Pas de lien : la modification est abandonnée tout de suite, l'équipe peut recommencer.
      console.error(`Lien du complément non créé pour la commande ${r.c.numero} : ${e instanceof Error ? e.message : e}`);
      await fonctionSql("abandonner_modification", { p_modification: m.id, p_personnel: p.id }).catch(() => {});
      return { ok: false, message: "Le lien de paiement n'a pas pu être créé. Rien n'a changé : réessayez, ou choisissez « à encaisser »." };
    }
    if (!(await fonctionSql<boolean | null>("lier_session_modification", { p_modification: m.id, p_session: session.id }))) {
      await passerelle().expirerSession(session.id).catch(() => {});
      return { ok: false, message: "La commande a changé entre-temps. Rechargez la fiche." };
    }
    const ajouts = r.ajouts.map((l) => texteLigne(r.catalogue, l));
    if (r.c.client_email) {
      await envoyerCourriel({ commandeId: r.c.id, destinataire: r.c.client_email, ...courrielLienComplement(r.c, ajouts, montant, session.url) }).catch((e) =>
        console.error(`Lien du complément non envoyé pour la commande ${r.c.numero} : ${e instanceof Error ? e.message : e}`),
      );
    }
    return {
      ok: true,
      enAttente: true,
      lien: session.url,
      message: r.c.client_email
        ? "Lien de paiement envoyé au client par e-mail. La modification part en cuisine dès le paiement reçu."
        : "Pas d'e-mail pour ce client : copiez le lien et envoyez-le-lui par SMS. La modification part en cuisine dès le paiement reçu.",
    };
  }
  await apresApplication(m as unknown as Application);
  const montant = (Math.abs(m.difference_centimes) / 100).toFixed(2);
  const texte: Record<Reglement, string> = {
    aucun: r.c.statut_paiement === "a_encaisser_retrait" ? `Commande modifiée. Nouveau total à encaisser : CHF ${(r.totaux.total_centimes / 100).toFixed(2)}.` : "Commande modifiée, même montant.",
    remboursement: remboursementTexte(m as unknown as Application),
    porte: `Commande modifiée. Complément de CHF ${montant} à encaisser à la livraison.`,
    comptoir: `Commande modifiée. Complément de CHF ${montant} à encaisser au retrait.`,
    lien: "",
  };
  return { ok: true, message: texte[m.reglement] };
}

// Message à l'équipe pour une baisse : seulement ce qui repart vraiment, et le complément dû qui baisse.
function remboursementTexte(a: Application): string {
  const chf = (c: number) => `CHF ${(c / 100).toFixed(2)}`;
  const morceaux = ["Commande modifiée."];
  if (a.du_avant_centimes) morceaux.push(`Complément à encaisser : ${chf(a.du_avant_centimes)} → ${chf(a.du_apres_centimes ?? 0)}.`);
  if (a.remboursement?.montant_centimes) morceaux.push(`${chf(a.remboursement.montant_centimes)} remboursés au client.`);
  return morceaux.join(" ");
}

type Application = {
  applique: boolean;
  raison?: string;
  a_rembourser?: boolean;
  montant_centimes?: number | null;
  commande_id?: string;
  numero?: number;
  reglement?: Reglement;
  difference_centimes?: number;
  ajouts?: LigneSql[];
  retires?: { nom: string; qte: number; station: string }[];
  remboursement?: (LigneRemboursement & { cle?: string }) | null;
  du_avant_centimes?: number | null;
  du_apres_centimes?: number | null;
  complement?: { montant_centimes: number; moyen: string } | null;
};

// Après une modification appliquée : tickets, remboursement chez Stripe, e-mail au client, tablette.
async function apresApplication(a: Application): Promise<void> {
  if (!a.applique || !a.commande_id) return;
  const [c, cat] = await Promise.all([commandeParId(a.commande_id), chargerCatalogue().catch(() => null)]);
  if (!c) return;
  const ajouts = a.ajouts ?? [];
  const retires = a.retires ?? [];
  const complement = a.complement && a.complement.moyen !== "en_ligne" ? { centimes: a.complement.montant_centimes, ou: a.complement.moyen as "porte" | "comptoir" } : undefined;
  // Tickets seulement si les premiers sont sortis : sinon ils sortiront déjà avec les nouveaux plats.
  if (c.tickets_le && ["acceptee", "en_preparation", "prete"].includes(c.statut)) {
    if (ajouts.length) {
      const sac = posteDuSac({ lignes: c.lignes.map((l) => ({ nom: l.nom, qte: l.qte, station: l.station, details: [] })) });
      const tickets = ticketsDeCommande(
        {
          ...c,
          // Une boisson (poste « comptoir ») ajoutée part au poste qui fait le sac de la commande entière.
          lignes: ajouts.map((l) => ({
            nom: l.nom,
            qte: l.qte,
            station: (l.station === "comptoir" ? sac : l.station) as "pizza" | "cuisine",
            details: detailsTablette(cat, l),
            pour: l.pour,
          })),
        },
        { accepteLe: c.accepte_le ?? new Date(), entete: "AJOUT", complement },
      );
      await fonctionSql("creer_taches_impression", { p_commande: c.id, p: tickets, p_reimpression: false }).catch((e) =>
        console.error(`Ticket AJOUT non créé pour la commande ${c.numero} : ${e instanceof Error ? e.message : e}`),
      );
    }
    // Le montant encore dû s'imprime de lui-même sur « MODIFIÉE » (imprimerModification).
    const changements = [
      ...retires.map((l) => ({ champ: "Retiré", avant: texteLigne(cat, l), apres: "rien" })),
      ...(complement && !ajouts.length ? [{ champ: "Complément", avant: "rien", apres: `CHF ${(complement.centimes / 100).toFixed(2)}` }] : []),
    ];
    if (changements.length) await imprimerModification(c.id, changements).catch((e) => console.error(`Ticket MODIFIÉE non créé pour la commande ${c.numero} : ${e instanceof Error ? e.message : e}`));
  }
  if (a.remboursement && a.remboursement.moyen === "stripe" && a.remboursement.statut === "en_cours") {
    const r = await rembourserLigne(a.remboursement, c, a.remboursement.cle ?? `modification-${a.remboursement.id}`).catch((e) => ({ ok: false, message: String(e) }));
    if (!r.ok) console.error(`Remboursement de la modification non abouti pour la commande ${c.numero} : ${r.message}`);
  }
  if (c.client_email) {
    await envoyerCourriel({
      commandeId: c.id,
      destinataire: c.client_email,
      ...courrielPlatsModifies(c, {
        ajouts: ajouts.map((l) => texteLigne(cat, l)),
        retires: retires.map((l) => texteLigne(cat, l)),
        difference: a.difference_centimes ?? 0,
        reglement: a.reglement ?? "aucun",
        rembourse: a.remboursement?.montant_centimes ?? null,
        du: a.du_avant_centimes ? { avant: a.du_avant_centimes, apres: a.du_apres_centimes ?? 0 } : null,
      }),
    }).catch((e) => console.error(`E-mail de modification non envoyé pour la commande ${c.numero} : ${e instanceof Error ? e.message : e}`));
  }
  await signalerTablette();
}

export type PreuveComplement = { sessionId: string; montantCentimes: number | null; devise: string | null; paymentIntent: string | null };

// Webhook (ou doublure) : le lien est payé. La modification s'applique une fois, si la session et le montant sont ceux
// de la modification. Payé alors que la commande est partie ou finie : l'argent est là, le gérant est alerté.
export async function confirmerComplement(modificationId: string, evenement: string, preuve: PreuveComplement): Promise<boolean> {
  const a = await fonctionSql<Application>("confirmer_complement", {
    p_modification: modificationId,
    p_session: preuve.sessionId,
    p_evenement: evenement,
    p_payment_intent: preuve.paymentIntent,
    p_montant: preuve.montantCentimes,
    p_devise: preuve.devise?.toLowerCase() ?? null,
  });
  if (a.applique) {
    await apresApplication(a);
    return true;
  }
  // Argent reçu sans modification appliquée : le gérant est alerté pour rembourser (qualite, relecture DIFFÉRENCE).
  const montant = a.montant_centimes ? `CHF ${(a.montant_centimes / 100).toFixed(2)}` : "le complément";
  const commande = a.numero ? `la commande ${a.numero}` : "une commande modifiée";
  const raisons: Record<string, string> = {
    commande_finie: `Le client a payé ${montant} pour ${commande}, mais elle était déjà partie, terminée ou annulée. La modification ne s'est pas appliquée.`,
    abandonnee_payee: `Le client a payé ${montant} pour ${commande}, mais la modification avait été abandonnée. Rien n'a changé dans la commande.`,
    montant: `Un paiement de ${montant} est arrivé pour ${commande}, au lieu du montant attendu. La modification ne s'est pas appliquée.`,
  };
  if (a.raison && raisons[a.raison] && (a.a_rembourser || a.raison === "montant")) {
    await alerter("Complément payé sans modification", [raisons[a.raison], "Remboursez ce paiement depuis Stripe."]).catch((e) =>
      console.error(`Alerte non envoyée : ${e instanceof Error ? e.message : e}`),
    );
  } else if (a.raison === "session") {
    console.error(`Paiement de complément non rapproché (session) pour la modification ${modificationId}.`);
  }
  return false;
}

export async function expirerComplement(modificationId: string, sessionId: string): Promise<void> {
  await fonctionSql("expirer_complement", { p_modification: modificationId, p_session: sessionId });
}

// L'équipe renonce à une modification en attente de paiement : le lien est fermé chez Stripe.
export async function abandonnerModification(modificationId: string, p: Personnel): Promise<ResultatDifference> {
  // Le lien d'abord : déjà payé, la modification va s'appliquer ; sinon il est fermé chez Stripe avant l'abandon.
  const session = await fonctionSql<string | null>("lien_modification", { p_modification: modificationId });
  if (session) {
    const etat = await passerelle().lireSession(session).catch(() => null);
    if (etat?.statut === "paye") return { ok: false, message: "Le client vient de payer : la modification s'applique dans un instant. Rechargez la fiche." };
    try {
      await passerelle().expirerSession(session);
    } catch (e) {
      console.error(`Lien non fermé chez Stripe : ${e instanceof Error ? e.message : e}`);
      return { ok: false, message: "Le lien n'a pas pu être fermé chez Stripe. Réessayez dans un instant." };
    }
  }
  try {
    const r = await fonctionSql<{ abandonnee: boolean; stripe_session_id?: string | null }>("abandonner_modification", { p_modification: modificationId, p_personnel: p.id });
    if (!r.abandonnee) return { ok: false, message: "Cette modification n'attend plus rien." };
    return { ok: true, message: "Modification abandonnée. Le lien de paiement ne marche plus." };
  } catch (e) {
    if (e instanceof Error && e.message.includes("droit_refuse")) return { ok: false, message: ERREURS.droit_refuse };
    throw e;
  }
}

// Complément encaissé à la porte (livreur) ou au comptoir (équipe).
export async function encaisserComplement(complementId: string, moyen: unknown, p: Personnel): Promise<{ ok: boolean; message: string }> {
  if (moyen !== "especes" && moyen !== "carte") return { ok: false, message: "Espèces ou carte ?" };
  try {
    const ok = await fonctionSql<boolean>("encaisser_complement", { p_complement: complementId, p_moyen: moyen, p_personnel: p.id });
    if (ok) await signalerTablette();
    return ok ? { ok: true, message: `Complément encaissé ${moyen === "especes" ? "en espèces" : "par carte"}.` } : { ok: false, message: "Déjà encaissé." };
  } catch (e) {
    if (e instanceof Error && e.message.includes("droit_refuse")) return { ok: false, message: "Ce n'est pas votre livraison." };
    throw e;
  }
}
