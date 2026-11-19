import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";
import { libelleTaux, repartirCentimes, ventilerTva, type ReglesTva } from "@/lib/tva";

// TVA par plat et par ligne (supabase/migrations/20261217150000_tva_par_plat.sql ; docs/compta/tva-et-cagnotte.md,
// règles R1, R3, R5, R9, R13, R15). Aucun taux en dur ici non plus : ils sont lus dans taux_tva.

let db: PGlite;
let gerant: string;
let normal: number;
let reduit: number;
type Part = { taux: number; ttc: number; tva: number; frais_ttc: number; frais_tva: number; rabais_ttc: number; rabais_tva: number; cagnotte_ttc: number; cagnotte_tva: number };

async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}
// Requête entière dont la première colonne s'appelle r.
async function q<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(sql, v)).rows[0].r;
}
const regler = (cle: string, valeur: string) => db.query("update reglages set valeur = to_jsonb($2::text) where cle = $1", [cle, valeur]);
const tva = (ttc: number, t: number) => Math.round((ttc * t) / (100 + t));

// Une bière à 5 % vol. pour l'essai : hors de la vente, comme toute boisson alcoolisée tant que Jérémy n'a pas décidé.
async function biere(teneur: number): Promise<string> {
  const slug = `biere-essai-${String(teneur).replace(".", "-")}`;
  await db.query(
    "insert into plats (slug, categorie_id, nom, prix_centimes, station, commandable) select $1, id, $1, 500, 'comptoir', false from categories where slug = 'boissons' on conflict (slug) do nothing",
    [slug],
  );
  await f("regler_teneur_alcool($1, $2, $3)", [slug, teneur, gerant]);
  return slug;
}

let n = 0;
type Ligne = { slug: string; total: number };
async function commande(lignes: Ligne[], o: { frais?: number; quand?: string } = {}): Promise<string> {
  n += 1;
  const sous = lignes.reduce((s, l) => s + l.total, 0);
  const frais = o.frais ?? 0;
  return (
    await db.query<{ id: string }>("select id from creer_commande($1)", [
      {
        jeton_suivi: `j-tva-${n}`,
        cle_idempotence: `tva-${n}`,
        mode: frais ? "livraison" : "retrait",
        statut: "acceptee",
        statut_paiement: "paye",
        moyen_paiement: "en_ligne",
        client_prenom: "T",
        client_nom: "V",
        client_telephone: "079",
        client_email: "tva@laferme.test",
        quand_type: o.quand ? "creneau" : "asap",
        quand_date: o.quand,
        quand_minutes: o.quand ? 19 * 60 : undefined,
        pizzas_seulement: false,
        sous_total_centimes: sous,
        frais_centimes: frais,
        total_centimes: sous + frais,
        // Valeurs fausses exprès : la base recalcule, l'appelant ne fixe ni la TVA ni le taux.
        tva_centimes: 1,
        taux_tva_pourcent: 0,
        origine: "http://localhost",
        lignes: lignes.map((l) => ({
          slug: l.slug,
          nom: l.slug,
          station: "cuisine",
          qte: 1,
          unitaire_centimes: l.total,
          total_centimes: l.total,
          choix: {},
          retraits: [],
          note: "",
          taux_tva_pourcent: 0,
        })),
      },
    ])
  ).rows[0].id;
}
const ventilation = (id: string) => q<Part[]>("select ventilation_commande(c) as r from commandes c where c.id = $1", [id]).then((v) => v.map((p) => ({ ...p, taux: Number(p.taux) })));
const commandeLue = (id: string) => db.query<{ total_centimes: number; tva_centimes: number; taux: number }>("select total_centimes, tva_centimes, taux_tva_pourcent::float as taux from commandes where id = $1", [id]).then((r) => r.rows[0]);
async function sommesJustes(id: string) {
  const v = await ventilation(id);
  const c = await commandeLue(id);
  expect(v.reduce((s, p) => s + p.ttc, 0)).toBe(c.total_centimes);
  expect(v.reduce((s, p) => s + p.tva, 0)).toBe(c.tva_centimes);
  for (const p of v) {
    // Contrat de bo-pilotage : TVA de chaque montant arrondie à son taux, et jamais plus de rabais que de lignes.
    expect([p.rabais_tva, p.cagnotte_tva, p.frais_tva]).toEqual([tva(p.rabais_ttc, p.taux), tva(p.cagnotte_ttc, p.taux), tva(p.frais_ttc, p.taux)]);
    expect(p.ttc - p.frais_ttc + p.rabais_ttc + p.cagnotte_ttc).toBeGreaterThanOrEqual(0);
  }
  return v;
}

