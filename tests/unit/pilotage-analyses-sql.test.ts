import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";
import type { Analyses } from "@/lib/pilotage";

// Analyses d'une période (migration 20261129110000_pilotage_analyses.sql).

let db: PGlite;
let n = 0;

async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}

type Ligne = { slug: string; nom: string; qte: number; total: number };
type Commande = { jour: string; heure?: string; email?: string; mode?: string; zone?: number | null; statut?: string; frais?: number; lignes: Ligne[]; cree?: string };

async function commande(c: Commande) {
  n += 1;
  const total = c.lignes.reduce((s, l) => s + l.total, 0) + (c.frais ?? 0);
  const id = (
    await db.query<{ id: string }>(
      `insert into commandes (numero, jour, jour_service, jeton_suivi, cle_idempotence, mode, statut, statut_paiement, moyen_paiement,
         client_prenom, client_nom, client_telephone, client_email, quand_type, pizzas_seulement, zone_numero,
         sous_total_centimes, frais_centimes, total_centimes, tva_centimes, taux_tva_pourcent, origine, cree_le)
       values ($1, $2, $2, $3, $3, $4, $5, 'paye', 'en_ligne', 'P', 'N', '079', $6, 'asap', false, $7,
         $8::integer - $9::integer, $9::integer, $8::integer, 0, 2.6, 'http://localhost:3000',
         coalesce($11::timestamptz, ($2::date + $10::time) at time zone 'Europe/Zurich'))
       returning id`,
      [n, c.jour, `analyses-${n}`, c.mode ?? "retrait", c.statut ?? "terminee", c.email ?? `c${n}@laferme.test`, c.zone ?? null, total, c.frais ?? 0, c.heure ?? "19:00", c.cree ?? null],
    )
  ).rows[0].id;
  for (const [i, l] of c.lignes.entries()) {
    await db.query(
      `insert into commande_lignes (commande_id, position, plat_slug, nom, station, qte, unitaire_centimes, total_centimes)
       values ($1, $2, $3, $4, 'pizza', $5, $6, $7)`,
      [id, i, l.slug, l.nom, l.qte, Math.round(l.total / l.qte), l.total],
    );
  }
}

const marg = (qte = 1): Ligne => ({ slug: "pizza-margherita", nom: "Pizza Margherita", qte, total: 2100 * qte });
const lasagne: Ligne = { slug: "lasagne-de-boeuf", nom: "Lasagne de bœuf", qte: 1, total: 1800 };
const analyses = (debut: string, fin: string, service: string | null = null) =>
  f<Analyses>("pilotage_analyses($1::date, $2::date, $3)", [debut, fin, service]);

beforeEach(async () => {
  db = await creerBaseLocale();
  n = 0;
});

describe("ventes par plat et par catégorie", () => {
  it("additionne quantités et montants, garde le nom de la carte, sans les commandes refusées", async () => {
    await commande({ jour: "2026-12-03", lignes: [{ ...marg(), nom: "pizza margherita" }] });
    await commande({ jour: "2026-12-04", lignes: [marg(2), lasagne] });
    await commande({ jour: "2026-12-04", lignes: [marg(5)], statut: "refusee" });
    await commande({ jour: "2026-12-04", lignes: [{ slug: "ancien-plat", nom: "Ancien plat", qte: 1, total: 900 }] });
    const a = await analyses("2026-12-03", "2026-12-04");
    expect(a.plats[0]).toEqual({ slug: "pizza-margherita", nom: "Pizza Margherita", categorie: expect.any(String), qte: 3, ttc_centimes: 6300 });
    expect(a.plats.find((p) => p.slug === "ancien-plat")?.categorie).toBe("Hors carte");
    expect(a.ventes_plats_centimes).toBe(9000);
    expect(a.categories.reduce((s, c) => s + c.ttc_centimes, 0)).toBe(9000);
  });
});

