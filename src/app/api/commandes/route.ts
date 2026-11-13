import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { chargerCatalogue } from "@/lib/catalogue";
import { confirmerCommandeComptoir } from "@/lib/commandes";
import { chargerConfigService } from "@/lib/config-service";
import { detailsLigne } from "@/lib/courriel/modeles";
import { commandeParId, ConfigurationManquante, creerCommande, fonctionSql, lierSessionPaiement, type CommandeCreee } from "@/lib/db/serveur";
import { origineSure } from "@/lib/origine";
import { calculerPanier, platDe, prixChoix } from "@/lib/panier";
import { erreurPlatsDuJour, momentDe } from "@/lib/plat-du-jour";
import { paiementDisponible, passerelle } from "@/lib/paiement/passerelle";
import { comptoirPermis } from "@/lib/plafond-comptoir";
import { prixPhrase } from "@/lib/prix";
import { depuisHeureGeneve, MESSAGE_CRENEAU_COMPLET, messagePause, messageSansCreneau, pauseEnCours, quandPossible, type Zone } from "@/lib/service";
import { requeteDuSite } from "@/lib/comptes/origine-requete";
import { compteCourant, jetonSession } from "@/lib/comptes/session";
import { empreinte, ipDe } from "@/lib/comptes/securite";
import { allergieValide, champClientInvalide, destinataireValide, cleValide, LIMITE_ALLERGIE, clientValide, MESSAGE_CHAMP, detailsValides, lignesValides, quandValide } from "@/lib/validation";
import { messageZoneFermee, SUITE_ZONE_FERMEE } from "@/lib/zone-fermee";
import { zoneServeur, type AdresseRetenue } from "@/lib/zone-serveur";
import { nomClient } from "@/lib/nom-plat";
import { chargerOptionsCommande } from "@/lib/options-commande";
import { codeTape, messageCode } from "@/lib/code-promo";

// Passage de la commande. Le serveur refait tous les contrôles avec la base : contenu et prix, adresse
// retrouvée dans le registre fédéral, zone, minimum, heure. Il enregistre la commande, puis renvoie
// vers la page de paiement (en ligne) ou directement vers le suivi (paiement au comptoir).

function refus(message: string, status = 422) {
  return NextResponse.json({ erreur: message }, { status });
}

function refusPlafond(plafond: number | null) {
  return plafond === null
    ? "Le paiement au comptoir est indisponible pour le moment. Payez en ligne ou appelez-nous au 022 792 16 89."
    : `Le paiement au comptoir est possible jusqu'à ${prixPhrase(plafond)}. Payez en ligne ou appelez-nous au 022 792 16 89.`;
}

