import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";
import { texteTicket, type LigneTicket } from "@/lib/impression/ticket";

// Ticket de test (vague 3, demandé par bo-operations) : tâche « essai » sans commande, gérant seulement, envoyée et
// confirmée par CloudPRNT comme une autre, invisible pour les lectures par commande.

let db: PGlite;
let gerant: string;
let equipe: string;
beforeAll(async () => {
  db = await creerBaseLocale();
  gerant = (await db.query<{ id: string }>("select id from personnel where email = 'equipe@laferme.test'")).rows[0].id;
  equipe = (await db.query<{ id: string }>("select id from personnel where role = 'service' and actif limit 1")).rows[0].id;
});
async function f<T>(sql: string, valeurs: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, valeurs)).rows[0].r;
}
const JETON = "b".repeat(64);
const MAC = "00:11:62:aa:bb:dd";

describe("ticket de test", () => {
  it("le gérant l'envoie ; il sort par CloudPRNT et se confirme comme une autre tâche", async () => {
    const imp = await f<number>("ajouter_imprimante('Pizza essai', 'pizza', $1, $2)", [JETON, gerant]);
    await f("passage_imprimante($1, $2, '200 OK')", [JETON, MAC]);
    const tache = await f<string>("ticket_de_test($1::smallint, $2)", [imp, gerant]);
    const ligne = (await db.query<{ commande_id: string | null; essai: boolean; station: string; etat: string }>("select commande_id, essai, station, etat from taches_impression where id = $1", [tache])).rows[0];
    expect(ligne).toEqual({ commande_id: null, essai: true, station: "pizza", etat: "en_attente" });

    expect(await f("passage_imprimante($1, $2, '200 OK')", [JETON, MAC])).toMatchObject({ tache });
    const contenu = await f<LigneTicket[]>("tache_pour_imprimante($1, $2, $3)", [JETON, MAC, tache]);
    const texte = texteTicket(contenu);
    expect(texte).toContain("TEST");
    expect(texte).toContain("Pizza essai");
    expect(texte).toMatch(/Si ce ticket sort, l'imprimante est bien\s+branchee\./);
    expect(texte).toMatch(/Demande par Equipe test/);
    expect(await f("confirmer_tache($1, $2, $3, '200 OK')", [JETON, MAC, tache])).toMatchObject({ etat: "imprimee" });

    // Journal du back-office.
    const j = (await db.query<{ cle: string }>("select cle from journal_gestion where objet = 'imprimante' and apres ->> 'tache' = $1", [tache])).rows;
    expect(j).toEqual([{ cle: "ticket_de_test" }]);
  });

  it("réservé au gérant ; imprimante inconnue ou désactivée refusée", async () => {
    const imp = await f<number>("ajouter_imprimante('Cuisine essai', 'cuisine', $1, $2)", ["c".repeat(64), gerant]);
    await expect(f("ticket_de_test($1::smallint, $2)", [imp, equipe])).rejects.toThrow(/Réservé au gérant/);
    await expect(f("ticket_de_test(32000::smallint, $1)", [gerant])).rejects.toThrow(/Imprimante inconnue/);
    await f("modifier_imprimante($1::smallint, null, false, $2)", [imp, gerant]);
    await expect(f("ticket_de_test($1::smallint, $2)", [imp, gerant])).rejects.toThrow(/désactivée/);
  });

  it("une tâche ne peut être sans commande que si c'est un essai", async () => {
    await expect(
      db.query("insert into taches_impression (commande_id, station, contenu) values (null, 'pizza', '[]'::jsonb)"),
    ).rejects.toThrow(/taches_impression_commande_ou_essai/);
  });
});

describe("imprimerTicketTest", () => {
  it("message en français pour une imprimante inconnue ou un id hors bornes", async () => {
    const { imprimerTicketTest } = await import("@/lib/impression/test");
    const { baseLocale } = await import("@/lib/db/locale");
    const g = (await (await baseLocale()).query<{ id: string }>("select id from personnel where email = 'equipe@laferme.test'")).rows[0].id;
    const p = { id: g, email: "equipe@laferme.test", nom: "Équipe test", role: "gerant" as const };
    expect(await imprimerTicketTest(31999, p)).toEqual({ ok: false, erreur: "Imprimante inconnue." });
    expect(await imprimerTicketTest(70000, p)).toEqual({ ok: false, erreur: "Imprimante inconnue." });
  });
});

describe("ticket de test et imprimante désactivée", () => {
  it("l'essai en attente est annulé, pas renvoyé vers l'autre imprimante du poste", async () => {
    const un = await f<number>("ajouter_imprimante('Cuisine 1', 'cuisine', $1, $2)", ["d".repeat(64), gerant]);
    const deux = await f<number>("ajouter_imprimante('Cuisine 2', 'cuisine', $1, $2)", ["e".repeat(64), gerant]);
    const tache = await f<string>("ticket_de_test($1::smallint, $2)", [un, gerant]);
    await f("modifier_imprimante($1::smallint, null, false, $2)", [un, gerant]);
    const t = (await db.query<{ etat: string; imprimante_id: number | null }>("select etat, imprimante_id from taches_impression where id = $1", [tache])).rows[0];
    expect(t.etat).toBe("annulee");
    // Cuisine 2 ne reçoit rien.
    await f("passage_imprimante($1, $2, '200 OK')", ["e".repeat(64), "00:11:62:aa:bb:ee"]);
    expect(await f("passage_imprimante($1, $2, '200 OK')", ["e".repeat(64), "00:11:62:aa:bb:ee"])).toMatchObject({ tache: null });
    expect(deux).toBeGreaterThan(0);
  });

  it("une imprimante supprimée : l'essai est annulé sans erreur", async () => {
    const imp = await f<number>("ajouter_imprimante('Pizza 9', 'pizza', $1, $2)", ["f".repeat(64), gerant]);
    const tache = await f<string>("ticket_de_test($1::smallint, $2)", [imp, gerant]);
    await db.query("delete from imprimantes where id = $1", [imp]);
    expect((await db.query<{ etat: string }>("select etat from taches_impression where id = $1", [tache])).rows[0].etat).toBe("annulee");
  });
});