describe("heures, jours, zones", () => {
  it("place chaque commande à son jour de la semaine et son heure, avec le nombre de jours de la période", async () => {
    await commande({ jour: "2026-12-04", heure: "19:10", lignes: [marg()] }); // vendredi
    await commande({ jour: "2026-12-04", heure: "19:50", lignes: [marg()] });
    await commande({ jour: "2026-12-05", heure: "12:15", lignes: [lasagne] }); // samedi midi
    const a = await analyses("2026-11-30", "2026-12-13");
    expect(a.heures).toEqual([
      { jour: 5, heure: 19, commandes: 2, ttc_centimes: 4200, jours: 2 },
      { jour: 6, heure: 12, commandes: 1, ttc_centimes: 1800, jours: 2 },
    ]);
    expect(a.jours_semaine).toMatchObject({ "1": 2, "7": 2 });
    expect((await analyses("2026-11-30", "2026-12-13", "midi")).heures).toHaveLength(1);
  });

  it("par zone de livraison : commandes, montant, frais, panier moyen", async () => {
    await commande({ jour: "2026-12-04", mode: "livraison", zone: 1, frais: 490, lignes: [marg()] });
    await commande({ jour: "2026-12-04", mode: "livraison", zone: 1, frais: 490, lignes: [marg(2)] });
    await commande({ jour: "2026-12-04", mode: "livraison", zone: 2, frais: 690, lignes: [lasagne] });
    await commande({ jour: "2026-12-04", lignes: [lasagne] });
    const zones = (await analyses("2026-12-04", "2026-12-04")).zones;
    expect(zones.map((z) => [z.zone, z.commandes, z.ttc_centimes, z.frais_centimes, z.panier_moyen_centimes])).toEqual([
      [1, 2, 7280, 980, 3640],
      [2, 1, 2490, 690, 2490],
    ]);
    expect(zones[0].nom).toEqual(expect.any(String));
  });
});

describe("nouveaux clients et fidèles", () => {
  it("nouveau : aucune commande prise avant la période ; l'e-mail se compare sans majuscules ; rien de personnel ne sort", async () => {
    await commande({ jour: "2026-11-20", email: "Ana@Exemple.ch", lignes: [marg()], cree: "2026-11-20T18:00:00Z" });
    await commande({ jour: "2026-11-21", email: "refus@exemple.ch", statut: "refusee", lignes: [marg()], cree: "2026-11-21T18:00:00Z" });
    await commande({ jour: "2026-12-04", email: "ana@exemple.ch", lignes: [marg()] });
    await commande({ jour: "2026-12-04", email: "refus@exemple.ch", lignes: [lasagne] });
    await commande({ jour: "2026-12-04", email: "neuf@exemple.ch", lignes: [marg()] });
    // Passée le 30.11 pour le 5.12 : pas une commande d'avant la période.
    await commande({ jour: "2026-12-05", email: "neuf@exemple.ch", lignes: [lasagne], cree: "2026-11-30T18:00:00Z" });
    const a = await analyses("2026-12-01", "2026-12-07");
    expect(a.clients).toEqual({
      clients: 3,
      nouveaux: 2,
      nouveaux_commandes: 3,
      nouveaux_ttc_centimes: 5700,
      fideles: 1,
      fideles_commandes: 1,
      fideles_ttc_centimes: 2100,
      revenus_dans_la_periode: 1,
    });
    expect(JSON.stringify(a)).not.toMatch(/exemple\.ch/i);
  });
});

describe("contrôles", () => {
  it("refuse une période invalide ou un service inconnu, aucun droit pour un visiteur", async () => {
    await expect(analyses("2026-12-05", "2026-12-04")).rejects.toThrow(/Période invalide/);
    await expect(analyses("2026-12-04", "2026-12-04", "nuit")).rejects.toThrow(/Service invalide/);
    await expect(
      db.transaction(async (tx) => {
        await tx.exec("set local role anon");
        await tx.query("select pilotage_analyses(current_date, current_date)");
      }),
    ).rejects.toThrow(/permission denied/);
  });
});
