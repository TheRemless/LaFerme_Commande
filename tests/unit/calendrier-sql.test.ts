import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Commandes déjà prises par jour et par service, sans donnée de client : migration 20261130140000_calendrier.sql.

let db: PGlite;
let n = 0;
async function commande(o: { mode: string; quand?: { date: string; minutes: number }; cree?: string; statut?: string }) {
  n += 1;
  const p = {
    jeton_suivi: `jeton-cal-${n}`,
    cle_idempotence: `cal-${n}`,
    mode: o.mode,
    statut: "nouvelle",
    statut_paiement: "paye",
    moyen_paiement: "en_ligne",
    zone_numero: o.mode === "livraison" ? 1 : null,
    client_prenom: `Cal${n}`,
    client_nom: "Test",
    client_telephone: "079 000 00 00",
    client_email: "cal@laferme.test",
    quand_type: o.quand ? "creneau" : "asap",
    quand_date: o.quand?.date,
    quand_minutes: o.quand?.minutes,
    pizzas_seulement: true,
    sous_total_centimes: 3000,
    frais_centimes: 0,
    total_centimes: 3000,
    tva_centimes: 76,
    taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    lignes: [{ slug: "pizza-margherita", nom: "Pizza", station: "pizza", qte: 1, unitaire_centimes: 1500, total_centimes: 1500, choix: {}, retraits: [], note: "" }],
  };
  const id = (await db.query<{ id: string }>("select id from creer_commande($1)", [p])).rows[0].id;
  await db.query("update commandes set statut = $2, cree_le = coalesce($3::timestamptz, cree_le) where id = $1", [id, o.statut ?? "acceptee", o.cree ?? null]);
}

beforeAll(async () => {
  db = await creerBaseLocale();
  await db.exec("truncate commandes cascade");
});

describe("reservations_par_jour", () => {
  it("compte par jour, service et mode ; ignore refusées, annulées et paiements en attente", async () => {
    await commande({ mode: "livraison", quand: { date: "2026-12-04", minutes: 19 * 60 } });
    await commande({ mode: "livraison", quand: { date: "2026-12-04", minutes: 20 * 60 } });
    await commande({ mode: "retrait", quand: { date: "2026-12-04", minutes: 12 * 60 } });
    await commande({ mode: "retrait", quand: { date: "2026-12-04", minutes: 12 * 60 }, statut: "refusee" });
    await commande({ mode: "retrait", quand: { date: "2026-12-04", minutes: 12 * 60 }, statut: "paiement_en_attente" });
    // « Dès que possible » le 5 à 19h30 de Genève.
    await commande({ mode: "retrait", cree: "2026-12-05T18:30:00Z" });
    const r = await db.query<{ r: unknown }>("select reservations_par_jour('2026-12-01', '2026-12-31') as r");
    expect(r.rows[0].r).toEqual([
      { jour: "2026-12-04", service: "midi", livraisons: 0, retraits: 1 },
      { jour: "2026-12-04", service: "soir", livraisons: 2, retraits: 0 },
      { jour: "2026-12-05", service: "soir", livraisons: 0, retraits: 1 },
    ]);
    expect(JSON.stringify(r.rows[0].r)).not.toMatch(/Cal\d|cal@|079/);
  });

  it("fermée aux visiteurs", async () => {
    const r = await db.query<{ ok: boolean }>(
      "select has_function_privilege('anon', 'reservations_par_jour(date, date)', 'execute') or has_function_privilege('authenticated', 'reservations_par_jour(date, date)', 'execute') as ok",
    );
    expect(r.rows[0].ok).toBe(false);
  });
});
