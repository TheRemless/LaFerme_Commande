import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Ventilation figée (supabase/migrations/20261217190000_ventilation_figee.sql ; demande du chef, bo-pilotage et
// bo-carte, art. 41 LTVA) : la vente d'origine d'une commande payée garde sa ventilation par taux ; une modification
// a la sienne, parts signées, que portent le complément ou l'avoir. Aucun prix ni taux en dur : lus en base.

let db: PGlite;
let gerant: string;
let normal: number;
let reduit: number;
let pizza: { slug: string; nom: string; prix: number };
let biere: { slug: string; nom: string; prix: number };
type Part = { taux: number; ttc: number; tva: number };

async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}
const tva = (ttc: number, t: number) => Math.round((ttc * t) / (100 + t));
const parts = (v: Part[]) => v.map((x) => ({ taux: Number(x.taux), ttc: x.ttc, tva: x.tva }));

const ligne = (p: { slug: string; nom: string; prix: number }, qte = 1) => ({
  slug: p.slug, nom: p.nom, station: "cuisine", qte, unitaire_centimes: p.prix, total_centimes: p.prix * qte, choix: {}, retraits: [], note: "",
});
type Ligne = ReturnType<typeof ligne>;

let n = 0;
async function commande(lignes: Ligne[], comptoir = false, remise = 0): Promise<string> {
  n += 1;
  const total = lignes.reduce((t, l) => t + l.total_centimes, 0) - remise;
  const c = (await db.query<{ id: string }>("select id from creer_commande($1)", [{
    jeton_suivi: `jeton-figee-${n}-abcdefgh`, cle_idempotence: `figee-${n}-cle-essai`, mode: "retrait",
    statut: comptoir ? "nouvelle" : "paiement_en_attente", statut_paiement: comptoir ? "a_encaisser_retrait" : "en_attente",
    moyen_paiement: comptoir ? "comptoir" : "en_ligne", client_prenom: "Léa", client_nom: "Rossi", client_telephone: "079 555 12 34",
    client_email: "figee@exemple.ch", quand_type: "asap", pizzas_seulement: false, sous_total_centimes: total + remise, frais_centimes: 0,
    total_centimes: total, tva_centimes: 1, taux_tva_pourcent: 0, origine: "http://localhost:3000", lignes, remise_centimes: remise,
  }])).rows[0].id;
  // Payée par l'événement de paiement, comme en vrai : c'est là que la ventilation se fige.
  if (!comptoir) await f("appliquer_paiement($1, $2, 'paye', 'pi_figee', $3)", [`evt-${c}`, c, total]);
  await f("changer_statut($1, 'acceptee', 'tablette:Test', now())", [c]);
  return c;
}
function demande(cle: string, lignes: Ligne[], extra: Record<string, unknown> = {}) {
  const total = lignes.reduce((t, l) => t + l.total_centimes, 0);
  return { cle, de: "acceptee", lignes, ajouts: [], retires: [], sous_total_centimes: total, frais_centimes: 0, total_centimes: total, tva_centimes: 0, ...extra };
}
const modifier = (c: string, p: unknown) => f<Record<string, unknown>>("preparer_modification($1, $2, $3)", [c, p, gerant]);
// Requête entière dont la colonne s'appelle r.
async function q<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(sql, v)).rows[0].r;
}
const ventilation = (c: string) => q<Part[]>("select ventilation_commande(c) as r from commandes c where c.id = $1", [c]);

beforeAll(async () => {
  db = await creerBaseLocale();
  gerant = (await db.query<{ id: string }>("insert into personnel (email, nom, role) values ('figee-gerant@laferme.test', 'Gérant figée', 'gerant') returning id")).rows[0].id;
  normal = Number(await f<string>("taux_tva_du('normal', current_date)::text"));
  reduit = Number(await f<string>("taux_tva_du('reduit', current_date)::text"));
  const p = (await db.query<{ slug: string; nom: string; prix_centimes: number }>("select slug, nom, prix_centimes from plats where slug = 'pizza-margherita'")).rows[0];
  pizza = { slug: p.slug, nom: p.nom, prix: p.prix_centimes };
  // Une bière d'essai au prix de la pizza (pour l'échange au même prix), à 5 % vol. : taux normal.
  await db.query(
    "insert into plats (slug, categorie_id, nom, prix_centimes, station, commandable) select 'biere-essai-figee', id, 'Bière essai', $1, 'comptoir', false from categories where slug = 'boissons'",
    [pizza.prix],
  );
  await f("regler_teneur_alcool('biere-essai-figee', 5, $1)", [gerant]);
  biere = { slug: "biere-essai-figee", nom: "Bière essai", prix: pizza.prix };
});