beforeAll(async () => {
  db = await creerBaseLocale();
  gerant = (await db.query<{ id: string }>("select id from personnel where email = 'equipe@laferme.test'")).rows[0].id;
  normal = Number(await f<string>("taux_tva_du('normal', current_date)"));
  reduit = Number(await f<string>("taux_tva_du('reduit', current_date)"));
}, 120_000);

beforeEach(async () => {
  await regler("frais_tva_mixte", "normal");
  await regler("rabais_tva_mixte", "reduit_dabord");
});

describe("taux datés (R5)", () => {
  it("deux taux en vigueur, lus dans la table ; aucune date sans taux", async () => {
    expect((await db.query<{ categorie: string }>("select categorie from taux_tva_en_vigueur order by categorie")).rows.map((r) => r.categorie)).toEqual(["normal", "reduit"]);
    expect(normal).toBeGreaterThan(reduit);
    await expect(f("taux_tva_du('normal', date '2020-01-01')")).rejects.toThrow(/taux_tva_manquant/);
    expect(Number(await q<string>("select valeur #>> '{}' as r from reglages where cle = 'tva_emporter_pourcent'"))).toBe(reduit);
  });

  it("un changement de taux s'applique au jour de service de la commande", async () => {
    await db.exec(`
      update taux_tva set valable_au = date '2027-12-31' where categorie = 'normal' and valable_au is null;
      insert into taux_tva (categorie, pourcent, valable_du) values ('normal', 8.5, date '2028-01-01');
    `);
    const b = await biere(5);
    const avant = await commande([{ slug: b, total: 500 }]);
    const apres = await commande([{ slug: b, total: 500 }], { quand: "2028-01-05" });
    const taux = async (id: string) => Number(await q<string>("select taux_tva_pourcent as r from commande_lignes where commande_id = $1", [id]));
    expect(await taux(avant)).toBe(normal);
    expect(await taux(apres)).toBe(8.5);
    await db.exec(`
      delete from taux_tva where categorie = 'normal' and valable_du = date '2028-01-01';
      update taux_tva set valable_au = null where categorie = 'normal' and valable_au = date '2027-12-31';
    `);
  });
});

