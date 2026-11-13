import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import { fonctionSql } from "@/lib/db/serveur";

// Vague 3, client-compte : le client corrige les consignes de livraison d'une adresse enregistrée (étage,
// sonnette, code, instructions). Jamais l'adresse d'un autre compte.

async function compteAvecAdresse() {
  const db = await baseLocale();
  const id = (await db.query<{ id: string }>("insert into comptes (email) values ($1) returning id", [`adr-${randomUUID().slice(0, 8)}@exemple.test`])).rows[0].id;
  await db.query("select enregistrer_adresse($1, $2, $3)", [id, { rue: "Route de Chancy", numero: "1", npa: "1213", localite: "Onex" }, { etage: "", sonnette: "Rossi", code: "", instructions: "" }]);
  const adresse = (await db.query<{ id: string }>("select id from adresses_compte where compte_id = $1", [id])).rows[0].id;
  return { id, adresse };
}

describe("consignes d'une adresse enregistrée", () => {
  it("le client les modifie ; le journal du compte le note", async () => {
    const c = await compteAvecAdresse();
    const details = { etage: "3e", sonnette: "Rossi-Muller", code: "4521", instructions: "Porte de gauche." };
    expect(await fonctionSql<boolean>("modifier_details_adresse", { p_compte: c.id, p_adresse: c.adresse, p_details: details, p_ip_court: "10.1" })).toBe(true);
    const db = await baseLocale();
    expect((await db.query<{ details: unknown }>("select details from adresses_compte where id = $1", [c.adresse])).rows[0].details).toEqual(details);
    expect((await db.query<{ n: number }>("select count(*)::int n from journal_connexions where compte_id = $1 and evenement = 'profil_modifie'", [c.id])).rows[0].n).toBe(1);
  });

  it("jamais l'adresse d'un autre compte", async () => {
    const a = await compteAvecAdresse();
    const b = await compteAvecAdresse();
    expect(await fonctionSql<boolean>("modifier_details_adresse", { p_compte: a.id, p_adresse: b.adresse, p_details: { etage: "", sonnette: "Pirate", code: "", instructions: "" }, p_ip_court: "10.1" })).toBe(false);
    const db = await baseLocale();
    expect((await db.query<{ s: string }>("select details ->> 'sonnette' s from adresses_compte where id = $1", [b.adresse])).rows[0].s).toBe("Rossi");
  });
});
