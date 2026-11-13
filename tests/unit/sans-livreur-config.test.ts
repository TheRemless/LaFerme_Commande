import { afterAll, describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";

// Aucun livreur prévu : la règle passe dans la config du service seulement quand le gérant la coche.

const { chargerConfigService } = await import("@/lib/config-service");

afterAll(async () => {
  const db = await baseLocale();
  await db.query("update reglages set valeur = 'false' where cle = 'livraison_sans_livreur_fermee'");
});

describe("config du service et services sans livreur", () => {
  it("décochée (départ) : rien ; cochée : les services sans personne de prévu, comme la base les donne", async () => {
    const db = await baseLocale();
    expect((await chargerConfigService()).livraisonSansLivreur).toEqual([]);
    await db.query("update reglages set valeur = 'true' where cle = 'livraison_sans_livreur_fermee'");
    const c = await chargerConfigService();
    const jour = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(new Date());
    const fin = new Date(`${jour}T12:00:00Z`);
    fin.setUTCDate(fin.getUTCDate() + Math.min(14, c.reglages.avance_jours));
    const attendu = (await db.query<{ r: { jour: string; service: string }[] }>("select services_sans_livreur($1, $2) as r", [jour, fin.toISOString().slice(0, 10)])).rows[0].r;
    expect(c.livraisonSansLivreur).toEqual(attendu);
  });
});
