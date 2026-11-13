import { afterAll, describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";

// Heure promise réaliste : la file réelle passe dans la config du service (base embarquée), sans toucher au
// retard posé à la main que la tablette règle par +5 et -5.

const { chargerConfigService } = await import("@/lib/config-service");

async function commandeEnCuisine(pizzas: number): Promise<string> {
  const db = await baseLocale();
  const p = {
    jeton_suivi: `jeton-hrc-${pizzas}-${Date.now()}`,
    cle_idempotence: `hrc-${pizzas}-${Date.now()}`,
    mode: "retrait",
    statut: "nouvelle",
    statut_paiement: "a_encaisser_retrait",
    moyen_paiement: "comptoir",
    zone_numero: null,
    client_prenom: "Config",
    client_nom: "Test",
    client_telephone: "079 000 00 00",
    client_email: "hrc@laferme.test",
    quand_type: "asap",
    pizzas_seulement: true,
    sous_total_centimes: 3000,
    frais_centimes: 0,
    total_centimes: 3000,
    tva_centimes: 76,
    taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    lignes: Array.from({ length: Math.ceil(pizzas / 20) }, (_, i) => ({
      slug: "pizza-margherita",
      nom: "Pizza Margherita",
      station: "pizza",
      qte: Math.min(20, pizzas - i * 20),
      unitaire_centimes: 1500,
      total_centimes: 1500,
      choix: {},
      retraits: [],
      note: "",
    })),
  };
  const id = (await db.query<{ id: string }>("select id from creer_commande($1)", [p])).rows[0].id;
  await db.query("update commandes set statut = 'acceptee', heure_confirmee = now() where id = $1", [id]);
  return id;
}

afterAll(async () => {
  const db = await baseLocale();
  await db.query("delete from commandes where client_email = 'hrc@laferme.test'");
  await db.query("update reglages set valeur = '0' where cle in ('debit_pizza_quart_heure', 'retard_minutes')");
});

describe("config du service et file réelle", () => {
  it("débits à zéro : heures inchangées", async () => {
    const c = await chargerConfigService();
    expect(c.reglages.allongement_minutes).toBe(0);
    expect(c.reglages.preparation_minutes).toBe(c.reglages.preparation_base);
    expect(c.reglages.fourchette).toEqual({ livraison: 15, retrait: 10 });
  });

  it("22 pizzas en file : allongement ajouté aux heures, retard manuel intact", async () => {
    const db = await baseLocale();
    await db.query("update reglages set valeur = '8' where cle = 'debit_pizza_quart_heure'");
    await db.query("update reglages set valeur = '10' where cle = 'retard_minutes'");
    await commandeEnCuisine(22);
    const c = await chargerConfigService();
    const base = c.reglages.preparation_base!;
    // 22 pizzas à 8 par quart d'heure : 42 min de file, moins la préparation habituelle, arrondi aux 5 minutes.
    const attendu = Math.min(45, Math.ceil(Math.max(0, 42 - base) / 5) * 5);
    expect(c.reglages.charge?.pizza.articles).toBe(22);
    expect(c.reglages.allongement_minutes).toBe(attendu);
    expect(c.reglages.retard_minutes).toBe(10);
    expect(c.reglages.preparation_minutes).toBe(base + 10 + attendu);
    for (const z of c.zones) expect(z.delai_min).toBeGreaterThanOrEqual(10 + attendu);
  });
});