describe("taux d'un plat, calculé d'après la teneur en alcool (R1, R3)", () => {
  it("la compta à deux taux est déclarée prête (20261217220000, après la #276 de bo-pilotage)", async () => {
    expect(await q<boolean>("select alcool_compta_prete() as r")).toBe(true);
  });

  it("garde-fou : une boisson alcoolisée ne se met pas en vente tant que la compta à deux taux n'est pas prête", async () => {
    // Prête depuis 20261217220000 : le garde-fou se vérifie réglage coupé.
    await db.query("update reglages set valeur = 'false' where cle = 'compta_multi_taux_pret'");
    // Coca-Cola est en vente : 0,6 % vol. est refusé, rien n'est écrit.
    await expect(f("regler_teneur_alcool('coca-cola', 0.6, $1)", [gerant])).rejects.toThrow(/alcool_compta_pas_prete/);
    // Le jeu de test donne 0 % vol. aux boissons en vente (20261217220000) : rien n'a changé.
    expect(Number(await q<string | null>("select teneur_alcool as r from plats where slug = 'coca-cola'"))).toBe(0);
    // Hors vente, la teneur se pose ; la remettre en vente est refusé, et la fiche dit pourquoi.
    const b = await biere(5);
    await expect(db.query("update plats set commandable = true where slug = $1", [b])).rejects.toThrow(/alcool_compta_pas_prete/);
    expect(await q<string[]>("select motifs_plat(id) as r from plats where slug = $1", [b])).toContain("boisson alcoolisée : la compta à deux taux n'est pas prête");
    // bo-pilotage passe le réglage à vrai quand ses lecteurs suivent la ventilation.
    await db.query("update reglages set valeur = 'true' where cle = 'compta_multi_taux_pret'");
    await db.query("update plats set commandable = true where slug = $1", [b]);
    expect(await q<string[]>("select motifs_plat(id) as r from plats where slug = $1", [b])).not.toContain("boisson alcoolisée : la compta à deux taux n'est pas prête");
    await db.query("update plats set commandable = false where slug = $1", [b]);
  });

  it("0,5 % vol. donne le réduit, 0,6 % le normal ; le back-office le montre et le journal le garde", async () => {
    await db.query("update reglages set valeur = 'true' where cle = 'compta_multi_taux_pret'");
    expect(Number((await f<{ taux_tva_pourcent: number }>("regler_teneur_alcool('coca-cola', 0.5, $1)", [gerant])).taux_tva_pourcent)).toBe(reduit);
    expect(Number((await f<{ taux_tva_pourcent: number }>("regler_teneur_alcool('coca-cola', 0.6, $1)", [gerant])).taux_tva_pourcent)).toBe(normal);
    const fiche = (await f<{ categories: { slug: string; plats: { slug: string; teneur_alcool: number; taux_tva_pourcent: number }[] }[] }>("gestion_carte()")).categories
      .find((c) => c.slug === "boissons")!
      .plats.find((p) => p.slug === "coca-cola")!;
    expect([Number(fiche.teneur_alcool), Number(fiche.taux_tva_pourcent)]).toEqual([0.6, normal]);
    const j = (await db.query<{ apres: { teneur_alcool: number } }>("select apres from journal_gestion where objet = 'teneur_alcool' order by id desc limit 1")).rows[0];
    expect(Number(j.apres.teneur_alcool)).toBe(0.6);
    await f("regler_teneur_alcool('coca-cola', 0, $1)", [gerant]);
    expect(Number(await q<string>("select taux_tva_pourcent as r from tva_plats_publics where slug = 'coca-cola'"))).toBe(reduit);
  });

  it("une teneur impossible est refusée ; seuls le gérant et le serveur la règlent", async () => {
    await expect(f("regler_teneur_alcool('coca-cola', 101, $1)", [gerant])).rejects.toThrow(/teneur_invalide/);
    // Une denrée qui contient de l'alcool reste au réduit : seule une boisson porte une teneur.
    await expect(f("regler_teneur_alcool('pizza-margherita', 5, $1)", [gerant])).rejects.toThrow(/pas_une_boisson/);
    const livreur = (await db.query<{ id: string }>("select id from personnel where role = 'livreur' and actif limit 1")).rows[0].id;
    await expect(f("regler_teneur_alcool('coca-cola', 5, $1)", [livreur])).rejects.toThrow();
    for (const role of ["anon", "authenticated"]) {
      expect(await f<boolean>(`has_function_privilege('${role}', 'regler_teneur_alcool(text, numeric, uuid)', 'execute')`)).toBe(false);
      expect(await f<boolean>(`has_function_privilege('${role}', 'ventilation_commande(commandes)', 'execute')`)).toBe(false);
    }
  });
});

