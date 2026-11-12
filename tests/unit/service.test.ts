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

describe("promesse d'heure", () => {
  it("ne propose pas « dès que possible » au-delà de la dernière livraison", () => {
    const h = config.horaires.find((x) => x.jour === 2 && x.service === "midi")!;
    const [hh, mm] = h.derniere_commande.split(":").map(Number);
    const juste = `2026-11-10T${String(hh).padStart(2, "0")}:${String(mm - 1).padStart(2, "0")}:00`;
    const e = etatService(config, geneve(juste), "livraison", zone(2));
    if (e.etat === "ouvert") expect(e.desQuePossible).toBeLessThanOrEqual(Number(h.derniere_heure.slice(0, 2)) * 60 + Number(h.derniere_heure.slice(3, 5)));
    else expect(e.etat).toBe("ferme");
  });

  it("convertit une heure de Genève en été comme en hiver", async () => {
    const { depuisHeureGeneve } = await import("@/lib/service");
    expect(depuisHeureGeneve("2027-06-15T19:05")?.toISOString()).toBe("2027-06-15T17:05:00.000Z");
    expect(depuisHeureGeneve("2026-11-10T19:05")?.toISOString()).toBe("2026-11-10T18:05:00.000Z");
  });
});

// Rapport client mystère (CM-06) : fermeture annuelle annoncée à l'avance, commandes pour la réouverture.
describe("fermeture annuelle vue par le client", () => {
  it("annonce la fermeture qui tombe dans les jours où l'on peut commander", async () => {
    const { fermetureProche } = await import("@/lib/service");
    const f = fermetureProche(config, geneve("2026-12-19T22:30:00"));
    expect(f).toMatchObject({ fermeture: { debut: "2026-12-22", fin: "2027-01-11" }, reouverture: "2027-01-12" });
    expect(fermetureProche(config, geneve("2026-11-10T19:05:00"))).toBeNull();
  });
  it("propose les créneaux de la réouverture pendant la fermeture, dans la limite des jours d'avance", () => {
    const pendant = creneaux(config, geneve("2027-01-08T12:00:00"), "retrait");
    expect(pendant[0]?.date).toBe("2027-01-12");
    expect(creneaux(config, geneve("2026-12-23T12:00:00"), "retrait")).toEqual([]);
  });
});

// CM-08 : sans aucun créneau, on dit pourquoi au lieu de « choisissez une autre heure ».
describe("message sans créneau", () => {
  it("donne les dates de la fermeture annuelle", async () => {
    const { messageSansCreneau } = await import("@/lib/service");
    expect(messageSansCreneau(config, geneve("2026-12-23T12:00:00"))).toBe(
      "Fermé du mardi 22 décembre au lundi 11 janvier. On rouvre le mardi 12 janvier.",
    );
    expect(messageSansCreneau(config, geneve("2026-11-10T19:05:00"))).toBe("La commande en ligne est fermée en ce moment.");
  });
});

// CM-05 : l'heure « vers » de l'accueil reste connue après la commande.
describe("estimation dès que possible", () => {
  it("redonne l'heure de l'accueil pour une commande passée pendant le service", async () => {
    const { estimationAsap } = await import("@/lib/estimation");
    const quand = geneve("2026-11-10T19:05:00");
    const accueil = etatService(config, quand, "livraison", zone(1));
    const e = estimationAsap(config, { quand_type: "asap", mode: "livraison", zone_numero: 1, cree_le: quand.toISOString() });
    expect(accueil.etat).toBe("ouvert");
    expect(e).toBe(accueil.etat === "ouvert" ? accueil.desQuePossible : -1);
    expect(estimationAsap(config, { quand_type: "creneau", mode: "retrait", zone_numero: null, cree_le: quand.toISOString() })).toBeNull();
    expect(estimationAsap(config, { quand_type: "asap", mode: "retrait", zone_numero: null, cree_le: geneve("2026-11-10T03:00:00").toISOString() })).toBeNull();
  });
});

describe("service en cours (revue de CM-03)", () => {
  it("distingue avant l'ouverture, pendant le service et entre deux services", async () => {
    const { serviceEnCours } = await import("@/lib/service");
    expect(serviceEnCours(config, geneve("2026-11-10T10:15:00"))).toBe(false);
    expect(serviceEnCours(config, geneve("2026-11-10T22:14:00"))).toBe(true);
    expect(serviceEnCours(config, geneve("2026-11-10T15:30:00"))).toBe(false);
  });
});
