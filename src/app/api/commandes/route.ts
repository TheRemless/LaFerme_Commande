import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { chargerCatalogue } from "@/lib/catalogue";
import { confirmerCommandeComptoir } from "@/lib/commandes";
import { chargerConfigService } from "@/lib/config-service";
import { detailsLigne } from "@/lib/courriel/modeles";
import { commandeParId, ConfigurationManquante, creerCommande, lierSessionPaiement } from "@/lib/db/serveur";
import { origineSure } from "@/lib/origine";
import { calculerPanier } from "@/lib/panier";
import { passerelle } from "@/lib/paiement/passerelle";
import { depuisHeureGeneve, quandPossible, type Zone } from "@/lib/service";
import { cleValide, clientValide, detailsValides, lignesValides, quandValide } from "@/lib/validation";
import { zoneServeur, type AdresseRetenue } from "@/lib/zone-serveur";

// Passage de la commande. Le serveur refait tous les contrôles avec la base : contenu et prix, adresse
// retrouvée dans le registre fédéral, zone, minimum, heure. Il enregistre la commande, puis renvoie
// vers la page de paiement (en ligne) ou directement vers le suivi (paiement au comptoir).

function refus(message: string, status = 422) {
  return NextResponse.json({ erreur: message }, { status });
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

  const cle = cleValide(corps.cle);
  const lignes = lignesValides(corps.lignes);
  const client = clientValide(corps.client);
  const mode = corps.mode === "livraison" ? "livraison" : corps.mode === "retrait" ? "retrait" : null;
  const moyen = corps.moyen === "comptoir" ? "comptoir" : corps.moyen === "en_ligne" ? "en_ligne" : null;
  if (!cle || !lignes || lignes.length === 0 || !mode || !moyen) return refus("Commande incomplète. Rechargez la page.");
  if (!client) return refus("Vérifiez vos coordonnées : prénom, nom, téléphone et e-mail.");
  // Paiement à la livraison désactivé (décision du prompt) : au comptoir seulement pour un retrait.
  if (moyen === "comptoir" && mode !== "retrait") return refus("Le paiement au comptoir n'est possible qu'à emporter.");

  const [catalogue, config] = await Promise.all([chargerCatalogue(), chargerConfigService()]);

  let zone: Zone | undefined;
  let details = null;
  let adresse: AdresseRetenue | null = null;
  if (mode === "livraison") {
    details = detailsValides(corps.details);
    if (!details) return refus("Indiquez le nom sur la sonnette.");
    const r = await zoneServeur(config, corps.adresse, true);
    if ("erreur" in r) return refus(r.erreur, r.code);
    if (r.statut !== "livrable") return refus("Cette adresse est hors de notre zone de livraison.");
    zone = r.zone;
    adresse = r.adresse;
  }

  const totaux = calculerPanier(catalogue, lignes, zone ? { frais_centimes: zone.frais_centimes, minimum_centimes: zone.minimum_centimes } : null);
  const erreurLigne = totaux.lignes.find((l) => l.erreur);
  if (erreurLigne) return refus(`${erreurLigne.nom} : ${erreurLigne.erreur}`);
  if (totaux.manque_minimum_centimes > 0) return refus("Le minimum de livraison n'est pas atteint.");

  const preversion = process.env.CONTEXTE_DEPLOIEMENT !== "production";
  const maintenant = (preversion && typeof corps.heure === "string" ? depuisHeureGeneve(corps.heure) : null) ?? new Date();
  const quand = quandValide(corps.quand);
  if (quand.type === "aucun" || !quandPossible(config, maintenant, mode, zone, totaux.pizzas_seulement, quand)) {
    return refus("Ce moment n'est plus disponible. Choisissez une autre heure.");
  }

  let creee;
  try {
    creee = await creerCommande({
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
      total_centimes: totaux.total_centimes,
      tva_centimes: totaux.tva_centimes,
      taux_tva_pourcent: catalogue.tauxTvaPourcent,
      origine,
      lignes: totaux.lignes.map((l) => ({
        slug: l.slug,
        nom: l.nom,
        station: catalogue.plats[l.slug].station,
        qte: l.qte,
        unitaire_centimes: l.unitaire_centimes,
        total_centimes: l.total_centimes,
        choix: l.choix,
        retraits: l.retraits,
        note: l.note.trim(),
      })),
    });
  } catch (e) {
    if (e instanceof ConfigurationManquante) return refus(e.message, 503);
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
  const factures = totaux.lignes.map((l) => {
    const options = detailsLigne(catalogue, { choix: l.choix, retraits: l.retraits, note: "" });
    return { libelle: options.length ? `${l.nom} (${options.join(", ")})` : l.nom, qte: l.qte, unitaire_centimes: l.unitaire_centimes };
  });
  if (totaux.frais_centimes > 0) factures.push({ libelle: "Livraison", qte: 1, unitaire_centimes: totaux.frais_centimes });
  try {
    const session = await p.creerSession({
      commandeId: creee.id,
      numero: creee.numero,
      email: client.email,
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
