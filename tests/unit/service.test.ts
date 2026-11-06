import { beforeAll, describe, expect, it } from "vitest";
import { chargerConfigService } from "@/lib/config-service";
import { creneaux, etatService, heureTexte, instantGeneve, zonePour, type ConfigService } from "@/lib/service";

// Configuration lue dans la base embarquée : les valeurs viennent de la migration, pas du test.
let config: ConfigService;
beforeAll(async () => {
  config = await chargerConfigService();
});

// Novembre : Genève est à UTC+1.
const geneve = (iso: string) => new Date(`${iso}+01:00`);
const zone = (n: number) => config.zones.find((z) => z.numero === n)!;

describe("zones", () => {
  it("reconnaît les localités de la zone 1", () => {
    expect(zonePour(config, "1213", "Onex")).toMatchObject({ statut: "livrable", zone: { numero: 1 } });
    expect(zonePour(config, "1213", "Petit Lancy")).toMatchObject({ statut: "livrable", zone: { numero: 1 } });
  });
  it("se contente du NPA quand il ne désigne qu'une zone", () => {
    expect(zonePour(config, "1227", "Carouge")).toMatchObject({ statut: "livrable", zone: { numero: 2 } });
  });
  it("distingue zone désactivée et hors zone", () => {
    expect(zonePour(config, "1201", "Genève")).toMatchObject({ statut: "zone-fermee", zone: { numero: 3 } });
    expect(zonePour(config, "1290", "Versoix")).toEqual({ statut: "hors-zone" });
  });
});

describe("heure de Genève", () => {
  it("suit l'heure d'été", () => {
    expect(instantGeneve(new Date("2026-07-07T17:05:00Z"))).toMatchObject({ date: "2026-07-07", jour: 2, minutes: 19 * 60 + 5 });
    expect(instantGeneve(new Date("2026-11-10T18:05:00Z"))).toMatchObject({ date: "2026-11-10", jour: 2, minutes: 19 * 60 + 5 });
  });
});

describe("état du restaurant", () => {
  it("propose « dès que possible » pendant le service", () => {
    const e = etatService(config, geneve("2026-11-10T19:05:00"), "livraison", zone(1));
    expect(e.etat).toBe("ouvert");
    const moyen = Math.round((zone(1).delai_min + zone(1).delai_max) / 2);
    if (e.etat === "ouvert") expect(e.desQuePossible).toBe(Math.ceil((19 * 60 + 5 + moyen) / 5) * 5);
  });

  it("renvoie au service suivant après la dernière commande", () => {
    const h = config.horaires.find((x) => x.jour === 2 && x.service === "soir")!;
    const [hh, mm] = h.derniere_commande.split(":").map(Number);
    const apres = `2026-11-10T${String(hh).padStart(2, "0")}:${String(mm + 5).padStart(2, "0")}:00`;
    const e = etatService(config, geneve(apres), "retrait");
    expect(e.etat).toBe("ferme");
    if (e.etat === "ferme") expect(e.prochain.date).toBe("2026-11-11");
  });

  it("le lundi, propose le mardi", () => {
    const e = etatService(config, geneve("2026-11-09T12:00:00"), "livraison", zone(1));
    expect(e).toMatchObject({ etat: "ferme", prochain: { date: "2026-11-10", service: "midi" } });
  });

  it("annonce la fermeture annuelle et la réouverture", () => {
    const e = etatService(config, geneve("2026-12-23T12:00:00"), "retrait");
    expect(e.etat).toBe("fermeture");
    if (e.etat === "fermeture") {
      expect(e.fermeture.debut).toBe("2026-12-22");
      expect(e.reouverture).toBe("2027-01-12");
    }
  });
});

describe("créneaux", () => {
  it("respectent le délai de la zone et le pas réglé", () => {
    const liste = creneaux(config, geneve("2026-11-10T19:05:00"), "livraison", zone(1));
    const premier = liste[0];
    expect(premier.date).toBe("2026-11-10");
    expect(premier.minutes).toBeGreaterThanOrEqual(19 * 60 + 5 + zone(1).delai_min);
    expect(premier.minutes % config.reglages.creneau_minutes).toBe(0);
  });

  it("sautent les jours fermés et la fermeture annuelle", () => {
    const liste = creneaux(config, geneve("2026-12-18T10:00:00"), "retrait");
    const jours = [...new Set(liste.map((c) => c.date))];
    expect(jours).toEqual(["2026-12-18", "2026-12-19"]);
  });

  it("s'écrivent à la suisse", () => {
    expect(heureTexte(19 * 60 + 5)).toBe("19h05");
  });
});
