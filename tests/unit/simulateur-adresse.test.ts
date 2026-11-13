import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";

// Tester une adresse (vague 3, bo-operations) : même calcul que le site, sur la base embarquée, sans le
// registre fédéral (pas de rue : NPA et localité seulement, pas de réseau).

const { simulerAdresse } = await import("@/lib/simulateur-adresse");

let avant: { active: boolean; fermee_jusqu_a: string | null; fermee_motif: string | null };

beforeAll(async () => {
  const db = await baseLocale();
  avant = (await db.query<typeof avant>("select active, fermee_jusqu_a, fermee_motif from zones_livraison where numero = 1")).rows[0];
  await db.query("update zones_livraison set active = true, fermee_jusqu_a = null, fermee_motif = null where numero = 1");
});

afterAll(async () => {
  const db = await baseLocale();
  await db.query("update zones_livraison set active = $1, fermee_jusqu_a = $2, fermee_motif = $3 where numero = 1", [avant.active, avant.fermee_jusqu_a, avant.fermee_motif]);
});

describe("simulerAdresse", () => {
  it("Onex : zone 1 livrée, frais, minimum, délai, services et état de la livraison", async () => {
    const r = await simulerAdresse({ npa: "1213", localite: "Onex" });
    if ("erreur" in r) throw new Error(r.erreur);
    expect(r.statut).toBe("livrable");
    expect(r.verifiee).toBe(false);
    expect(r.zone).toMatchObject({ numero: 1, active: true, services: ["midi", "soir"] });
    expect(r.zone!.delai_max).toBeGreaterThanOrEqual(r.zone!.delai_min);
    expect(r.etat).not.toBeNull();
  });

  it("zone fermée jusqu'à une heure : statut, heure et motif", async () => {
    const db = await baseLocale();
    const jusqua = new Date(Date.now() + 3 * 3600_000).toISOString();
    await db.query("update zones_livraison set fermee_jusqu_a = $1, fermee_motif = 'Neige' where numero = 1", [jusqua]);
    try {
      const r = await simulerAdresse({ npa: "1213", localite: "Onex" });
      if ("erreur" in r) throw new Error(r.erreur);
      expect(r.statut).toBe("zone-fermee");
      expect(r.zone).toMatchObject({ numero: 1, fermee_motif: "Neige" });
      expect(new Date(r.zone!.fermee_jusqu_a!).toISOString()).toBe(jusqua);
      expect(r.etat).toBeNull();
    } finally {
      await db.query("update zones_livraison set fermee_jusqu_a = null, fermee_motif = null where numero = 1");
    }
  });

  it("hors zone et saisie incomplète", async () => {
    const r = await simulerAdresse({ npa: "1003", localite: "Lausanne" });
    if ("erreur" in r) throw new Error(r.erreur);
    expect(r).toMatchObject({ statut: "hors-zone", zone: null, etat: null });
    expect(await simulerAdresse({ npa: "12", localite: "Onex" })).toMatchObject({ code: 422 });
    expect(await simulerAdresse(null)).toMatchObject({ code: 422 });
  });
});
