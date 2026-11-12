import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Vague 2 de la session gérant, côté base : rupture d'un supplément et manque signalé (G07, option A),
// fermeture d'un seul service et ouverture exceptionnelle, communes d'une zone, plafond du comptoir,
// retour arrière depuis le journal (G11). Horloge réglable comme dans gerant-correctifs-sql.test.ts.

let db: PGlite;

async function horloge(iso: string) {
  await db.query("delete from horloge_test where true");
  await db.query("insert into horloge_test values ($1::timestamptz)", [iso]);
}
async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}
async function erreur(sql: string, v: unknown[] = []): Promise<string> {
  try {
    await f(sql, v);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return "aucune erreur";
}
async function id(email: string): Promise<string> {
  return (await db.query<{ id: string }>("select id from personnel where email = $1", [email])).rows[0].id;
}

let n = 0;
// Deux Margherita avec ananas (unitaire 2300) et une lasagne (1800) : 6400 au total.
function commande(extra: Record<string, unknown> = {}) {
  n += 1;
  return {
    jeton_suivi: `jeton-v2-${n}`,
    cle_idempotence: `v2-${n}`,
    mode: "retrait",
    statut: "paiement_en_attente",
    statut_paiement: "en_attente",
    moyen_paiement: "en_ligne",
    client_prenom: `V${n}`,
    client_nom: "Test",
    client_telephone: "079 000 00 00",
    client_email: "v2@laferme.test",
    quand_type: "asap",
    pizzas_seulement: false,
    sous_total_centimes: 6400,
    frais_centimes: 0,
    total_centimes: 6400,
    tva_centimes: 162,
    taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    lignes: [
      { slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 2, unitaire_centimes: 2300, total_centimes: 4600, choix: { "supplements-pizza": ["Ananas"] }, retraits: [], note: "" },
      { slug: "lasagne-de-boeuf", nom: "Lasagne de bœuf", station: "cuisine", qte: 1, unitaire_centimes: 1800, total_centimes: 1800, choix: {}, retraits: [], note: "" },
    ],
    ...extra,
  };
}

async function acceptee(extra: Record<string, unknown> = {}, payer = true): Promise<{ id: string; numero: number }> {
  const c = (await db.query<{ id: string; numero: number }>("select * from creer_commande($1)", [commande(extra)])).rows[0];
  if (payer) await f("appliquer_paiement($1, $2, 'paye', 'pi_v2', 6400)", [`evt-${c.id}`, c.id]);
  await f("changer_statut($1, 'acceptee', 'tablette:Test', now())", [c.id]);
  return c;
}

let gerant: string;
let service: string;

beforeEach(async () => {
  db = await creerBaseLocale();
  await db.exec(`
    create table horloge_test (t timestamptz);
    create function public.now() returns timestamptz language sql stable as $$ select coalesce((select t from horloge_test limit 1), transaction_timestamp()) $$;
    set search_path = public, pg_catalog;
  `);
  gerant = await id("equipe@laferme.test");
  service = await id("equipe-bureau@laferme.test");
});

describe("G07 : rupture d'un supplément", () => {
  it("se pose depuis la tablette et se lève seule le lendemain", async () => {
    // Heure réelle d'abord : les vues gardent l'heure réelle, les fonctions suivent l'horloge du test.
    expect(await f<boolean>("regler_rupture_option('supplements-pizza', 'Burrata', true, $1)", [service])).toBe(true);
    const vue = (await db.query<{ rupture: boolean }>("select rupture from options_publiques where groupe_slug = 'supplements-pizza' and nom = 'Burrata'")).rows[0].rupture;
    expect(vue).toBe(true);
    const tablette = async () => (await f<{ groupe: string; nom: string; rupture: boolean }[]>("options_tablette()")).find((o) => o.nom === "Burrata");
    expect(await tablette()).toMatchObject({ groupe: "supplements-pizza", rupture: true });
    await horloge(new Date(Date.now() + 36 * 3600_000).toISOString());
    expect(await tablette()).toMatchObject({ rupture: false });
  });

  it("refuse un supplément inconnu", async () => {
    expect(await f<boolean>("regler_rupture_option('supplements-pizza', 'Caviar', true, $1)", [service])).toBe(false);
  });
});

describe("G07 : un plat ou un supplément manque sur une commande acceptée", () => {
  it("estime sans rien écrire, puis rembourse ce qui manque, calculé par la base", async () => {
    const c = await acceptee();
    const elements = [{ ligne: 0, qte: 1 }, { ligne: 1, groupe: null, qte: 1 }];
    const estime = await f<{ montant_centimes: number; description: string }>("signaler_manque($1, $2, 'cle-manque-01', $3, false)", [c.id, elements, service]);
    expect(estime).toMatchObject({ montant_centimes: 4100, description: "1 × Pizza Margherita, 1 × Lasagne de bœuf" });
    expect((await db.query<{ n: number }>("select count(*)::int as n from remboursements")).rows[0].n).toBe(0);
    const r = await f<{ montant_centimes: number; moyen: string; statut: string }>("signaler_manque($1, $2, 'cle-manque-01', $3, true)", [c.id, elements, service]);
    expect(r).toMatchObject({ montant_centimes: 4100, moyen: "stripe", statut: "en_cours" });
  });

  it("rembourse un supplément manquant au prix du supplément, pour chaque pizza", async () => {
    const c = await acceptee();
    const r = await f<{ montant_centimes: number; description: string }>("signaler_manque($1, $2, 'cle-manque-02', $3, true)", [
      c.id,
      [{ ligne: 0, groupe: "supplements-pizza", nom: "Ananas" }],
      service,
    ]);
    expect(r).toMatchObject({ montant_centimes: 400, description: "Ananas sur 2 × Pizza Margherita" });
  });

  it("ne signale pas deux fois la même chose ni plus que la quantité", async () => {
    const c = await acceptee();
    await f("signaler_manque($1, $2, 'cle-manque-03', $3, true)", [c.id, [{ ligne: 0, qte: 1 }], service]);
    expect(await erreur("signaler_manque($1, $2, 'cle-manque-04', $3, true)", [c.id, [{ ligne: 0, qte: 2 }], service])).toContain("deja_signale");
    await f("signaler_manque($1, $2, 'cle-manque-05', $3, true)", [c.id, [{ ligne: 0, groupe: "supplements-pizza", nom: "Ananas" }], service]);
    expect(await erreur("signaler_manque($1, $2, 'cle-manque-06', $3, true)", [c.id, [{ ligne: 0, groupe: "supplements-pizza", nom: "Ananas" }], service])).toContain(
      "deja_signale",
    );
    expect(await erreur("signaler_manque($1, $2, 'cle-manque-07', $3, true)", [c.id, [{ ligne: 5, qte: 1 }], service])).toContain("ligne_inconnue");
    expect(await erreur("signaler_manque($1, $2, 'cle-manque-08', $3, true)", [c.id, [{ ligne: 1, groupe: "supplements-pizza", nom: "Ail" }], service])).toContain(
      "option_absente",
    );
  });

  it("au comptoir pas encore payé, le manque se déduit de ce qu'il reste à encaisser", async () => {
    const c = await acceptee({ statut: "nouvelle", statut_paiement: "a_encaisser_retrait", moyen_paiement: "comptoir" }, false);
    const r = await f<{ moyen: string; statut: string }>("signaler_manque($1, $2, 'cle-manque-09', $3, true)", [c.id, [{ ligne: 1, qte: 1 }], service]);
    expect(r).toMatchObject({ moyen: "deduction", statut: "fait" });
    const a = await f<{ commande_id: string; deduit_centimes: number; manques: string[] }[]>("manques_en_cours()");
    expect(a.find((x) => x.commande_id === c.id)).toMatchObject({ deduit_centimes: 1800, manques: ["1 × Lasagne de bœuf"] });
  });

  it("seulement une fois acceptée, et par un membre actif", async () => {
    const c = (await db.query<{ id: string }>("select * from creer_commande($1)", [commande()])).rows[0];
    await f("appliquer_paiement($1, $2, 'paye', 'pi_v2', 6400)", [`evt-${c.id}`, c.id]);
    expect(await erreur("signaler_manque($1, $2, 'cle-manque-10', $3, true)", [c.id, [{ ligne: 0, qte: 1 }], service])).toContain("statut_non_remboursable");
    await f("changer_statut($1, 'acceptee', 'tablette:Test', now())", [c.id]);
    await db.query("update personnel set actif = false where id = $1", [service]);
    expect(await erreur("signaler_manque($1, $2, 'cle-manque-11', $3, true)", [c.id, [{ ligne: 0, qte: 1 }], service])).toContain("personnel_inactif");
  });

  it("l'export ne compte pas le remboursement d'une commande refusée ensuite", async () => {
    const c = await acceptee();
    const r = await f<{ id: string }>("signaler_manque($1, $2, 'cle-manque-12', $3, true)", [c.id, [{ ligne: 1, qte: 1 }], service]);
    await f("terminer_remboursement($1, true, 're_m', null)", [r.id]);
    await f("changer_statut($1, 'refusee', 'tablette:Test', null, 'Plus de pâte.')", [c.id]);
    const jour = (await db.query<{ j: string }>("select (now() at time zone 'Europe/Zurich')::date::text as j")).rows[0].j;
    expect(await f<unknown[]>("export_remboursements($1, $1)", [jour])).toHaveLength(0);
  });
});

describe("fermer un seul service, ouvrir un jour non prévu", () => {
  it("se règlent depuis le back-office et vont au journal", async () => {
    await f("ajouter_fermeture_service('2026-12-08', 'midi', 'Jour férié', $1)", [gerant]);
    const fe = (await db.query<{ debut: string; fin: string; service: string }>("select debut::text, fin::text, service from fermetures where motif = 'Jour férié'")).rows[0];
    expect(fe).toEqual({ debut: "2026-12-08", fin: "2026-12-08", service: "midi" });
    const o = await f<number>("ajouter_ouverture($1, $2)", [
      { jour: "2026-12-20", service: "soir", premiere_heure: "18:45", derniere_heure: "22:00", derniere_commande: "21:00", derniere_commande_pizzas: "21:30", motif: "Dimanche avant Noël" },
      gerant,
    ]);
    expect(o).toBeGreaterThan(0);
    const lu = (await db.query<{ jour: string; service: string }>("select jour::text, service from ouvertures")).rows;
    expect(lu).toEqual([{ jour: "2026-12-20", service: "soir" }]);
    const objets = (await db.query<{ objet: string }>("select objet from journal_gestion order by id")).rows.map((r) => r.objet);
    expect(objets).toEqual(["fermeture", "ouverture"]);
    expect(await f<boolean>("supprimer_ouverture($1::smallint, $2)", [o, gerant])).toBe(true);
    expect(await erreur("ajouter_fermeture_service('2026-12-08', 'nuit', 'x', $1)", [gerant])).toContain("service_invalide");
    expect(await erreur("ajouter_ouverture($1, $2)", [{ jour: "2026-12-21", service: "soir", premiere_heure: "22:00", derniere_heure: "21:00", derniere_commande: "21:00", derniere_commande_pizzas: "21:00", motif: "x" }, gerant])).toContain(
      "heures_invalides",
    );
  });

  it("l'ouverture se lit sans connexion, comme les horaires", async () => {
    await f("ajouter_ouverture($1, $2)", [
      { jour: "2026-12-20", service: "soir", premiere_heure: "18:45", derniere_heure: "22:00", derniere_commande: "21:00", derniere_commande_pizzas: "21:30", motif: "Dimanche avant Noël" },
      gerant,
    ]);
    const lu = await db.transaction(async (tx) => {
      await tx.exec("set local role anon");
      return (await tx.query<{ jour: string }>("select jour::text from ouvertures")).rows;
    });
    expect(lu).toHaveLength(1);
  });

  it("dit quelles commandes sont déjà prises sur une période", async () => {
    await acceptee({ quand_type: "creneau", quand_date: "2026-12-08", quand_minutes: 720 });
    await acceptee({ quand_type: "creneau", quand_date: "2026-12-08", quand_minutes: 1170 });
    expect(await f<number[]>("commandes_dans_periode('2026-12-08', '2026-12-08', 'midi')")).toHaveLength(1);
    expect(await f<number[]>("commandes_dans_periode('2026-12-08', '2026-12-08', null)")).toHaveLength(2);
  });
});

describe("communes d'une zone", () => {
  it("ajoute, déplace et retire un couple NPA et localité, journalisé", async () => {
    expect(await f<boolean>("ajouter_npa_zone('1234', 'Vessy', 1::smallint, $1)", [gerant])).toBe(true);
    expect((await db.query<{ z: number }>("select zone_numero as z from zone_npa where npa = '1234' and localite = 'Vessy'")).rows[0].z).toBe(1);
    await f("ajouter_npa_zone('1234', 'Vessy', 2::smallint, $1)", [gerant]);
    expect((await db.query<{ z: number }>("select zone_numero as z from zone_npa where npa = '1234' and localite = 'Vessy'")).rows[0].z).toBe(2);
    expect(await f<boolean>("retirer_npa_zone('1234', 'Vessy', $1)", [gerant])).toBe(true);
    expect((await db.query("select 1 from zone_npa where npa = '1234'")).rows).toHaveLength(0);
    expect((await db.query("select 1 from journal_gestion where objet = 'zone_npa'")).rows).toHaveLength(3);
  });

  it("refuse un NPA hors de Genève, une zone inconnue, un membre du service", async () => {
    expect(await erreur("ajouter_npa_zone('1003', 'Lausanne', 1::smallint, $1)", [gerant])).toContain("npa_invalide");
    expect(await erreur("ajouter_npa_zone('1234', 'Vessy', 9::smallint, $1)", [gerant])).toContain("zone_inconnue");
    expect(await erreur("ajouter_npa_zone('1234', 'Vessy', 1::smallint, $1)", [service])).toContain("Réservé au gérant");
  });
});

describe("plafond du paiement au comptoir", () => {
  it("se règle au back-office, journalisé, de 0 à 500 francs", async () => {
    await f("regler_plafond_comptoir(12000, $1)", [gerant]);
    expect((await db.query<{ v: number }>("select valeur as v from reglages where cle = 'plafond_comptoir_centimes'")).rows[0].v).toBe(12000);
    expect(await erreur("regler_plafond_comptoir(60000, $1)", [gerant])).toContain("plafond_invalide");
    expect(await erreur("regler_plafond_comptoir(5000, $1)", [service])).toContain("Réservé au gérant");
  });
});

describe("G11 : retour arrière depuis le journal", () => {
  const derniere = async () => (await db.query<{ id: number }>("select id from journal_gestion order by id desc limit 1")).rows[0].id;

  it("remet les frais d'une zone et marque la ligne annulée", async () => {
    const avant = (await db.query<{ f: number }>("select frais_centimes as f from zones_livraison where numero = 1")).rows[0].f;
    await f("modifier_zone(1::smallint, $1, $2)", [{ frais_centimes: avant + 500 }, gerant]);
    const e = await derniere();
    await f("annuler_journal($1, $2)", [e, gerant]);
    expect((await db.query<{ f: number }>("select frais_centimes as f from zones_livraison where numero = 1")).rows[0].f).toBe(avant);
    expect((await db.query<{ a: number | null }>("select annule_par as a from journal_gestion where id = $1", [e])).rows[0].a).toBeGreaterThan(e);
    expect(await erreur("annuler_journal($1, $2)", [e, gerant])).toContain("deja_annule");
  });

  it("refuse si la valeur a changé depuis", async () => {
    await f("modifier_zone(1::smallint, $1, $2)", [{ frais_centimes: 300 }, gerant]);
    const e = await derniere();
    await f("modifier_zone(1::smallint, $1, $2)", [{ frais_centimes: 400 }, gerant]);
    expect(await erreur("annuler_journal($1, $2)", [e, gerant])).toContain("deja_change");
  });

  it("remet un prix, une fermeture supprimée, un plafond et une commune", async () => {
    await f("modifier_plat('pizza-margherita', $1, $2)", [{ prix_centimes: 2500, prix_valide: true }, gerant]);
    const ePrix = await derniere();
    await f("annuler_journal($1, $2)", [ePrix, gerant]);
    expect((await db.query<{ p: number }>("select prix_centimes as p from plats where slug = 'pizza-margherita'")).rows[0].p).toBe(1800);

    await f("ajouter_fermeture('2027-01-02', '2027-01-03', 'Test', $1)", [gerant]);
    const fid = (await db.query<{ id: number }>("select id from fermetures where motif = 'Test'")).rows[0].id;
    await f("supprimer_fermeture($1::smallint, $2)", [fid, gerant]);
    await f("annuler_journal($1, $2)", [await derniere(), gerant]);
    expect((await db.query("select 1 from fermetures where motif = 'Test'")).rows).toHaveLength(1);

    await f("regler_plafond_comptoir(15000, $1)", [gerant]);
    await f("annuler_journal($1, $2)", [await derniere(), gerant]);
    expect((await db.query<{ v: number }>("select valeur as v from reglages where cle = 'plafond_comptoir_centimes'")).rows[0].v).toBe(10000);

    await f("ajouter_npa_zone('1234', 'Vessy', 1::smallint, $1)", [gerant]);
    await f("annuler_journal($1, $2)", [await derniere(), gerant]);
    expect((await db.query("select 1 from zone_npa where npa = '1234'")).rows).toHaveLength(0);
  });

  it("refuse l'équipe, les remboursements et l'import, et le personnel de service", async () => {
    await f("ajouter_personnel('x@y.ch', 'X', 'service', $1)", [gerant]);
    expect(await erreur("annuler_journal($1, $2)", [await derniere(), gerant])).toContain("non_annulable");
    await f("modifier_zone(1::smallint, $1, $2)", [{ frais_centimes: 310 }, gerant]);
    expect(await erreur("annuler_journal($1, $2)", [await derniere(), service])).toContain("Réservé au gérant");
  });

  it("accepte tout objet de journal bien formé (contrôle de forme, pas de liste)", async () => {
    await db.query("insert into journal_gestion (personnel_nom, objet, cle) values ('Test', 'plat_du_jour', 'x')");
    await expect(db.query("insert into journal_gestion (personnel_nom, objet, cle) values ('Test', 'Pas Bon!', 'x')")).rejects.toThrow();
  });
});