describe("commande mixte : pizza et bière à 5 % vol. (R1, R9, R15)", () => {
  it("chaque ligne porte son taux, figé ; ce que l'appelant envoie est ignoré", async () => {
    const id = await commande([{ slug: "pizza-margherita", total: 1800 }, { slug: await biere(5), total: 500 }]);
    const lignes = (await db.query<{ plat_slug: string; taux: number; tva_centimes: number }>("select plat_slug, taux_tva_pourcent::float as taux, tva_centimes from commande_lignes where commande_id = $1 order by position", [id])).rows;
    expect(lignes.map((l) => l.taux)).toEqual([reduit, normal]);
    expect(lignes.map((l) => l.tva_centimes)).toEqual([tva(1800, reduit), tva(500, normal)]);
    const c = await commandeLue(id);
    expect(c.taux).toBe(normal);
    expect(c.tva_centimes).toBe(tva(1800, reduit) + tva(500, normal));
    await sommesJustes(id);
  });

  it("le taux d'une ligne reste figé quand son montant change, même si la boisson change de teneur", async () => {
    const b = await biere(5);
    const id = await commande([{ slug: "pizza-margherita", total: 1500 }, { slug: b, total: 500 }]);
    await f("regler_teneur_alcool($1, 0, $2)", [b, gerant]);
    await db.query("update commande_lignes set total_centimes = 400, unitaire_centimes = 400 where commande_id = $1 and plat_slug = $2", [id, b]);
    const l = (await db.query<{ taux: number; tva_centimes: number }>("select taux_tva_pourcent::float as taux, tva_centimes from commande_lignes where commande_id = $1 and plat_slug = $2", [id, b])).rows[0];
    expect(l).toEqual({ taux: normal, tva_centimes: tva(400, normal) });
    await f("regler_teneur_alcool($1, 5, $2)", [b, gerant]);
  });

  it("plat offert à 0 CHF : la commande n'est pas mixte, les frais restent au réduit (relecture de #275)", async () => {
    // Pizza payée, bière offerte (0 CHF), livraison : rien n'est vendu au taux normal.
    const id = await commande([{ slug: "pizza-margherita", total: 1500 }, { slug: await biere(5), total: 0 }], { frais: 500 });
    const v = await sommesJustes(id);
    expect(v).toEqual([{ taux: reduit, ttc: 2000, tva: tva(2000, reduit), frais_ttc: 500, frais_tva: tva(500, reduit), rabais_ttc: 0, rabais_tva: 0, cagnotte_ttc: 0, cagnotte_tva: 0 }]);
    expect((await commandeLue(id)).taux).toBe(reduit);
    // Même règle au panier.
    expect(ventilerTva({ lignes: [{ taux: reduit, ttc: 1500 }, { taux: normal, ttc: 0 }], frais: 500, remisePlats: 0, remiseFrais: 0, cagnotte: 0, regles: { frais: "normal", rabais: "reduit_dabord" } })).toEqual(v);
  });

  it("une commande à un seul taux garde exactement la TVA d'avant", async () => {
    const id = await commande([{ slug: "pizza-margherita", total: 1800 }, { slug: "coca-cola", total: 450 }], { frais: 500 });
    const c = await commandeLue(id);
    expect(c.taux).toBe(reduit);
    expect(c.tva_centimes).toBe(tva(2750, reduit));
    expect(await sommesJustes(id)).toEqual([{ taux: reduit, ttc: 2750, tva: tva(2750, reduit), frais_ttc: 500, frais_tva: tva(500, reduit), rabais_ttc: 0, rabais_tva: 0, cagnotte_ttc: 0, cagnotte_tva: 0 }]);
  });

  it("frais d'une commande mixte : jamais tous au réduit ; « normal » ou « prorata » selon le réglage", async () => {
    const b = await biere(5);
    const id = await commande([{ slug: "pizza-margherita", total: 1500 }, { slug: b, total: 500 }], { frais: 500 });
    let v = await sommesJustes(id);
    expect(v.map((p) => [p.taux, p.frais_ttc])).toEqual([[reduit, 0], [normal, 500]]);

    await regler("frais_tva_mixte", "prorata");
    await db.query("update commandes set tva_centimes = 0 where id = $1", [id]);
    v = await sommesJustes(id);
    expect(v.map((p) => [p.taux, p.frais_ttc])).toEqual([[reduit, 375], [normal, 125]]);
    // Le seul choix risqué (2,6 % sur la totalité des frais) n'existe dans aucun réglage.
    for (const regle of ["normal", "prorata"]) {
      await regler("frais_tva_mixte", regle);
      expect((await ventilation(id)).find((p) => p.taux === reduit)!.frais_ttc).toBeLessThan(500);
    }
    // Valeur illisible : l'option prudente.
    await regler("frais_tva_mixte", "n'importe quoi");
    expect((await ventilation(id)).find((p) => p.taux === normal)!.frais_ttc).toBe(500);
  });

  it("rabais en francs : d'abord au réduit par défaut, au prorata sur réglage, toujours au centime", async () => {
    const id = await commande([{ slug: "pizza-margherita", total: 1500 }, { slug: await biere(5), total: 500 }]);
    await db.query("update commandes set remise_centimes = 600, total_centimes = total_centimes - 600 where id = $1", [id]);
    let v = await sommesJustes(id);
    expect(v.map((p) => [p.taux, p.rabais_ttc, p.ttc])).toEqual([[reduit, 600, 900], [normal, 0, 500]]);

    await regler("rabais_tva_mixte", "prorata");
    await db.query("update commandes set tva_centimes = 0 where id = $1", [id]);
    v = await sommesJustes(id);
    expect(v.map((p) => [p.taux, p.rabais_ttc])).toEqual([[reduit, 450], [normal, 150]]);
    expect(v.reduce((s, p) => s + p.rabais_ttc, 0)).toBe(600);
  });

  it("un rabais plus grand que les lignes au réduit déborde sur le normal ; la cagnotte suit la même règle", async () => {
    const id = await commande([{ slug: "pizza-margherita", total: 1500 }, { slug: await biere(5), total: 500 }]);
    await db.query("update commandes set remise_centimes = 1000, cagnotte_centimes = 700, total_centimes = total_centimes - 1700 where id = $1", [id]);
    const v = await sommesJustes(id);
    expect(v.map((p) => [p.taux, p.rabais_ttc, p.cagnotte_ttc, p.ttc])).toEqual([
      [reduit, 1000, 500, 0],
      [normal, 0, 200, 300],
    ]);
  });

  it("l'export Crésus étendu (bo-pilotage) sort une ligne par taux pour une commande mixte", async () => {
    await db.exec("truncate commandes cascade");
    const id = await commande([{ slug: "pizza-margherita", total: 1500 }, { slug: await biere(5), total: 500 }], { frais: 500 });
    const jour = await q<string>("select jour::text as r from commandes where id = $1", [id]);
    const e = await q<{ ventes: { taux: number; ttc: number; tva: number }[] }>("select export_cresus_etendu($1::date, $1::date) as r", [jour]);
    expect(e.ventes.map((v) => [Number(v.taux), v.ttc])).toEqual([
      [reduit, 1500],
      [normal, 1000],
    ]);
    expect(e.ventes.reduce((x, v) => x + v.tva, 0)).toBe((await commandeLue(id)).tva_centimes);
  });

  it("remboursement : par ligne quand le manque les donne, sinon selon la règle des rabais", async () => {
    const id = await commande([{ slug: "pizza-margherita", total: 1500 }, { slug: await biere(5), total: 500 }]);
    const rembourser = async (montant: number, lignes: Record<string, number> | null) =>
      (await db.query<{ v: { taux: number; ttc: number; tva: number }[] }>(
        "insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, personnel_nom, montants_lignes) values ($1, gen_random_uuid()::text, $2, 'essai', 'stripe', 'en_cours', 'essai', $3) returning ventilation_remboursement(remboursements) as v",
        [id, montant, lignes ? JSON.stringify(lignes) : null],
      )).rows[0].v.map((p) => ({ ...p, taux: Number(p.taux) }));
    expect(await rembourser(500, { "1": 500 })).toEqual([{ taux: normal, ttc: 500, tva: tva(500, normal) }]);
    expect(await rembourser(800, null)).toEqual([{ taux: reduit, ttc: 800, tva: tva(800, reduit) }]);
    await regler("rabais_tva_mixte", "prorata");
    const p = await rembourser(800, null);
    expect(p.map((x) => [x.taux, x.ttc])).toEqual([[reduit, 600], [normal, 200]]);
  });
});

