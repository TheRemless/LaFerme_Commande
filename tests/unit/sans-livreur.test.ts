import { describe, expect, it } from "vitest";
import { alerteSansLivreur } from "@/lib/sans-livreur";
import { creneaux, etatService, type ConfigService } from "@/lib/service";

// Aucun livreur prévu : l'alerte de l'accueil (pure) et la règle dans les créneaux de livraison.

const zone = { numero: 1, nom: "Zone 1", frais_centimes: 0, minimum_centimes: 0, delai_min: 30, delai_max: 40, active: true, proposition: false };
const base: ConfigService = {
  zones: [zone],
  npa: [],
  horaires: [
    { jour: 5, service: "midi", premiere_heure: "11:30", derniere_heure: "14:00", derniere_commande: "13:30", derniere_commande_pizzas: "13:45" },
    { jour: 5, service: "soir", premiere_heure: "18:30", derniere_heure: "22:00", derniere_commande: "21:30", derniere_commande_pizzas: "21:45" },
  ],
  fermetures: [],
  reglages: { preparation_minutes: 20, creneau_minutes: 15, avance_jours: 0 },
};
// Vendredi 20 novembre 2026 à Genève (UTC+1).
const a = (heure: string) => new Date(`2026-11-20T${heure}:00+01:00`);

describe("alerteSansLivreur", () => {
  it("personne de prévu ce soir : alerte, bloquante dès une heure avant le service", () => {
    expect(alerteSansLivreur(base, a("16:00"), 0)).toMatchObject({ cle: "sans-livreur", niveau: "attention", titre: "Aucun livreur prévu ce soir" });
    expect(alerteSansLivreur(base, a("17:45"), 0)?.niveau).toBe("bloquant");
    expect(alerteSansLivreur(base, a("10:00"), 0)?.titre).toBe("Aucun livreur prévu ce midi");
  });
  it("pas d'alerte : un livreur prévu, service fini, jour fermé, aucune zone ouverte", () => {
    expect(alerteSansLivreur(base, a("16:00"), 1)).toBeNull();
    expect(alerteSansLivreur(base, a("21:45"), 0)).toBeNull();
    expect(alerteSansLivreur({ ...base, horaires: [] }, a("16:00"), 0)).toBeNull();
    expect(alerteSansLivreur({ ...base, zones: [{ ...zone, services: ["midi"] }] }, a("16:00"), 0)).toBeNull();
  });
  it("le détail dit si la règle a fermé la livraison", () => {
    expect(alerteSansLivreur(base, a("16:00"), 0)?.detail).toMatch(/peuvent quand même commander/);
    const ferme = { ...base, livraisonSansLivreur: [{ jour: "2026-11-20", service: "soir" as const }] };
    expect(alerteSansLivreur(ferme, a("16:00"), 0)?.detail).toMatch(/n'est pas proposée/);
  });
});

describe("règle « fermer la livraison d'un service sans livreur prévu »", () => {
  it("le soir sans livreur n'est plus proposé en livraison, le retrait reste", () => {
    const ferme = { ...base, livraisonSansLivreur: [{ jour: "2026-11-20", service: "soir" as const }] };
    expect(creneaux(base, a("16:00"), "livraison", zone).length).toBeGreaterThan(0);
    expect(creneaux(ferme, a("16:00"), "livraison", zone)).toEqual([]);
    expect(creneaux(ferme, a("16:00"), "retrait").length).toBeGreaterThan(0);
    expect(etatService(ferme, a("19:00"), "livraison", zone).etat).not.toBe("ouvert");
    expect(etatService(ferme, a("19:00"), "retrait").etat).toBe("ouvert");
  });
});
