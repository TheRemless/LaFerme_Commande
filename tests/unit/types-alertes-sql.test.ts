import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Alertes réglables par type (vague 3, bo-operations) : types_alertes, regler_type_alerte.
// Migration 20261130260000_types_alertes.sql.

let db: PGlite;
let gerant: string;
let service: string;
type Type = { cle: string; libelle: string; aide: string | null; actif: boolean };
const types = async () => (await db.query<{ r: Type[] }>("select types_alertes() as r")).rows[0].r;

beforeAll(async () => {
  db = await creerBaseLocale();
  gerant = (await db.query<{ id: string }>("insert into personnel (email, nom, role) values ('ta-gerant@laferme.test', 'Ta gérant', 'gerant') returning id")).rows[0].id;
  service = (await db.query<{ id: string }>("insert into personnel (email, nom, role) values ('ta-service@laferme.test', 'Ta service', 'service') returning id")).rows[0].id;
}, 120_000);

describe("types d'alertes", () => {
  it("neuf types, tous envoyés au départ, dans l'ordre", async () => {
    const t = await types();
    expect(t.map((x) => x.cle)).toEqual([
      "commande_en_attente",
      "tablette_muette",
      "ticket_non_imprime",
      "remboursement",
      "client_absent",
      "reclamation",
      "quota_courriels",
      "plafond_codes",
      "adresse_bloquee",
    ]);
    expect(t.every((x) => x.actif)).toBe(true);
  });

  it("le gérant coupe et remet un type, journalisé ; clé inconnue : faux ; service : refusé", async () => {
    const r = await db.query<{ ok: boolean }>("select regler_type_alerte('reclamation', false, $1) as ok", [gerant]);
    expect(r.rows[0].ok).toBe(true);
    expect((await types()).find((x) => x.cle === "reclamation")?.actif).toBe(false);
    const j = await db.query<{ cle: string; avant: boolean; apres: boolean }>("select cle, avant, apres from journal_gestion where objet = 'type_alerte' order by id desc limit 1");
    expect(j.rows[0]).toEqual({ cle: "reclamation", avant: true, apres: false });
    await db.query("select regler_type_alerte('reclamation', true, $1)", [gerant]);
    expect((await db.query<{ ok: boolean }>("select regler_type_alerte('inconnue', false, $1) as ok", [gerant])).rows[0].ok).toBe(false);
    await expect(db.query("select regler_type_alerte('reclamation', false, $1)", [service])).rejects.toThrow();
  });

  it("réservées au serveur", async () => {
    for (const role of ["anon", "authenticated"]) {
      const r = await db.query<{ a: boolean; b: boolean }>(
        "select has_function_privilege($1, 'types_alertes()', 'execute') as a, has_function_privilege($1, 'regler_type_alerte(text, boolean, uuid)', 'execute') as b",
        [role],
      );
      expect(r.rows[0]).toEqual({ a: false, b: false });
    }
  });
});
