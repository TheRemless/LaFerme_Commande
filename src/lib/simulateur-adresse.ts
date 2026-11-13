import "server-only";
import { chargerConfigService } from "@/lib/config-service";
import { etatService, instantGeneve, servicesDu, zonePour, type EtatService } from "@/lib/service";
import { champ, zoneServeur } from "@/lib/zone-serveur";

// Simulateur d'adresse du back-office (vague 3, bo-operations) : ce que le site répondrait maintenant à un
// client qui donne cette adresse. Même calcul que l'accueil et le paiement (zoneServeur, zonePour, etatService),
// sur la même config (heures allongées comprises). Rien n'est enregistré ni journalisé : l'adresse sert au
// calcul puis disparaît. Doc : docs/zones-services.md, « Tester une adresse ».

export type Simulation = {
  statut: "livrable" | "hors-zone" | "zone-fermee";
  // Retrouvée dans le registre fédéral (rue saisie) ; sinon seuls le NPA et la localité ont compté.
  verifiee: boolean;
  adresse: { rue: string; numero: string; npa: string; localite: string } | null;
  zone: {
    numero: number;
    nom: string;
    active: boolean;
    frais_centimes: number;
    minimum_centimes: number;
    // Délais annoncés en ce moment, retard du soir et allongement compris.
    delai_min: number;
    delai_max: number;
    services: ("midi" | "soir")[];
    // Services où cette zone est livrée aujourd'hui, compte tenu des horaires, fermetures et ouvertures.
    aujourdhui: ("midi" | "soir")[];
    fermee_jusqu_a: string | null;
    fermee_motif: string | null;
  } | null;
  // Livraison vers cette zone, maintenant : dès que possible, prochain créneau, pause, fermeture.
  etat: EtatService | null;
};

export async function simulerAdresse(entree: unknown, maintenant = new Date()): Promise<Simulation | { erreur: string; code: 422 | 503 }> {
  const a = (entree && typeof entree === "object" ? entree : {}) as Record<string, unknown>;
  const config = await chargerConfigService();
  // Rue saisie : retrouvée dans le registre fédéral, comme au paiement. Sans rue : NPA et localité seulement.
  const r = await zoneServeur(config, a, champ(a.rue) !== null);
  if ("erreur" in r) return r;
  const adresse = r.statut === "livrable" ? r.adresse : null;
  const npa = adresse?.npa ?? champ(a.npa) ?? "";
  const localite = adresse?.localite ?? champ(a.localite) ?? "";
  const z = zonePour(config, npa, localite);
  const zone = z.statut === "hors-zone" ? null : z.zone;
  const aujourdhui = zone
    ? servicesDu(config, instantGeneve(maintenant).date)
        .map((h) => h.service)
        .filter((s) => (zone.services ?? ["midi", "soir"]).includes(s))
    : [];
  return {
    statut: r.statut,
    verifiee: r.verifiee,
    adresse: adresse ? { rue: adresse.rue, numero: adresse.numero, npa: adresse.npa, localite: adresse.localite } : null,
    zone: zone
      ? {
          numero: zone.numero,
          nom: zone.nom,
          active: zone.active,
          frais_centimes: zone.frais_centimes,
          minimum_centimes: zone.minimum_centimes,
          delai_min: zone.delai_min,
          delai_max: zone.delai_max,
          services: zone.services ?? ["midi", "soir"],
          aujourdhui: [...new Set(aujourdhui)],
          fermee_jusqu_a: zone.fermee_jusqu_a ?? null,
          fermee_motif: zone.fermee_motif ?? null,
        }
      : null,
    etat: r.statut === "livrable" ? etatService(config, maintenant, "livraison", r.zone) : null,
  };
}