describe("ventilation figée", () => {
  it("payée, puis échange au même prix : la vente d'origine ne bouge pas, la modification porte l'avoir et la vente (somme 0)", async () => {
    const c = await commande([ligne(pizza)]);
    const avant = await ventilation(c);
    expect(parts(avant)).toEqual([{ taux: reduit, ttc: pizza.prix, tva: tva(pizza.prix, reduit) }]);
    const tvaAvant = (await db.query<{ t: number; x: string }>("select tva_centimes as t, taux_tva_pourcent::text as x from commandes where id = $1", [c])).rows[0];
    const r = await modifier(c, demande(`figee-${n}-echange-01`, [ligne(biere)]));
    expect(r).toMatchObject({ applique: true, difference_centimes: 0 });
    expect(await ventilation(c)).toEqual(avant);
    const apres = (await db.query<{ t: number; x: string }>("select tva_centimes as t, taux_tva_pourcent::text as x from commandes where id = $1", [c])).rows[0];
    expect(apres).toEqual(tvaAvant);
    const m = (await db.query<{ ventilation: Part[]; fini_le: string | null }>("select ventilation, fini_le from modifications_commande where commande_id = $1", [c])).rows[0];
    expect(parts(m.ventilation)).toEqual([
      { taux: reduit, ttc: -pizza.prix, tva: -tva(pizza.prix, reduit) },
      { taux: normal, ttc: biere.prix, tva: tva(biere.prix, normal) },
    ]);
    expect(m.fini_le).not.toBeNull();
  });

  it("plus chère, complément au comptoir : il porte les parts signées de la modification, sa TVA en est la somme", async () => {
    const c = await commande([ligne(pizza)]);
    const avant = await ventilation(c);
    // Pizza retirée, deux bières : complément d'une bière, parts { réduit : −pizza, normal : +2 bières }.
    await modifier(c, demande(`figee-${n}-comptoir-0`, [ligne(biere, 2)], { reglement: "comptoir" }));
    expect(await ventilation(c)).toEqual(avant);
    // Invariant de bo-pilotage : commande payée, somme des ttc = total payé au départ, somme des tva = tva_centimes.
    const o = (await db.query<{ total_centimes: number; tva_centimes: number }>("select total_centimes, tva_centimes from commandes where id = $1", [c])).rows[0];
    const v = await ventilation(c);
    expect(v.reduce((t, x) => t + x.ttc, 0)).toBe(o.total_centimes);
    expect(v.reduce((t, x) => t + x.tva, 0)).toBe(o.tva_centimes);
    const k = (await db.query<{ id: string; montant_centimes: number; tva_centimes: number; ventilation: Part[] }>(
      "select id, montant_centimes, tva_centimes, ventilation from complements where commande_id = $1", [c])).rows[0];
    const attendu = [
      { taux: reduit, ttc: -pizza.prix, tva: -tva(pizza.prix, reduit) },
      { taux: normal, ttc: 2 * biere.prix, tva: tva(2 * biere.prix, normal) },
    ];
    expect(parts(k.ventilation)).toEqual(attendu);
    expect(k.montant_centimes).toBe(biere.prix);
    expect(k.tva_centimes).toBe(attendu[0].tva + attendu[1].tva);
    expect(parts(await q<Part[]>("select ventilation_complement(k) as r from complements k where k.id = $1", [k.id]))).toEqual(attendu);
  });

  it("moins chère : l'avoir désigne la modification, sa ventilation est l'opposé de celle de la modification", async () => {
    const c = await commande([ligne(pizza), ligne(biere)]);
    const avant = await ventilation(c);
    expect(parts(avant).map((x) => x.taux)).toEqual([reduit, normal]);
    await modifier(c, demande(`figee-${n}-baisse-001`, [ligne(pizza)]));
    expect(await ventilation(c)).toEqual(avant);
    const rb = (await db.query<{ id: string; montant_centimes: number; modification_id: string | null }>(
      "select id, montant_centimes, modification_id from remboursements where commande_id = $1", [c])).rows[0];
    expect(rb.modification_id).not.toBeNull();
    expect(rb.montant_centimes).toBe(biere.prix);
    expect(parts(await q<Part[]>("select ventilation_remboursement(x) as r from remboursements x where x.id = $1", [rb.id]))).toEqual([
      { taux: normal, ttc: biere.prix, tva: tva(biere.prix, normal) },
    ]);
  });

  it("à encaisser : suit ses lignes jusqu'à l'encaissement, puis figée ; la modification d'avant n'a pas de ventilation", async () => {
    const c = await commande([ligne(pizza)], true);
    await modifier(c, demande(`figee-${n}-comptoir-1`, [ligne(biere)]));
    expect(parts(await ventilation(c))).toEqual([{ taux: normal, ttc: biere.prix, tva: tva(biere.prix, normal) }]);
    expect((await db.query<{ v: unknown }>("select ventilation as v from modifications_commande where commande_id = $1", [c])).rows[0].v).toBeNull();
    expect((await db.query<{ v: unknown }>("select ventilation_figee as v from commandes where id = $1", [c])).rows[0].v).toBeNull();
    await f("marquer_encaisse($1, 'tablette:Test', 'especes')", [c]);
    const figee = (await db.query<{ v: Part[] }>("select ventilation_figee as v from commandes where id = $1", [c])).rows[0].v;
    expect(parts(figee)).toEqual([{ taux: normal, ttc: biere.prix, tva: tva(biere.prix, normal) }]);
  });

  it("une ligne offerte (0 CHF) à 8,1 % ne donne pas son taux à une commande à encaisser", async () => {
    const c = await commande([ligne(pizza)], true);
    await db.query(
      "insert into commande_lignes (commande_id, position, plat_slug, nom, station, qte, unitaire_centimes, total_centimes, note, offert) values ($1, 2, $2, $3, 'cuisine', 1, 0, 0, 'Offert', true)",
      [c, biere.slug, biere.nom],
    );
    expect(Number((await db.query<{ t: string }>("select taux_tva_pourcent::text as t from commandes where id = $1", [c])).rows[0].t)).toBe(reduit);
  });

  it("rattrapage des commandes déjà payées : seule la ventilation figée change, modifie_le garde sa vraie date", async () => {
    const c = await commande([ligne(pizza)]);
    // Comme une commande payée avant la migration : pas encore figée, modifiée pour la dernière fois il y a un mois.
    await db.query("alter table commandes disable trigger commandes_modifie_le");
    await db.query("update commandes set ventilation_figee = null, modifie_le = now() - interval '30 days' where id = $1", [c]);
    await db.query("alter table commandes enable trigger commandes_modifie_le");
    const avant = (await db.query<{ m: string }>("select modifie_le::text as m from commandes where id = $1", [c])).rows[0].m;
    expect(await f<number>("rattraper_ventilations_figees()")).toBeGreaterThanOrEqual(1);
    const apres = (await db.query<{ m: string; v: Part[] | null }>("select modifie_le::text as m, ventilation_figee as v from commandes where id = $1", [c])).rows[0];
    expect(apres.m).toBe(avant);
    expect(parts(apres.v ?? [])).toEqual([{ taux: reduit, ttc: pizza.prix, tva: tva(pizza.prix, reduit) }]);
    // Le déclencheur est bien rallumé.
    await db.query("update commandes set client_nom = client_nom where id = $1", [c]);
    expect((await db.query<{ m: string }>("select modifie_le::text as m from commandes where id = $1", [c])).rows[0].m).not.toBe(avant);
  });

  // Défaut 3 de la relecture de client-compte : une commande remboursée en entier doit finir à 0, en argent et en TVA,
  // à chaque taux. Vente figée + compléments − avoirs, par taux.
  async function net(c: string) {
    const v = new Map<number, { ttc: number; tva: number }>();
    const ajouter = (x: Part, signe: number) => {
      const t = Number(x.taux);
      const e = v.get(t) ?? { ttc: 0, tva: 0 };
      v.set(t, { ttc: e.ttc + signe * x.ttc, tva: e.tva + signe * x.tva });
    };
    for (const x of await ventilation(c)) ajouter(x, 1);
    for (const r of (await db.query<{ v: Part[] }>("select ventilation_remboursement(x) as v from remboursements x where x.commande_id = $1 and x.statut in ('fait', 'en_cours')", [c])).rows)
      for (const x of r.v) ajouter(x, -1);
    return [...v.entries()].filter(([, e]) => e.ttc !== 0 || e.tva !== 0).map(([taux, e]) => ({ taux, ...e }));
  }

  for (const [nom, lignes, gardee] of [
    ["un taux", () => [ligne(pizza, 2)], () => ligne(pizza)],
    ["deux taux", () => [ligne(pizza), ligne(biere)], () => ligne(biere)],
  ] as const) {
    it(`${nom}, avec une réduction : baisse remboursée, puis le reste rendu par le gérant ; net 0 en argent et en TVA à chaque taux`, async () => {
      const remise = Math.round(pizza.prix / 2);
      const c = await commande([...lignes()], true, remise);
      await f("marquer_encaisse($1, 'tablette:Test', 'especes')", [c]);
      // La pizza retirée : remboursée sur ce qui a été payé.
      await modifier(c, demande(`figee-${n}-net0-baisse`, [gardee()]));
      const reste = (await db.query<{ r: number }>(
        "select o.total_centimes - coalesce((select sum(montant_centimes) from remboursements where commande_id = o.id and statut in ('fait', 'en_cours')), 0) as r from commandes o where o.id = $1", [c])).rows[0].r;
      await f("changer_statut($1, 'prete', 'tablette:Test', now())", [c]);
      if (reste > 0) await f("demander_remboursement($1, $2, 'Le reste', $3, $4)", [c, reste, `cle-net0-${n}`, gerant]);
      expect(await net(c)).toEqual([]);
    });
  }

  it("la cagnotte (réduction) n'est jamais rendue, la baisse remboursée en entier finit à net 0 en TVA", async () => {
    const remise = pizza.prix + Math.round(biere.prix / 2);
    const c = await commande([ligne(pizza), ligne(biere), ligne(pizza)], true, remise);
    await f("marquer_encaisse($1, 'tablette:Test', 'especes')", [c]);
    // On ne garde qu'une pizza : la baisse dépasse ce qui a été payé, tout le payé est rendu.
    await modifier(c, demande(`figee-${n}-net0-cag01`, [ligne(pizza)]));
    const paye = (await db.query<{ t: number }>("select total_centimes as t from commandes where id = $1", [c])).rows[0].t;
    const rendu = (await db.query<{ r: number }>("select coalesce(sum(montant_centimes), 0)::int as r from remboursements where commande_id = $1", [c])).rows[0].r;
    expect(rendu).toBe(paye);
    expect(await net(c)).toEqual([]);
  });

  it("répartition signée : somme exacte, signes gardés, au prorata", async () => {
    expect(await f<number[]>("repartir_signe(500, array[-2000, 2500])")).toEqual([-2000, 2500]);
    const r = await f<number[]>("repartir_signe(301, array[-2000, 2500])");
    expect(r[0] + r[1]).toBe(301);
    expect(r[0]).toBeLessThan(0);
    expect(r[1]).toBeGreaterThan(0);
    expect(await f<number[]>("repartir_signe(7, array[1, 1, 1])")).toEqual([3, 2, 2]);
    const v = await f<Part[]>("ventilation_ramenee($1, 250)", [JSON.stringify([{ taux: reduit, ttc: -2000 }, { taux: normal, ttc: 2500 }])]);
    expect(v.reduce((t, x) => t + x.ttc, 0)).toBe(250);
  });
});
