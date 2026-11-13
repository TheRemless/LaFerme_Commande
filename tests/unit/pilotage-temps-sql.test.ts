import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";
import type { TempsReels } from "@/lib/pilotage";

// Temps réels contre temps promis (migration 20261212100000_pilotage_temps.sql). Commandes, postes et départs
// écrits directement, aux heures voulues (heure de Genève en hiver = UTC + 1).

let db: PGlite;
let n = 0;

async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}
const t = (hhmm: string) => `2026-12-04T${hhmm}:00+01:00`;

type C = { mode: "livraison" | "retrait"; passee: string; acceptee: string; promise: string; terminee?: string; statut?: string; depart?: string; postes: [string, string, string, string?][] };

async function commande(c: C) {
  n += 1;
  const id = (
    await db.query<{ id: string }>(
      `insert into commandes (numero, jour, jour_service, jeton_suivi, cle_idempotence, mode, statut, statut_paiement, moyen_paiement,
         client_prenom, client_nom, client_telephone, client_email, quand_type, pizzas_seulement,
         sous_total_centimes, frais_centimes, total_centimes, tva_centimes, taux_tva_pourcent, origine,
         cree_le, paye_le, accepte_le, heure_confirmee, termine_le)
       values ($1, '2026-12-04', '2026-12-04', $2, $2, $3, $4, 'paye', 'en_ligne', 'P', 'N', '079', 'c@laferme.test', 'asap', false,
         3000, 0, 3000, 76, 2.6, 'http://localhost:3000', $5::timestamptz, $5::timestamptz, $6::timestamptz, $7::timestamptz, $8::timestamptz)
       returning id`,
      [n, `temps-${n}`, c.mode, c.statut ?? "terminee", t(c.passee), t(c.acceptee), t(c.promise), c.terminee ? t(c.terminee) : null],
    )
  ).rows[0].id;
  for (const [station, afaire, pret, par] of c.postes) {
    await db.query("insert into commande_postes (commande_id, station, a_faire_le, pret_le, pret_par) values ($1, $2, $3::timestamptz, $4::timestamptz, $5)", [
      id, station, t(afaire), t(pret), par ?? "tablette:Léa",
    ]);
  }
  if (c.depart) await db.query("insert into evenements_commande (commande_id, de, vers, par, le) values ($1, 'acceptee', 'partie', 'livreur:Marco', $2::timestamptz)", [id, t(c.depart)]);
}

const temps = (service: string | null = null) => f<TempsReels>("pilotage_temps('2026-12-04', '2026-12-04', $1)", [service]);

beforeEach(async () => {
  db = await creerBaseLocale();
  n = 0;
  // Pas de postes créés par les déclencheurs : les tests écrivent leurs heures eux-mêmes.
  await db.exec("delete from commande_postes where true");
});

describe("temps réels contre temps promis", () => {
  it("acceptation, préparation par poste (heures déduites à part), ponctualité et route", async () => {
    // Livraison à l'heure : acceptée en 2 min, pizza 12 min, partie 19h12, livrée 19h30 pour 19h30.
    await commande({ mode: "livraison", passee: "19:00", acceptee: "19:02", promise: "19:30", depart: "19:12", terminee: "19:30", postes: [["pizza", "19:00", "19:12"]] });
    // Livraison en retard de 15 min : cuisine 30 min (heure déduite), partie 20h00, livrée 20h15 pour 20h00.
    await commande({ mode: "livraison", passee: "19:20", acceptee: "19:24", promise: "20:00", depart: "20:00", terminee: "20:15", postes: [["cuisine", "19:30", "20:00", "statut"]] });
    // Retrait en retard de 5 min : deux postes, le dernier prêt à 20h05 pour 20h00.
    await commande({ mode: "retrait", passee: "19:30", acceptee: "19:31", promise: "20:00", postes: [["pizza", "19:40", "19:50"], ["cuisine", "19:40", "20:05"]] });
    // Livraison pas encore livrée : ne compte pas dans la ponctualité.
    await commande({ mode: "livraison", passee: "19:40", acceptee: "19:41", promise: "20:20", statut: "partie", postes: [["pizza", "19:50", "20:00"]] });

    const r = await temps();
    expect(r.acceptation).toEqual({ commandes: 4, mediane_min: 1.5, p90_min: 3.4 });
    expect(r.postes).toEqual([
      { station: "cuisine", commandes: 2, mediane_min: 27.5, p90_min: 29.5, deduites: 1 },
      { station: "pizza", commandes: 3, mediane_min: 10, p90_min: 11.6, deduites: 0 },
    ]);
    expect(r.ponctualite.livraison).toEqual({ commandes: 2, a_l_heure: 1, en_retard: 1, plus_de_10: 1, retard_median_min: 15, route_mediane_min: 16.5 });
    expect(r.ponctualite.retrait).toMatchObject({ commandes: 1, a_l_heure: 0, en_retard: 1, plus_de_10: 0, retard_median_min: 5 });
    expect(r.heures.map((h) => [h.heure, h.commandes, h.en_retard])).toEqual([
      [19, 1, 0],
      [20, 2, 2],
    ]);
    expect(r.heures[1]).toMatchObject({ pizza_mediane_min: 10, cuisine_mediane_min: 27.5, route_mediane_min: 15 });
  });

  it("refusées hors calcul, un service à la fois, période et service contrôlés, aucun droit pour un visiteur", async () => {
    await commande({ mode: "retrait", passee: "12:00", acceptee: "12:01", promise: "12:30", postes: [["pizza", "12:05", "12:20"]] });
    await commande({ mode: "retrait", passee: "19:00", acceptee: "19:01", promise: "19:30", statut: "refusee", postes: [["pizza", "19:05", "19:20"]] });
    expect((await temps()).postes).toEqual([{ station: "pizza", commandes: 1, mediane_min: 15, p90_min: 15, deduites: 0 }]);
    expect((await temps("soir")).postes).toEqual([]);
    expect((await temps("midi")).ponctualite.retrait?.a_l_heure).toBe(1);
    await expect(f("pilotage_temps('2026-12-05', '2026-12-04')")).rejects.toThrow(/Période invalide/);
    await expect(temps("nuit")).rejects.toThrow(/Service invalide/);
    await expect(
      db.transaction(async (tx) => {
        await tx.exec("set local role anon");
        await tx.query("select pilotage_temps(current_date, current_date)");
      }),
    ).rejects.toThrow(/permission denied/);
  });
});