describe("ventilation_lignes et ventilation_commande", () => {
  it("ventilation_commande rend ventilation_lignes tant que bo-commandes ne la fige pas au paiement", async () => {
    const id = await commande([{ slug: "pizza-margherita", total: 1500 }, { slug: await biere(5), total: 500 }], { frais: 300 });
    const deux = await q<{ a: unknown; b: unknown }>("select jsonb_build_object('a', ventilation_lignes(c), 'b', ventilation_commande(c)) as r from commandes c where c.id = $1", [id]);
    expect(deux.a).toEqual(deux.b);
  });
});

describe("le calcul du panier suit la base au centime", () => {
  const cas: { nom: string; lignes: number[][]; frais: number; remise: number; cagnotte: number }[] = [
    { nom: "un seul taux, frais", lignes: [[0, 1800], [0, 450]], frais: 500, remise: 0, cagnotte: 0 },
    { nom: "mixte, frais", lignes: [[0, 1500], [1, 500]], frais: 500, remise: 0, cagnotte: 0 },
    { nom: "mixte, rabais et cagnotte", lignes: [[0, 1500], [1, 500]], frais: 333, remise: 600, cagnotte: 250 },
    { nom: "mixte, rabais qui déborde", lignes: [[0, 700], [1, 1300]], frais: 0, remise: 1000, cagnotte: 701 },
    { nom: "mixte, centimes à répartir", lignes: [[0, 333], [1, 334], [0, 333]], frais: 101, remise: 77, cagnotte: 13 },
  ];
  for (const regles of [
    { frais: "normal", rabais: "reduit_dabord" },
    { frais: "prorata", rabais: "prorata" },
  ] as ReglesTva[]) {
    for (const k of cas) {
      it(`${k.nom} (${regles.frais}, ${regles.rabais})`, async () => {
        await regler("frais_tva_mixte", regles.frais);
        await regler("rabais_tva_mixte", regles.rabais);
        const b = await biere(5);
        const slugs = ["pizza-margherita", b];
        const id = await commande(k.lignes.map(([i, t]) => ({ slug: slugs[i], total: t })), { frais: k.frais });
        await db.query("update commandes set remise_centimes = $2, cagnotte_centimes = $3, total_centimes = total_centimes - $2 - $3 where id = $1", [id, k.remise, k.cagnotte]);
        const enBase = await sommesJustes(id);
        const taux = [reduit, normal];
        const panier = ventilerTva({
          lignes: k.lignes.map(([i, t]) => ({ taux: taux[i], ttc: t })),
          frais: k.frais,
          remisePlats: Math.min(k.remise, k.lignes.reduce((x, [, t]) => x + t, 0)),
          remiseFrais: Math.max(k.remise - k.lignes.reduce((x, [, t]) => x + t, 0), 0),
          cagnotte: k.cagnotte,
          regles,
        });
        expect(panier).toEqual(enBase);
      });
    }
  }

  it("répartition au centime et libellé des taux", () => {
    expect(repartirCentimes(100, [1, 1, 1])).toEqual([33, 33, 34]);
    expect(repartirCentimes(5, [0, 0])).toEqual([0, 5]);
    expect(libelleTaux([reduit])).toBe(`${String(reduit).replace(".", ",")} %`);
    expect(libelleTaux([normal, reduit, reduit])).toBe(`${String(reduit).replace(".", ",")} % et ${String(normal).replace(".", ",")} %`);
  });
});
