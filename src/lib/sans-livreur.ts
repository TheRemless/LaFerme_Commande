import "server-only";
import type { Alerte } from "@/lib/accueil-gestion";
import { fonctionSql } from "@/lib/db/serveur";
import { jourDeService, serviceDe } from "@/lib/pilotage";
import { enMinutes, instantGeneve, servicesDu, type ConfigService } from "@/lib/service";

// Aucun livreur prévu (vague 3, bo-operations ; P1 de produit-gestion). Donnée pour l'accueil du back-office
// (bo-socle) : une alerte quand le service en cours ou à venir aujourd'hui prend des livraisons et que le
// planning ne prévoit aucun livreur. Base : livreurs_prevus, 20261130240000_sans_livreur.sql.
// Doc : docs/planning-livreurs.md, « Aucun livreur prévu ».

// Pure : l'alerte, ou null. prevus = livreurs prévus au planning pour ce service.
export function alerteSansLivreur(config: ConfigService, maintenant: Date, prevus: number): Alerte | null {
  if (prevus > 0) return null;
  const jour = jourDeService(maintenant);
  const service = serviceDe(maintenant);
  const h = servicesDu(config, jour).find((x) => x.service === service);
  if (!h) return null;
  // Plus de commande possible pour ce service : trop tard pour agir, pas d'alerte.
  const ici = instantGeneve(maintenant);
  if (ici.date === jour && ici.minutes > enMinutes(h.derniere_commande)) return null;
  // Aucune zone ouverte ce service : personne à livrer.
  if (!config.zones.some((z) => z.active && (z.services ?? ["midi", "soir"]).includes(service))) return null;
  const moment = service === "midi" ? "ce midi" : "ce soir";
  const ferme = config.livraisonSansLivreur?.some((x) => x.jour === jour && x.service === service) ?? false;
  const enService = ici.date === jour && ici.minutes >= enMinutes(h.premiere_heure) - 60;
  return {
    cle: "sans-livreur",
    niveau: enService ? "bloquant" : "attention",
    titre: `Aucun livreur prévu ${moment}`,
    detail: ferme
      ? "La livraison n'est pas proposée aux clients pour ce service (réglage « Fermer la livraison d'un service sans livreur prévu »)."
      : "Les clients peuvent quand même commander en livraison. Ajoutez un livreur au planning ou fermez la livraison sur la tablette.",
    geste: { href: "/gestion/livreurs", texte: "Ouvrir le planning" },
  };
}

// Lecture en base, puis l'alerte. null si la base n'est pas migrée ou ne répond pas.
export async function chargerAlerteSansLivreur(config: ConfigService, maintenant = new Date()): Promise<Alerte | null> {
  const prevus = await fonctionSql<number>("livreurs_prevus", { p_jour: jourDeService(maintenant), p_service: serviceDe(maintenant) }).catch(() => null);
  return prevus === null ? null : alerteSansLivreur(config, maintenant, Number(prevus));
}
