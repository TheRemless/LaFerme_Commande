import { NextResponse } from "next/server";
import { chargerCatalogue } from "@/lib/catalogue";
import { chargerConfigService } from "@/lib/config-service";
import { fonctionSql } from "@/lib/db/serveur";
import { calculerPanier } from "@/lib/panier";
import { erreurPlatsDuJour, momentDe } from "@/lib/plat-du-jour";
import { lignesValides, quandValide } from "@/lib/validation";
import { depuisHeureGeneve, enMinutes, heureTexte, instantGeneve, jourIso, quandPossible, type CreneauPlein, type Zone, messagePause, messageSansCreneau, pauseEnCours } from "@/lib/service";
import { zoneServeur } from "@/lib/zone-serveur";

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
  let creneauComplet = false;
  if (messageQuand === null && lignes.length > 0 && quand.type === "creneau") {
    const pleins = await fonctionSql<CreneauPlein[]>("creneaux_pleins", { p_debut: quand.date, p_fin: quand.date }).catch(() => [] as CreneauPlein[]);
    creneauComplet = pleins.some((p) => p.mode === mode && p.minutes === quand.minutes);
    if (creneauComplet) messageQuand = "Ce créneau est complet. Choisissez une autre heure ou appelez-nous au 022\u00a0792\u00a016\u00a089.";
  }

  if (messageQuand === null && lignes.length > 0) {
    const jourRefuse = erreurPlatsDuJour(catalogue, lignes, momentDe(config, maintenant, mode, zone, totaux.pizzas_seulement, quand));
    if (jourRefuse) messageQuand = `${jourRefuse} Retirez-le ou choisissez une autre heure.`;
  }

  return NextResponse.json({
    ...totaux,
    valide: totaux.valide && messageQuand === null,
    message_quand: messageQuand,
    creneau_complet: creneauComplet,
    plafond_comptoir_centimes: config.plafondComptoirCentimes,
  });
}
