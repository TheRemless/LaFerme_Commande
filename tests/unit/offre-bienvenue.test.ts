import { describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";

// Offre de bienvenue A (13.11.2026) : préparée éteinte, 10 % sur la première commande seulement.
const evaluer = async (p: Record<string, unknown>) =>
  (await (await baseLocale()).query<{ r: { ok: boolean; raison?: string; remise_centimes?: number } }>("select evaluer_code($1) as r", [p])).rows[0].r;
const client = { code: "bienvenue", email: "bienvenue-essai@laferme.test", telephone: "079 555 01 02", adresse: null, mode: "retrait", sous_total_centimes: 5000, frais_centimes: 0 };

describe("offre de bienvenue", () => {
  it("éteinte au départ : rien ne s'applique", async () => {
    const db = await baseLocale();
    const c = (await db.query<{ actif: boolean; premiere_commande: boolean }>("select actif, premiere_commande from codes_promo where code = 'BIENVENUE'")).rows[0];
    expect(c).toEqual({ actif: false, premiere_commande: true });
    expect((await evaluer(client)).ok).toBe(false);
  });

  it("allumée : 10 % des plats sur une première commande", async () => {
    const db = await baseLocale();
    await db.query("update reglages set valeur = 'true' where cle = 'codes_promo_actifs'");
    await db.query("update codes_promo set actif = true where code = 'BIENVENUE'");
    try {
      expect(await evaluer(client)).toMatchObject({ ok: true, remise_centimes: 500 });
    } finally {
      await db.query("update codes_promo set actif = false where code = 'BIENVENUE'");
      await db.query("update reglages set valeur = 'false' where cle = 'codes_promo_actifs'");
    }
  });
});
