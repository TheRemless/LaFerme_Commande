import { NextResponse } from "next/server";
import { chargerCatalogue } from "@/lib/catalogue";
import { chargerConfigService } from "@/lib/config-service";
import { fonctionSql } from "@/lib/db/serveur";
import { calculerPanier } from "@/lib/panier";
import { erreurPlatsDuJour, momentDe } from "@/lib/plat-du-jour";
import { lignesValides, quandValide } from "@/lib/validation";
import { depuisHeureGeneve, enMinutes, heureTexte, instantGeneve, jourIso, MESSAGE_CRENEAU_COMPLET, quandPossible, type CreneauPlein, type Zone, messagePause, messageSansCreneau, pauseEnCours } from "@/lib/service";
import { messageZoneFermee, SUITE_ZONE_FERMEE } from "@/lib/zone-fermee";
import { zoneServeur } from "@/lib/zone-serveur";
import { appliquerRemise, codeTape, evaluerCode, messageCode } from "@/lib/code-promo";

// Prix du panier calculé par le serveur à partir de la base : options, frais de zone, minimum, TVA,
// et contrôle que le moment demandé reste possible pour ce contenu. Rien n'est enregistré.

export async function POST(requete: Request) {
  let corps: Record<string, unknown>;
  try {
    corps = await requete.json();
  } catch {
    return NextResponse.json({ erreur: "Requête illisible." }, { status: 400 });
  }
  const lignes = lignesValides(corps.lignes);
  if (!lignes) return NextResponse.json({ erreur: "Panier illisible." }, { status: 422 });
  const mode = corps.mode === "livraison" ? "livraison" : corps.mode === "retrait" ? "retrait" : null;
  if (!mode) return NextResponse.json({ erreur: "Choisissez livraison ou à emporter." }, { status: 422 });

  const [catalogue, config] = await Promise.all([chargerCatalogue(), chargerConfigService()]);

  let zone: Zone | undefined;
  if (mode === "livraison") {
    const r = await zoneServeur(config, corps.adresse);
    if ("erreur" in r) return NextResponse.json({ erreur: r.erreur }, { status: r.code });
    if (r.statut === "zone-fermee") return NextResponse.json({ erreur: `${messageZoneFermee(r.jusqua)} ${SUITE_ZONE_FERMEE}` }, { status: 422 });
    if (r.statut !== "livrable") return NextResponse.json({ erreur: "Cette adresse est hors de notre zone de livraison." }, { status: 422 });
    zone = r.zone;
  }

  const totaux = calculerPanier(catalogue, lignes, zone ? { frais_centimes: zone.frais_centimes, minimum_centimes: zone.minimum_centimes } : null);

  // Hors production, l'heure simulée de l'accueil (?heure=) suit jusqu'ici pour tester les états.
  const preversion = process.env.CONTEXTE_DEPLOIEMENT !== "production";
  const simulee = preversion && typeof corps.heure === "string" ? depuisHeureGeneve(corps.heure) : null;
  const maintenant = simulee ?? new Date();
  const quand = quandValide(corps.quand);
  let messageQuand: string | null = null;
  const pause = pauseEnCours(config, maintenant, mode);
  if (pause) messageQuand = messagePause(pause);
  else if (lignes.length > 0 && !quandPossible(config, maintenant, mode, zone, totaux.pizzas_seulement, quand)) {
    const pourPizzas = !totaux.pizzas_seulement && quandPossible(config, maintenant, mode, zone, true, quand);
    if (pourPizzas) {
      // Le service concerné est celui du moment demandé : aujourd'hui pour « dès que possible », sinon celui du créneau.
      const ici = instantGeneve(maintenant);
      const h =
        quand.type === "creneau"
          ? config.horaires.find(
              (x) => x.jour === jourIso(quand.date) && enMinutes(x.premiere_heure) <= quand.minutes && quand.minutes <= enMinutes(x.derniere_heure),
            )
          : config.horaires.find((x) => x.jour === ici.jour && ici.minutes <= enMinutes(x.derniere_commande_pizzas));
      messageQuand = h
        ? `Après ${heureTexte(enMinutes(h.derniere_commande))}, on ne prend plus que les pizzas. Retirez les autres plats ou choisissez une autre heure.`
        : "À cette heure-là, on ne prend plus que les pizzas. Retirez les autres plats ou choisissez une autre heure.";
    } else if (quand.type === "aucun") {
      messageQuand = messageSansCreneau(config, maintenant);
    } else {
      messageQuand = "Ce moment n'est plus disponible. Choisissez une autre heure.";
    }
  }

  // Créneau rempli par d'autres clients depuis le choix de l'heure : annoncé dès le panier, avec le même
  // texte que le refus au paiement (creer_commande le revérifie sous verrou). Base muette : on laisse passer.
  // placeTenue : ce navigateur a déjà envoyé une commande pour ce créneau (paiement annulé, retour arrière).
  // Sa commande en attente compte dans la capacité : sans ce signal, il se verrait refuser sa propre place.
  // Simple indication d'affichage, le serveur retranche tout au paiement.
  let creneauComplet = false;
  if (messageQuand === null && lignes.length > 0 && quand.type === "creneau" && corps.placeTenue !== true) {
    const pleins = await fonctionSql<CreneauPlein[]>("creneaux_pleins", { p_debut: quand.date, p_fin: quand.date }).catch(() => [] as CreneauPlein[]);
    creneauComplet = pleins.some((p) => p.mode === mode && p.minutes === quand.minutes);
    if (creneauComplet) messageQuand = MESSAGE_CRENEAU_COMPLET;
  }

  if (messageQuand === null && lignes.length > 0) {
    const jourRefuse = erreurPlatsDuJour(catalogue, lignes, momentDe(config, maintenant, mode, zone, totaux.pizzas_seulement, quand));
    if (jourRefuse) messageQuand = `${jourRefuse} Retirez-le du panier ou changez de créneau.`;
  }

  // Code promo (éteint par défaut) : aperçu de la remise, calculée en base. Aucune donnée du client n'est
  // utilisée ici (revue de sécurité : sinon la route dirait si un e-mail ou un téléphone a déjà commandé) ;
  // « une fois par client » et « première commande » se vérifient au paiement, sous verrou.
  const code = codeTape(corps.code);
  let resultatCode: { code: string; ok: boolean; remise_centimes?: number; message?: string } | null = null;
  let aPayer = totaux;
  if (code && lignes.length > 0) {
    const ev = await evaluerCode({
      code,
      // Identité neutre, qui ne correspond à aucun client : seules les conditions du code comptent.
      email: "apercu@panier.invalid",
      telephone: null,
      adresse: null,
      mode,
      sous_total_centimes: totaux.sous_total_centimes,
      frais_centimes: totaux.frais_centimes,
    });
    if (ev.ok) {
      aPayer = appliquerRemise(totaux, ev.remise_centimes, catalogue.tauxTvaPourcent);
      resultatCode = { code, ok: true, remise_centimes: ev.remise_centimes };
    } else if (ev.raison !== "desactive") {
      resultatCode = { code, ok: false, message: messageCode(ev) };
    }
  }

  return NextResponse.json({
    ...aPayer,
    code: resultatCode,
    valide: totaux.valide && messageQuand === null,
    message_quand: messageQuand,
    creneau_complet: creneauComplet,
    plafond_comptoir_centimes: config.plafondComptoirCentimes,
  });
}
