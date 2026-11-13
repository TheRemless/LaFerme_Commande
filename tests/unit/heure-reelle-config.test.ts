import { afterAll, describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";

// Heure promise réaliste : la file réelle passe dans la config du service (base embarquée), sans toucher au
// retard posé à la main que la tablette règle par +5 et -5.

const { chargerConfigService } = await import("@/lib/config-service");
const { chargeDuMoment } = await import("@/lib/heure-reelle-serveur");

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
  await db.query("update reglages set valeur = '0' where cle in ('debit_pizza_quart_heure', 'retard_minutes', 'livraisons_par_livreur_heure')");
  await db.query("delete from livreurs_jours where livreur_id in (select id from personnel where email = 'hrc-livreur@laferme.test')");
  await db.query("update personnel set actif = false where email = 'hrc-livreur@laferme.test'");
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
    // Le détail par poste reste sur le serveur : la config est servie au navigateur par l'accueil.
    expect(JSON.stringify(c)).not.toContain("articles");
    expect((await chargeDuMoment())?.pizza.articles).toBe(22);
    expect(c.reglages.allongement_minutes).toBe(attendu);
    expect(c.reglages.retard_minutes).toBe(10);
    expect(c.reglages.preparation_minutes).toBe(base + 10 + attendu);
    for (const z of c.zones) expect(z.delai_min).toBeGreaterThanOrEqual(10 + attendu);
  });

  it("version 2 : un livreur pour trois livraisons, les zones s'allongent, pas le retrait", async () => {
    const db = await baseLocale();
    await db.query("delete from commandes where client_email = 'hrc@laferme.test'");
    await db.query("update reglages set valeur = '0' where cle in ('debit_pizza_quart_heure', 'retard_minutes')");
    await db.query("update reglages set valeur = '1' where cle = 'livraisons_par_livreur_heure'");
    // Un livreur noté présent pour le service en cours (midi avant 15h à Genève, soir ensuite).
    const livreur = (
      await db.query<{ id: string }>(
        "insert into personnel (email, nom, role) values ('hrc-livreur@laferme.test', 'Hrc livreur', 'livreur') on conflict (email) do update set actif = true returning id",
      )
    ).rows[0].id;
    await db.query(
      `insert into livreurs_jours (livreur_id, jour, service, present)
       select $1, (now() at time zone 'Europe/Zurich')::date, case when extract(hour from now() at time zone 'Europe/Zurich') < 15 then 'midi' else 'soir' end, true
       on conflict (livreur_id, jour, service) do update set present = true`,
      [livreur],
    );
    for (let i = 0; i < 3; i++) {
      const id = await commandeEnCuisine(1);
      await db.query("update commandes set mode = 'livraison' where id = $1", [id]);
    }
    const zones = (await db.query<{ numero: number; delai_min: number }>("select numero, delai_min from zones_livraison")).rows;
    const c = await chargerConfigService();
    // 3 livraisons à 1 par heure : 180 min d'attente, plafonnée à 45 (allongement_max_minutes).
    expect(c.reglages.allongement_minutes).toBe(0);
    expect(c.reglages.allongement_livraison_minutes).toBe(45);
    expect(c.reglages.preparation_minutes).toBe(c.reglages.preparation_base);
    for (const z of c.zones) expect(z.delai_min).toBe(zones.find((x) => x.numero === z.numero)!.delai_min + 45);
    // Ni livreurs présents ni livraisons en route dans la config servie au navigateur.
    expect(JSON.stringify(c)).not.toMatch(/"livreurs"|"livraisons"|attente_minutes/);
    expect((await chargeDuMoment())?.livraison).toMatchObject({ livraisons: 3, livreurs: 1, compte: true });
  });
});
