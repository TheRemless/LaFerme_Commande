import "server-only";
import { randomBytes } from "node:crypto";
import { chargerCatalogue } from "@/lib/catalogue";
import { chargerConfigService } from "@/lib/config-service";
import { courrielConfirmation } from "@/lib/courriel/modeles";
import { envoyerCourriel } from "@/lib/courriel/envoi";
import { commandeParId, fonctionSql } from "@/lib/db/serveur";
import { heureImpression, IMPRESSION_AVANCE_DEFAUT } from "@/lib/impression/avance";
import { imprimerCommande } from "@/lib/impression/service";
import { nomClient } from "@/lib/nom-plat";
import { calculerPanier, platDe, prixChoix } from "@/lib/panier";
import type { Personnel } from "@/lib/personnel/session";
import { erreurPlatsDuJour, momentDe } from "@/lib/plat-du-jour";
import { depuisHeureGeneve, heureTexte, MESSAGE_CRENEAU_COMPLET, messagePause, pauseEnCours, quandPossible } from "@/lib/service";
import { signalerTablette } from "@/lib/tablette";
import { allergieValide, detailsValides, emailNormalise, lignesValides, quandValide, telephoneValide } from "@/lib/validation";
import { messageZoneFermee } from "@/lib/zone-fermee";
import { zoneServeur } from "@/lib/zone-serveur";

// Commande prise au téléphone par l'équipe, à la tablette (vague 3, bo-commandes ; Jérémy, 14.11.2026 : « on
// centralise tout »). Mêmes contrôles qu'une commande du site : plats en vente avec leurs options, zone et
// registre des adresses, minimum de la zone, pause, heure possible, plat du jour, capacité du créneau (en base).
// Différences : elle entre acceptée (tickets selon l'heure), elle se paie à la livraison ou au retrait (espèces
// ou carte, encaissée ensuite comme un retrait), le plafond du comptoir ne s'applique pas, l'e-mail est facultatif
// (s'il est donné : le récapitulatif avec le lien de suivi). Pas de code promo ni de fidélité au téléphone.

export type DemandeTelephone = Record<string, unknown>;
export type ResultatTelephone =
  | { ok: true; id: string; numero: number; heure: string; message: string; deja: boolean }
  | { ok: false; message: string; champ?: string };

const CLE = /^[A-Za-z0-9-]{16,64}$/;

function texteCourt(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return t.length >= 1 && t.length <= max ? t : null;
}

