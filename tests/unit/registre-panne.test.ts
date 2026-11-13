import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { avertissementsPaiement } from "@/lib/commandes";
import { chargerConfigService } from "@/lib/config-service";
import { baseLocale } from "@/lib/db/locale";
import type { Commande } from "@/lib/db/serveur";
import { MESSAGE_REGISTRE_EN_PANNE, estPanneRegistre } from "@/lib/registre-panne";
import { zonePourNpaSeul, type ConfigService, type Zone } from "@/lib/service";

// Vague 3, client-commande (P1 de produit-client) : quand le service fédéral des adresses ne répond pas, le
// message laisse deux issues au client, commander à emporter ou appeler le restaurant.

vi.mock("@/lib/adresse-serveur", async (original) => ({
  ...(await original<typeof import("@/lib/adresse-serveur")>()),
  adresseOfficielle: async () => {
    throw new Error("Registre des bâtiments indisponible (503)");
  },
  retrouverAdresse: async () => {
    throw new Error("Registre des bâtiments indisponible (503)");
  },
}));

let config: ConfigService;
async function regler(valeur: boolean) {
  const db = await baseLocale();
  await db.query("update reglages set valeur = $1::jsonb where cle = 'npa_seul_en_panne_actif'", [JSON.stringify(valeur)]);
}
beforeAll(async () => {
  config = await chargerConfigService();
});
afterAll(() => regler(true));

const ONEX = { rue: "Avenue du Gros-Chêne", numero: "20", npa: "1213", localite: "Onex" };

describe("service fédéral des adresses en panne", () => {
  it("le message donne les deux issues : à emporter et le téléphone du restaurant", () => {
    expect(MESSAGE_REGISTRE_EN_PANNE).toContain("Commandez à emporter");
    expect(MESSAGE_REGISTRE_EN_PANNE.replace(/\s/g, " ")).toContain("022 792 16 89");
    expect(MESSAGE_REGISTRE_EN_PANNE).not.toContain("Réessayez");
    expect(estPanneRegistre(MESSAGE_REGISTRE_EN_PANNE)).toBe(true);
    expect(estPanneRegistre("Cette adresse est hors de notre zone de livraison.")).toBe(false);
  });

  it("réglage éteint, adresse choisie dans les suggestions : 503 et ce message", async () => {
    await regler(false);
    const { zoneServeur } = await import("@/lib/zone-serveur");
    expect(await zoneServeur(config, { featureId: "1234567_0", rue: "Avenue du Gros-Chêne", numero: "20", npa: "1213", localite: "Onex" })).toEqual({
      erreur: MESSAGE_REGISTRE_EN_PANNE,
      code: 503,
    });
  });

  it("réglage éteint, adresse tapée à la main, au paiement : 503 et ce message", async () => {
    await regler(false);
    const { zoneServeur } = await import("@/lib/zone-serveur");
    expect(await zoneServeur(config, { rue: "Avenue du Gros-Chêne", numero: "20", npa: "1213", localite: "Onex" }, true)).toEqual({
      erreur: MESSAGE_REGISTRE_EN_PANNE,
      code: 503,
    });
  });

  // Décision C15 de Jérémy (13.11.2026), allumée par défaut.
  it("réglage allumé : adresse acceptée sur son NPA, zone la plus chère, marquée non vérifiée", async () => {
    await regler(true);
    const { zoneServeur } = await import("@/lib/zone-serveur");
    const attendue = zonePourNpaSeul(config, "1213");
    expect(attendue.statut).toBe("livrable");
    const zone = attendue.statut === "livrable" ? attendue.zone : null;
    const retenue = { ...ONEX, nonVerifiee: true };
    // Suggestion (identifiant du registre), saisie à la main au paiement, puis le panier avec l'adresse gardée.
    for (const [entree, exiger] of [[{ featureId: "1234567_0", ...ONEX }, false], [ONEX, true], [retenue, false]] as const) {
      expect(await zoneServeur(config, entree, exiger)).toEqual({ statut: "livrable", zone, verifiee: false, adresse: retenue });
    }
  });

  it("réglage allumé : un NPA hors de nos zones reste hors zone, une adresse sans rue garde le message", async () => {
    await regler(true);
    const { zoneServeur } = await import("@/lib/zone-serveur");
    expect(await zoneServeur(config, { rue: "Rue du Rhône", numero: "1", npa: "1204", localite: "Genève" }, true)).toEqual({ statut: "hors-zone", verifiee: false });
    expect(await zoneServeur(config, { featureId: "1234567_0" })).toEqual({ erreur: MESSAGE_REGISTRE_EN_PANNE, code: 503 });
  });
});

describe("zone d'un NPA seul", () => {
  const zone = (numero: number, frais: number, minimum: number, active = true): Zone => ({
    numero, nom: `Zone ${numero}`, frais_centimes: frais, minimum_centimes: minimum, delai_min: 30, delai_max: 45, active, proposition: false,
  });
  const cfg = {
    zones: [zone(1, 290, 3000), zone(2, 490, 3000), zone(3, 690, 4000, false)],
    npa: [
      { npa: "1213", localite: "Onex", zone_numero: 1 },
      { npa: "1213", localite: "Petit-Lancy", zone_numero: 2 },
      { npa: "1213", localite: "Ailleurs", zone_numero: 3 },
      { npa: "1212", localite: "Grand-Lancy", zone_numero: 1 },
    ],
  };

  it("la zone livrée la plus chère du NPA, quelle que soit la localité annoncée", () => {
    expect(zonePourNpaSeul(cfg, "1213")).toEqual({ statut: "livrable", zone: cfg.zones[1] });
    expect(zonePourNpaSeul(cfg, "1212")).toEqual({ statut: "livrable", zone: cfg.zones[0] });
    expect(zonePourNpaSeul(cfg, "1204")).toEqual({ statut: "hors-zone" });
  });

  it("zone fermée jusqu'à une heure : fermée aussi pour le NPA seul", () => {
    const jusqua = new Date(Date.now() + 3600_000).toISOString();
    const fermee = { ...cfg, zones: [cfg.zones[0], { ...cfg.zones[1], fermee_jusqu_a: jusqua }] };
    expect(zonePourNpaSeul(fermee, "1213")).toMatchObject({ statut: "zone-fermee", jusqua });
  });
});

describe("avertissement de la tablette", () => {
  it("une livraison à l'adresse non vérifiée est à lire avant d'accepter", async () => {
    const c = { mode: "livraison", adresse: { ...ONEX, nonVerifiee: true }, lignes: [], zone_numero: config.zones[0].numero, quand_type: "asap", pizzas_seulement: false } as unknown as Commande;
    const texte = avertissementsPaiement(c, config, null, new Date("2026-11-10T18:05:00Z")).join(" ");
    expect(texte).toContain("Adresse non vérifiée");
    expect(texte).toContain("1213");
    const verifiee = { ...c, adresse: ONEX } as Commande;
    expect(avertissementsPaiement(verifiee, config, null, new Date("2026-11-10T18:05:00Z")).join(" ")).not.toContain("Adresse non vérifiée");
  });
});
