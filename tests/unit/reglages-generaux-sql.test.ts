import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Réglages généraux, côté base : migration 20261130130000_reglages_generaux.sql.

let db: PGlite;
const ids: Record<string, string> = {};
async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}
// Valeur passée telle que le serveur l'envoie : du texte, ou null.
const regler = (cle: string, valeur: unknown, qui = ids.gerant) => f<unknown>("regler_reglage_general($1, $2, $3)", [cle, valeur === null ? null : String(valeur), qui]);
const generaux = () => f<Record<string, unknown>>("reglages_generaux()");

beforeAll(async () => {
  db = await creerBaseLocale();
  for (const [cle, role] of [["gerant", "gerant"], ["service", "service"]] as const) {
    const r = await db.query<{ id: string }>("insert into personnel (email, nom, role) values ($1, $2, $3) returning id", [`rg-${cle}@laferme.test`, `Rg ${cle}`, role]);
    ids[cle] = r.rows[0].id;
  }
});

describe("réglages généraux", () => {
  it("valeurs de départ : celles du site, e-mail vide (la variable ALERTE_EMAIL sert)", async () => {
    expect(await generaux()).toEqual({ plafond_codes_clients_jour: 150, creneau_minutes: 15, avance_jours: 7, alerte_email: null, annulation_client_active: false, plats_populaires_actifs: false, suggestion_panier_active: false });
  });

  it("le gérant règle chaque valeur dans ses bornes, journalisé", async () => {
    expect(await regler("plafond_codes_clients_jour", 200)).toBe(200);
    expect(await regler("creneau_minutes", 30)).toBe(30);
    expect(await regler("avance_jours", 0)).toBe(0);
    expect(await generaux()).toMatchObject({ plafond_codes_clients_jour: 200, creneau_minutes: 30, avance_jours: 0 });
    // Le plafond des codes lu par demander_code suit.
    expect(await f<number>("plafond_codes_clients()")).toBe(200);
    const j = await db.query<{ cle: string; avant: unknown; apres: unknown }>("select cle, avant, apres from journal_gestion where objet = 'reglage' order by id desc limit 1");
    expect(j.rows[0]).toEqual({ cle: "avance_jours", avant: 7, apres: 0 });
    await regler("creneau_minutes", 15);
    await regler("avance_jours", 7);
    await regler("plafond_codes_clients_jour", 150);
  });

  it("refuse hors bornes, une valeur non entière, une clé inconnue, un non-gérant", async () => {
    await expect(regler("plafond_codes_clients_jour", 451)).rejects.toThrow(/hors limites/);
    await expect(regler("plafond_codes_clients_jour", 19)).rejects.toThrow(/hors limites/);
    await expect(regler("creneau_minutes", 25)).rejects.toThrow(/hors limites/);
    await expect(regler("avance_jours", 1.5)).rejects.toThrow(/nombre entier/);
    await expect(regler("avance_jours", "-1")).rejects.toThrow(/nombre entier/);
    await expect(regler("avance_jours", "7; drop table reglages")).rejects.toThrow(/nombre entier/);
    await expect(regler("preparation_minutes", 30)).rejects.toThrow(/inconnu/);
    await expect(regler("avance_jours", 3, ids.service)).rejects.toThrow(/gérant/);
    expect((await generaux()).avance_jours).toBe(7);
  });

  it("annulation par le client : oui ou non, faux au départ", async () => {
    expect(await regler("annulation_client_active", true)).toBe(true);
    expect((await generaux()).annulation_client_active).toBe(true);
    await expect(regler("annulation_client_active", "oui")).rejects.toThrow(/Oui ou non/);
    await expect(regler("annulation_client_active", false, ids.service)).rejects.toThrow(/gérant/);
    expect(await regler("annulation_client_active", false)).toBe(false);
  });

  it("plats populaires et suggestion au panier : oui ou non, gérant seulement", async () => {
    expect(await regler("plats_populaires_actifs", true)).toBe(true);
    expect(await regler("suggestion_panier_active", true)).toBe(true);
    expect(await generaux()).toMatchObject({ plats_populaires_actifs: true, suggestion_panier_active: true });
    // La fonction de client-commande suit.
    expect(await f<{ populaires_actifs: boolean; suggestion_active: boolean }>("plats_populaires()")).toMatchObject({ populaires_actifs: true, suggestion_active: true });
    await expect(regler("plats_populaires_actifs", true, ids.service)).rejects.toThrow(/gérant/);
    await regler("plats_populaires_actifs", false);
    await regler("suggestion_panier_active", false);
  });

  it("e-mail des alertes : rangé à part, jamais recopié dans le journal", async () => {
    expect(await regler("alerte_email", " Cuisine@LaFerme.test ")).toBe("cuisine@laferme.test");
    expect((await generaux()).alerte_email).toBe("cuisine@laferme.test");
    await expect(regler("alerte_email", "pas-une-adresse")).rejects.toThrow(/illisible/);
    const j = await db.query<{ avant: unknown; apres: unknown }>("select avant, apres from journal_gestion where cle = 'alerte_email' order by id desc limit 1");
    expect(j.rows[0]).toEqual({ avant: "variable ALERTE_EMAIL", apres: "adresse saisie" });
    expect(JSON.stringify((await db.query("select * from journal_gestion")).rows)).not.toContain("cuisine@laferme.test");
    expect(await regler("alerte_email", null)).toBeNull();
    expect((await generaux()).alerte_email).toBeNull();
  });

  it("la table privée et les fonctions sont fermées aux visiteurs", async () => {
    const t = await db.query<{ ok: boolean }>(
      "select has_table_privilege('anon', 'reglages_prives', 'select') or has_table_privilege('authenticated', 'reglages_prives', 'select') as ok",
    );
    expect(t.rows[0].ok).toBe(false);
    const r = await db.query<{ n: string }>(
      `select p.proname as n from pg_proc p where p.proname in ('regler_reglage_general', 'reglages_generaux')
         and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`,
    );
    expect(r.rows).toEqual([]);
  });
});