export async function prendreCommandeTelephone(d: DemandeTelephone, p: Personnel, origine: string): Promise<ResultatTelephone> {
  if (typeof d.cle !== "string" || !CLE.test(d.cle)) return { ok: false, message: "Rechargez la page et recommencez." };
  const mode = d.mode === "livraison" ? "livraison" : d.mode === "retrait" ? "retrait" : null;
  if (!mode) return { ok: false, message: "Choisissez livraison ou à emporter.", champ: "mode" };
  const lignes = lignesValides(d.lignes);
  if (!lignes || lignes.length === 0) return { ok: false, message: "Ajoutez au moins un plat.", champ: "plats" };

  const c = (d.client && typeof d.client === "object" ? d.client : {}) as Record<string, unknown>;
  const prenom = texteCourt(c.prenom, 60);
  if (!prenom) return { ok: false, message: "Indiquez le prénom du client.", champ: "prenom" };
  const nom = texteCourt(c.nom, 60) ?? "";
  const telephone = texteCourt(c.telephone, 20);
  if (!telephone || !telephoneValide(telephone)) return { ok: false, message: "Vérifiez le numéro de téléphone, il faut au moins neuf chiffres.", champ: "telephone" };
  const emailBrut = typeof c.email === "string" ? c.email.trim() : "";
  const email = emailBrut ? emailNormalise(emailBrut) : "";
  if (email === null) return { ok: false, message: "Vérifiez l'adresse e-mail, ou laissez le champ vide.", champ: "email" };
  const allergie = allergieValide(d.allergie);
  if (allergie === null) return { ok: false, message: "Allergie : 120 caractères au plus.", champ: "allergie" };

  const [catalogue, config] = await Promise.all([chargerCatalogue(), chargerConfigService()]);
  let adresse = null;
  let details = null;
  let zone;
  if (mode === "livraison") {
    details = detailsValides(d.details);
    if (!details) return { ok: false, message: "Indiquez le nom sur la sonnette.", champ: "sonnette" };
    const r = await zoneServeur(config, d.adresse, true);
    if ("erreur" in r) return { ok: false, message: r.erreur, champ: "adresse" };
    if (r.statut === "zone-fermee") return { ok: false, message: messageZoneFermee(r.jusqua), champ: "adresse" };
    if (r.statut !== "livrable") return { ok: false, message: "Cette adresse est hors de notre zone de livraison.", champ: "adresse" };
    zone = r.zone;
    adresse = r.adresse;
  }

  const totaux = calculerPanier(catalogue, lignes, zone ? { frais_centimes: zone.frais_centimes, minimum_centimes: zone.minimum_centimes } : null);
  const fausse = totaux.lignes.find((l) => l.erreur);
  if (fausse) return { ok: false, message: `${nomClient(fausse.nom, platDe(catalogue, fausse.slug)?.categorie_slug === "pizzas")} : ${fausse.erreur}`, champ: "plats" };
  if (totaux.manque_minimum_centimes > 0) return { ok: false, message: "Le minimum de commande de cette zone n'est pas atteint.", champ: "plats" };

  const maintenant = new Date();
  const quand = quandValide(d.quand);
  if (quand.type === "aucun") return { ok: false, message: "Choisissez « dès que possible » ou une heure.", champ: "heure" };
  const pause = pauseEnCours(config, maintenant, mode);
  if (pause) return { ok: false, message: messagePause(pause) ?? "Les commandes sont en pause.", champ: "heure" };
  if (!quandPossible(config, maintenant, mode, zone, totaux.pizzas_seulement, quand)) return { ok: false, message: "Cette heure n'est pas possible. Choisissez-en une autre.", champ: "heure" };
  const moment = momentDe(config, maintenant, mode, zone, totaux.pizzas_seulement, quand);
  const jourRefuse = erreurPlatsDuJour(catalogue, lignes, moment);
  if (jourRefuse) return { ok: false, message: jourRefuse, champ: "plats" };
  // L'heure promise au client au téléphone : celle du créneau, ou l'heure « dès que possible » du moment.
  const heure = moment ? depuisHeureGeneve(`${moment.date}T${heureTexte(moment.minutes).replace("h", ":")}`) : null;
  if (!heure) return { ok: false, message: "Cette heure n'est pas possible. Choisissez-en une autre.", champ: "heure" };

  const donnees = {
    jeton_suivi: randomBytes(24).toString("base64url"),
    cle_idempotence: d.cle,
    mode,
    statut: "nouvelle",
    statut_paiement: "a_encaisser_retrait",
    moyen_paiement: "comptoir",
    client_prenom: prenom,
    client_nom: nom,
    client_telephone: telephone,
    client_email: email,
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
    compte_id: null,
    compte_demande: false,
    allergie,
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
    })),
  };

  let creee: { id: string; numero: number; deja: boolean };
  try {
    creee = await fonctionSql("creer_commande_telephone", { p: donnees, p_heure: heure.toISOString(), p_personnel: p.id });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (m.includes("creneau_complet")) return { ok: false, message: MESSAGE_CRENEAU_COMPLET, champ: "heure" };
    if (m.includes("personnel_inactif")) return { ok: false, message: "Votre accès a été retiré. Reconnectez-vous." };
    throw e;
  }
  const heureDite = heureTexte(moment!.minutes);
  if (creee.deja) return { ok: true, id: creee.id, numero: creee.numero, heure: heureDite, deja: true, message: `Commande n° ${creee.numero} déjà enregistrée.` };

  // Tickets tout de suite si l'heure est proche, sinon la surveillance les imprime à l'heure prévue (comme à
  // l'acceptation). Un ticket qui ne part pas ne défait pas la commande : la tablette propose « réimprimer ».
  const imprimerA = heureImpression(heure.toISOString(), (config.reglages.impression_avance ?? IMPRESSION_AVANCE_DEFAUT)[mode]);
  if (imprimerA.getTime() <= Date.now()) {
    await imprimerCommande(creee.id).catch((e) => console.error(`Tickets non créés pour la commande ${creee.numero} : ${e instanceof Error ? e.message : e}`));
  }
  // E-mail seulement si le client en a donné un : le récapitulatif avec le lien de suivi.
  if (email) {
    const commande = await commandeParId(creee.id);
    if (commande) {
      await envoyerCourriel({ commandeId: creee.id, destinataire: email, ...courrielConfirmation(commande, catalogue) }).catch((e) =>
        console.error(`Récapitulatif non envoyé pour la commande ${creee.numero} : ${e instanceof Error ? e.message : e}`),
      );
    }
  }
  await signalerTablette();
  return {
    ok: true,
    id: creee.id,
    numero: creee.numero,
    heure: heureDite,
    deja: false,
    message: `Commande n° ${creee.numero} enregistrée pour ${heureDite}.${email ? " Le client reçoit le récapitulatif par e-mail." : ""}`,
  };
}