export async function POST(requete: Request) {
  let corps: Record<string, unknown>;
  try {
    corps = await requete.json();
  } catch {
    return refus("Requête illisible.", 400);
  }
  const origine = origineSure(requete);
  if (!origine) return refus("Origine de la requête refusée.", 400);
  // Avec un cookie de session, la commande va dans le compte : on exige alors une requête du site (CSRF).
  if ((await jetonSession()) && !requeteDuSite(requete)) return refus("Requête refusée.", 403);
  const compte = await compteCourant();
  const creerCompte = !compte && corps.creerCompte === true;

  const cle = cleValide(corps.cle);
  const lignes = lignesValides(corps.lignes);
  const client = clientValide(corps.client);
  const mode = corps.mode === "livraison" ? "livraison" : corps.mode === "retrait" ? "retrait" : null;
  const moyen = corps.moyen === "comptoir" ? "comptoir" : corps.moyen === "en_ligne" ? "en_ligne" : null;
  if (!cle || !lignes || lignes.length === 0 || !mode || !moyen) return refus("Commande incomplète. Rechargez la page.");
  if (!client) return refus(MESSAGE_CHAMP[champClientInvalide(corps.client) ?? "telephone"]);
  const allergie = allergieValide(corps.allergie);
  if (allergie === null) return refus(`Allergie ou intolérance trop longue, ${LIMITE_ALLERGIE} caractères au plus.`);
  const destinataire = destinataireValide(corps.destinataire);
  if (destinataire === "nom") return refus("Indiquez le nom de la personne qui reçoit la commande.");
  if (destinataire === "telephone") return refus("Vérifiez le téléphone de la personne qui reçoit la commande, il faut au moins neuf chiffres.");
  // Paiement à la livraison désactivé (décision du prompt) : au comptoir seulement pour un retrait.
  if (moyen === "comptoir" && mode !== "retrait") return refus("Le paiement au comptoir n'est possible qu'à emporter.");
  // Préversion branchée sur la vraie base : aucun paiement, même simulé (audit de sécurité, S2).
  if (moyen === "en_ligne" && !paiementDisponible()) {
    return refus(
      process.env.CONTEXTE_DEPLOIEMENT === "production"
        ? "Le paiement en ligne ne répond pas. Réessayez dans un instant ou appelez-nous au 022 792 16 89."
        : "Préversion branchée sur la vraie base. Le paiement en ligne y est coupé, choisissez le paiement au comptoir.",
      503,
    );
  }

  const [catalogue, config, options] = await Promise.all([chargerCatalogue(), chargerConfigService(), chargerOptionsCommande()]);

  let zone: Zone | undefined;
  let details = null;
  let adresse: AdresseRetenue | null = null;
  if (mode === "livraison") {
    details = detailsValides(corps.details);
    if (!details) return refus("Indiquez le nom sur la sonnette.");
    const r = await zoneServeur(config, corps.adresse, true);
    if ("erreur" in r) return refus(r.erreur, r.code);
    if (r.statut === "zone-fermee") return refus(`${messageZoneFermee(r.jusqua)} ${SUITE_ZONE_FERMEE}`);
    if (r.statut !== "livrable") return refus("Cette adresse est hors de notre zone de livraison.");
    zone = r.zone;
    adresse = r.adresse;
  }

  const totaux = calculerPanier(catalogue, lignes, zone ? { frais_centimes: zone.frais_centimes, minimum_centimes: zone.minimum_centimes } : null);
  const erreurLigne = totaux.lignes.find((l) => l.erreur);
  if (erreurLigne) return refus(`${nomClient(erreurLigne.nom, platDe(catalogue, erreurLigne.slug)?.categorie_slug === "pizzas")} : ${erreurLigne.erreur}`);
  if (totaux.manque_minimum_centimes > 0) return refus("Le minimum de livraison n'est pas atteint.");
  // Code promo (moteur de bo-carte, éteint par défaut) : vérifié, appliqué et noté par la base dans la même
  // transaction que la commande, sous verrou (creer_commande_code). Éteint, un code envoyé est ignoré.
  const code = codeTape(corps.code);
  // Au comptoir, rien n'est payé avant le retrait : au-delà du plafond (réglage en base), en ligne seulement.
  if (moyen === "comptoir" && !comptoirPermis(totaux.total_centimes, config.plafondComptoirCentimes)) {
    return refus(refusPlafond(config.plafondComptoirCentimes));
  }

  const preversion = process.env.CONTEXTE_DEPLOIEMENT !== "production";
  const maintenant = (preversion && typeof corps.heure === "string" ? depuisHeureGeneve(corps.heure) : null) ?? new Date();
  const quand = quandValide(corps.quand);
  const pause = pauseEnCours(config, maintenant, mode);
  if (pause) return refus(messagePause(pause) ?? "Les commandes en ligne sont en pause.");
  if (quand.type === "aucun") return refus(messageSansCreneau(config, maintenant));
  if (!quandPossible(config, maintenant, mode, zone, totaux.pizzas_seulement, quand)) {
    return refus("Ce moment n'est plus disponible. Choisissez une autre heure.");
  }
  // Plat du jour : seulement le jour dit et pour son service.
  const jourRefuse = erreurPlatsDuJour(catalogue, lignes, momentDe(config, maintenant, mode, zone, totaux.pizzas_seulement, quand));
  if (jourRefuse) return refus(`${jourRefuse} Retirez-le du panier ou changez de créneau.`);

  // Au comptoir, rien n'est payé avant le retrait : on limite les commandes en attente (audit, S5).
  // Les tests de bout en bout (même téléphone, même IP) coupent la limite ; la production le refuse.
  if (moyen === "comptoir" && !(process.env.SANS_LIMITE_COMPTOIR === "1" && process.env.CONTEXTE_DEPLOIEMENT !== "production")) {
    const limite = await fonctionSql<string>("limite_comptoir", {
      p_telephone: client.telephone,
      p_email: client.email,
      p_cle_ip: empreinte("ip", ipDe(requete)),
      p_cle: cle,
    });
    if (limite === "contact") {
      return refus("Vous avez déjà deux commandes à payer au comptoir. Pour en passer une autre, payez en ligne ou appelez-nous au 022 792 16 89.", 429);
    }
    if (limite === "ip") return refus("Trop de commandes à payer au comptoir depuis cette connexion. Payez en ligne ou appelez-nous au 022 792 16 89.", 429);
  }

  let creee: CommandeCreee & { total_centimes?: number };
  try {
    const donnees = {
      jeton_suivi: randomBytes(24).toString("base64url"),
      cle_idempotence: cle,
      mode,
      statut: moyen === "comptoir" ? "nouvelle" : "paiement_en_attente",
      statut_paiement: moyen === "comptoir" ? "a_encaisser_retrait" : "en_attente",
      moyen_paiement: moyen,
      client_prenom: client.prenom,
      client_nom: client.nom,
      client_telephone: client.telephone,
      client_email: client.email,
      adresse,
      details_livraison: details,
      zone_numero: zone?.numero ?? null,
      quand_type: quand.type,
      quand_date: quand.type === "creneau" ? quand.date : null,
      quand_minutes: quand.type === "creneau" ? quand.minutes : null,
      pizzas_seulement: totaux.pizzas_seulement,
      sous_total_centimes: totaux.sous_total_centimes,
      frais_centimes: totaux.frais_centimes,
      // Après remise : c'est ce montant que Stripe encaisse et qui plafonne les remboursements.
      // Avant remise : avec un code, creer_commande_code recalcule total et TVA en base.
      total_centimes: totaux.total_centimes,
      tva_centimes: totaux.tva_centimes,
      taux_tva_pourcent: catalogue.tauxTvaPourcent,
      origine,
      compte_id: compte?.id ?? null,
      compte_demande: creerCompte,
      allergie,
      destinataire,
      // Éteints (réglages), les couverts et les prénoms envoyés par le navigateur ne sont pas gardés.
      couverts: options.couverts_actifs && corps.couverts === true,
      lignes: totaux.lignes.map((l) => ({
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
        pour: options.prenom_par_ligne_actif ? (l.pour ?? "") : "",
      })),
    };
    creee = code
      ? await fonctionSql<CommandeCreee & { total_centimes: number }>("creer_commande_code", { p: donnees, p_code: code })
      : await creerCommande(donnees);
  } catch (e) {
    // Code refusé par la base, sous verrou : « code_refuse:<raison>:<minimum> ».
    const refuse = e instanceof Error ? /code_refuse:([a-z_]+):?(\d*)/.exec(e.message) : null;
    if (refuse) {
      if (refuse[1] === "total_nul") return refus("Ce code ne peut pas couvrir toute la commande. Appelez-nous au 022\u00a0792\u00a016\u00a089.");
      return refus(messageCode({ ok: false, raison: refuse[1], minimum_centimes: refuse[2] ? Number(refuse[2]) : undefined }));
    }
    if (e instanceof ConfigurationManquante) return refus(e.message, 503);
    // Capacité du créneau atteinte, contrôlée en base sous verrou (audit « samedi soir », SS-02).
    if (e instanceof Error && e.message.includes("creneau_complet")) return refus(MESSAGE_CRENEAU_COMPLET, 409);
    // Plafond revérifié par la base (réglage changé dans la minute du cache).
    if (e instanceof Error && e.message.includes("plafond_comptoir")) {
      return refus("Le paiement au comptoir n'est pas possible pour cette commande. Payez en ligne ou appelez-nous au 022 792 16 89.");
    }
    throw e;
  }
  const suivi = `${origine}/suivi/${creee.jeton_suivi}`;
  const existante = creee.deja ? await commandeParId(creee.id) : null;
  if (existante && existante.statut_paiement !== "en_attente") return NextResponse.json({ redirection: suivi });

  if (moyen === "comptoir") {
    if (!creee.deja) await confirmerCommandeComptoir(creee.id);
    return NextResponse.json({ redirection: suivi });
  }

  // Paiement en ligne : une ligne par plat (options comprises dans le libellé), puis la livraison.
  const p = passerelle();
  // Nouvel essai pour la même commande (retour arrière depuis Stripe) : l'ancienne session est fermée
  // pour qu'on ne puisse pas payer deux fois.
  if (existante?.stripe_session_id) await p.expirerSession(existante.stripe_session_id).catch(() => undefined);
  // Nouvel essai avec la même clé : on facture la commande enregistrée, jamais le contenu de cette requête.
  const aFacturer = existante
    ? { lignes: existante.lignes, frais: existante.frais_centimes }
    : { lignes: totaux.lignes, frais: totaux.frais_centimes };
  const factures = aFacturer.lignes.map((l) => {
    const options = detailsLigne(catalogue, { choix: l.choix, retraits: l.retraits, note: "" });
    return { libelle: options.length ? `${l.nom} (${options.join(", ")})` : l.nom, qte: l.qte, unitaire_centimes: l.unitaire_centimes };
  });
  if (aFacturer.frais > 0) factures.push({ libelle: "Livraison", qte: 1, unitaire_centimes: aFacturer.frais });
  // Remise d'un code : Stripe n'accepte pas de ligne négative. Une seule ligne au montant exact de la
  // commande, que le webhook compare au total enregistré.
  const aEncaisser = existante?.total_centimes ?? creee.total_centimes ?? totaux.total_centimes;
  if (factures.reduce((s, f) => s + f.qte * f.unitaire_centimes, 0) !== aEncaisser) {
    factures.splice(0, factures.length, { libelle: `La Ferme, commande ${creee.numero}`, qte: 1, unitaire_centimes: aEncaisser });
  }
  try {
    const session = await p.creerSession({
      commandeId: creee.id,
      numero: creee.numero,
      email: existante?.client_email ?? client.email,
      lignes: factures,
      urlRetour: `${suivi}?retour=1`,
      urlAnnulation: `${origine}/commande?annule=1`,
      origine,
    });
    await lierSessionPaiement(creee.id, session.id);
    return NextResponse.json({ redirection: session.url });
  } catch (e) {
    console.error(`Session de paiement impossible pour la commande ${creee.numero} : ${e instanceof Error ? e.message : e}`);
    return refus("Le paiement en ligne ne répond pas. Réessayez dans un instant ou appelez-nous au 022 792 16 89.", 502);
  }
}
