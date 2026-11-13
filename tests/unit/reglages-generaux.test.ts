import { afterEach, describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import { destinataireAlertes, validerReglage } from "@/lib/reglages-generaux";

describe("validerReglage", () => {
  it("accepte les valeurs dans les bornes", () => {
    expect(validerReglage("creneau_minutes", 20)).toEqual({ ok: true, cle: "creneau_minutes", valeur: 20 });
    expect(validerReglage("avance_jours", 0)).toEqual({ ok: true, cle: "avance_jours", valeur: 0 });
    expect(validerReglage("plafond_codes_clients_jour", 450)).toEqual({ ok: true, cle: "plafond_codes_clients_jour", valeur: 450 });
    expect(validerReglage("alerte_email", " Gerant@Exemple.ch ")).toEqual({ ok: true, cle: "alerte_email", valeur: "gerant@exemple.ch" });
    expect(validerReglage("alerte_email", "")).toEqual({ ok: true, cle: "alerte_email", valeur: null });
    expect(validerReglage("annulation_client_active", true)).toEqual({ ok: true, cle: "annulation_client_active", valeur: true });
  });
  it.each([
    ["creneau_minutes", 25, /10, 15, 20 ou 30/],
    ["avance_jours", 15, /0 à 14/],
    ["avance_jours", "3", /0 à 14/],
    ["plafond_codes_clients_jour", 500, /20 à 450/],
    ["alerte_email", "gerant@", /illisible/],
    ["preparation_minutes", 20, /inconnu/],
    ["annulation_client_active", "true", /oui ou non/],
  ])("refuse %s = %j", (cle, valeur, erreur) => {
    const r = validerReglage(cle, valeur);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreur).toMatch(erreur);
  });
});

describe("destinataireAlertes", () => {
  const avant = process.env.ALERTE_EMAIL;
  afterEach(async () => {
    process.env.ALERTE_EMAIL = avant;
    await (await baseLocale()).query("update reglages_prives set valeur = 'null' where cle = 'alerte_email'");
  });
  it("la variable ALERTE_EMAIL tant que rien n'est saisi, puis l'adresse saisie", async () => {
    process.env.ALERTE_EMAIL = "variable@laferme.test";
    expect(await destinataireAlertes()).toBe("variable@laferme.test");
    await (await baseLocale()).query(`update reglages_prives set valeur = '"saisie@laferme.test"' where cle = 'alerte_email'`);
    expect(await destinataireAlertes()).toBe("saisie@laferme.test");
  });
});
