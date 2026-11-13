import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { groupesPour, rubriqueOuverte, RUBRIQUES } from "@/components/gestion/navigation";
import { baseLocale } from "@/lib/db/locale";
import { ACTIONS_DROIT } from "@/lib/personnel/droits";

// Droits fins et rôle « responsable de service » (vague 3, bo-socle, décision D1). Construit désactivé :
// sans le réglage role_responsable_actif, personne ne peut recevoir ce rôle.
let db: PGlite;
let gerant: string;
const REGLAGE = "role_responsable_actif";
const sql = async <T>(q: string, p: unknown[] = []) => (await db.query<{ r: T }>(q, p)).rows[0]?.r;
const activer = (oui: boolean) => db.query("insert into reglages (cle, valeur, proposition) values ($1, $2::jsonb, false) on conflict (cle) do update set valeur = excluded.valeur", [REGLAGE, oui ? "true" : "false"]);
const id = (email: string) => sql<string>("select id::text as r from personnel where email = $1", [email]);
const droit = (pid: string, action: string) => sql<boolean>("select droit_personnel($1::uuid, $2) as r", [pid, action]);

beforeAll(async () => {
  db = await baseLocale();
  gerant = (await id("gerant-bureau@laferme.test"))!;
});
beforeEach(async () => {
  await db.query("delete from reglages where cle = $1", [REGLAGE]);
  await db.query("delete from personnel where email like 'resp-%@laferme.test'");
});

describe("rôle responsable de service, désactivé par défaut", () => {
  it("sans réglage : le rôle ne s'attribue ni à l'ajout ni au changement", async () => {
    expect(await sql<boolean>("select role_responsable_actif() as r")).toBe(false);
    await expect(db.query("select ajouter_personnel('resp-a@laferme.test', 'Resp A', 'responsable', $1::uuid)", [gerant])).rejects.toThrow(/role_desactive/);
    const pid = await sql<string>("select ajouter_personnel('resp-b@laferme.test', 'Resp B', 'service', $1::uuid)::text as r", [gerant]);
    await expect(db.query("select modifier_personnel($1::uuid, '{\"role\": \"responsable\"}'::jsonb, $2::uuid)", [pid, gerant])).rejects.toThrow(/role_desactive/);
  });

  it("un rôle inconnu reste refusé par la base", async () => {
    await expect(db.query("insert into personnel (email, nom, role) values ('resp-x@laferme.test', 'X', 'chef')")).rejects.toThrow(/personnel_role_check/);
  });
});

describe("rôle activé : le tableau D1", () => {
  it("le responsable a ses droits, pas ceux du gérant ; le service n'en a aucun", async () => {
    await activer(true);
    const resp = (await sql<string>("select ajouter_personnel('resp-c@laferme.test', 'Resp C', 'responsable', $1::uuid)::text as r", [gerant]))!;
    for (const a of Object.keys(ACTIONS_DROIT)) expect(await droit(resp, a), a).toBe(true);
    for (const a of ["modifier_prix", "equipe", "export", "imprimantes"]) expect(await droit(resp, a), a).toBe(false);
    const service = (await id("cuisine-bureau@laferme.test"))!;
    expect(await droit(service, "rembourser")).toBe(false);
    expect(await droit(gerant, "modifier_prix")).toBe(true);
    expect(await sql<string>("select auteur_droit($1::uuid, 'rembourser') as r", [resp])).toBe("Resp C");
    await expect(db.query("select auteur_droit($1::uuid, 'rembourser')", [service])).rejects.toThrow(/droit_refuse/);
    // Le responsable ne gère pas l'équipe : les fonctions du gérant le refusent toujours.
    await expect(db.query("select ajouter_personnel('resp-d@laferme.test', 'Resp D', 'service', $1::uuid)", [resp])).rejects.toThrow(/Réservé au gérant/);
  });

  it("désactiver le rôle coupe les droits des responsables déjà nommés, sans toucher à leur fiche", async () => {
    await activer(true);
    const resp = (await sql<string>("select ajouter_personnel('resp-e@laferme.test', 'Resp E', 'responsable', $1::uuid)::text as r", [gerant]))!;
    await activer(false);
    expect(await droit(resp, "rembourser")).toBe(false);
    expect(await sql<string>("select role as r from personnel where id = $1::uuid", [resp])).toBe("responsable");
    // On peut toujours lui rendre un autre rôle, ou le garder (changement sans nouveau rôle responsable).
    expect(await sql<boolean>("select modifier_personnel($1::uuid, '{\"nom\": \"Resp E2\"}'::jsonb, $2::uuid) as r", [resp, gerant])).toBe(true);
    expect(await sql<boolean>("select modifier_personnel($1::uuid, '{\"role\": \"service\"}'::jsonb, $2::uuid) as r", [resp, gerant])).toBe(true);
  });
});

describe("menu du responsable", () => {
  it("il ne voit que les rubriques qui portent un droit (Commandes aujourd'hui)", () => {
    const titres = groupesPour("responsable").flatMap((g) => g.rubriques.map((r) => r.titre));
    expect(titres).toEqual(["Commandes"]);
    expect(groupesPour("gerant").flatMap((g) => g.rubriques).length).toBeGreaterThan(5);
    expect(rubriqueOuverte(RUBRIQUES.find((r) => r.href === "/gestion/carte")!, "responsable")).toBe(false);
  });
});
