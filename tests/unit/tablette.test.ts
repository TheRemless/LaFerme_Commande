import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";
import { detailsTablette, heureValide } from "@/lib/tablette";
import { etatService, messagePause, type ConfigService } from "@/lib/service";

let db: PGlite;
beforeAll(async () => {
  db = await creerBaseLocale();
});

let n = 0;
const h = () => (++n).toString(16).padStart(64, "0");
async function f<T>(sql: string, valeurs: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, valeurs)).rows[0].r;
}

const commande = (cle: string, extra: Record<string, unknown> = {}) => ({
  jeton_suivi: `jeton-tab-${cle}`,
  cle_idempotence: `tab-${cle}`,
  mode: "retrait",
  statut: "nouvelle",
  statut_paiement: "a_encaisser_retrait",
  moyen_paiement: "comptoir",
  client_prenom: "Léa",
  client_nom: "Test",
  client_telephone: "079 000 00 00",
  client_email: "lea@exemple.test",
  quand_type: "asap",
  pizzas_seulement: true,
  sous_total_centimes: 1000,
  frais_centimes: 0,
  total_centimes: 1000,
  tva_centimes: 25,
  taux_tva_pourcent: 2.6,
  origine: "http://localhost:3000",
  lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 1000, total_centimes: 1000, choix: {}, retraits: [], note: "" }],
  ...extra,
});
const creer = async (cle: string, extra: Record<string, unknown> = {}) =>
  (await db.query<{ id: string }>("select * from creer_commande($1)", [commande(cle, extra)])).rows[0].id;
const statut = async (id: string) => (await db.query<{ statut: string }>("select statut from commandes where id = $1", [id])).rows[0].statut;
const changer = (id: string, vers: string, heure: string | null = null, motif: string | null = null) =>
  f<boolean>("changer_statut($1, $2, 'tablette:Test', $3, $4)", [id, vers, heure, motif]);

describe("connexion du personnel", () => {
  it("donne une session à un membre actif, rien à une adresse inconnue, même réponse", async () => {
    const cleEquipe = h();
    const cleInconnu = h();
    const code = h();
    expect(await f<number>("demander_code_personnel('equipe@laferme.test', $1, $2, $3, 'ip')", [cleEquipe, h(), code])).toBe(0);
    expect(await f<number>("demander_code_personnel('inconnu@laferme.test', $1, $2, $3, 'ip')", [cleInconnu, h(), h()])).toBe(-1);
    const session = h();
    const ok = await f<{ statut: string }>("verifier_code_personnel('equipe@laferme.test', $1, $2, $3, 'ip', $4)", [cleEquipe, h(), code, session]);
    expect(ok.statut).toBe("ok");
    expect(await f<{ role: string }>("personnel_de_session($1)", [session])).toMatchObject({ role: "gerant" });
    // Usage unique.
    expect((await f<{ statut: string }>("verifier_code_personnel('equipe@laferme.test', $1, $2, $3, 'ip', $4)", [cleEquipe, h(), code, h()])).statut).toBe("invalide");
    // Une session client ne vaut rien côté personnel, et l'inverse.
    expect(await f("compte_de_session($1)", [session])).toBeNull();
    await f("deconnecter_personnel($1, 'ip')", [session]);
    expect(await f("personnel_de_session($1)", [session])).toBeNull();
  });

  it("un membre désactivé perd l'accès tout de suite", async () => {
    const cle = h();
    const code = h();
    await f("demander_code_personnel('equipe@laferme.test', $1, $2, $3, 'ip')", [cle, h(), code]);
    const session = h();
    await f("verifier_code_personnel('equipe@laferme.test', $1, $2, $3, 'ip', $4)", [cle, h(), code, session]);
    await db.query("update personnel set actif = false where email = 'equipe@laferme.test'");
    expect(await f("personnel_de_session($1)", [session])).toBeNull();
    await db.query("update personnel set actif = true where email = 'equipe@laferme.test'");
  });
});

describe("statuts depuis la tablette", () => {
  it("suit les passages permis et refuse les autres", async () => {
    const id = await creer("a");
    expect(await changer(id, "prete")).toBe(false);
    expect(await changer(id, "acceptee")).toBe(false); // sans heure
    expect(await changer(id, "acceptee", new Date().toISOString())).toBe(true);
    expect(await changer(id, "acceptee", new Date().toISOString())).toBe(false); // double appui
    expect(await changer(id, "partie")).toBe(false); // retrait : « prête », pas « partie »
    expect(await changer(id, "en_preparation")).toBe(true);
    expect(await changer(id, "prete")).toBe(true);
    expect(await changer(id, "refusee", null, "Trop tard.")).toBe(false);
    expect(await changer(id, "terminee")).toBe(true);
    expect(await statut(id)).toBe("terminee");
    const traces = (await db.query<{ vers: string; par: string }>("select vers, par from evenements_commande where commande_id = $1 order by id", [id])).rows;
    expect(traces.map((t) => t.vers)).toEqual(["acceptee", "en_preparation", "prete", "terminee"]);
    expect(traces.every((t) => t.par === "tablette:Test")).toBe(true);
  });

  it("refuse seulement avec un motif, et une commande en attente de paiement n'est pas touchable", async () => {
    const id = await creer("b");
    expect(await changer(id, "refusee", null, "  ")).toBe(false);
    expect(await changer(id, "refusee", null, "Complet.")).toBe(true);
    const attente = await creer("c", { statut: "paiement_en_attente", statut_paiement: "en_attente", moyen_paiement: "en_ligne" });
    expect(await changer(attente, "acceptee", new Date().toISOString())).toBe(false);
    expect(await changer(attente, "refusee", null, "Non.")).toBe(false);
  });

  it("la file ne montre ni les commandes en attente de paiement ni les annulées", async () => {
    const visible = await creer("d");
    const cachee = await creer("e", { statut: "paiement_en_attente", statut_paiement: "en_attente", moyen_paiement: "en_ligne" });
    const ids = (await f<{ id: string }[]>("file_tablette()")).map((c) => c.id);
    expect(ids).toContain(visible);
    expect(ids).not.toContain(cachee);
  });

  it("encaisse une seule fois un paiement au comptoir, change l'heure d'une commande acceptée", async () => {
    const id = await creer("f");
    expect(await f<boolean>("changer_heure($1, $2, 'tablette:Test')", [id, new Date().toISOString()])).toBe(false);
    await changer(id, "acceptee", new Date().toISOString());
    expect(await f<boolean>("changer_heure($1, $2, 'tablette:Test')", [id, new Date(Date.now() + 600_000).toISOString()])).toBe(true);
    expect(await f<boolean>("marquer_encaisse($1, 'tablette:Test')", [id])).toBe(true);
    expect(await f<boolean>("marquer_encaisse($1, 'tablette:Test')", [id])).toBe(false);
  });
});

describe("réglages et ruptures", () => {
  it("pause, livraison fermée et délai, dans les limites", async () => {
    await f("regler_service($1, null)", [{ pause_jusqu_a: "sans-fin", livraison_fermee: true, preparation_minutes: 25 }]);
    const r = (await db.query<{ cle: string; valeur: unknown }>("select cle, valeur from reglages where cle in ('pause_jusqu_a', 'livraison_fermee', 'preparation_minutes') order by cle")).rows;
    expect(r).toEqual([
      { cle: "livraison_fermee", valeur: true },
      { cle: "pause_jusqu_a", valeur: "sans-fin" },
      { cle: "preparation_minutes", valeur: 25 },
    ]);
    await expect(f("regler_service($1, null)", [{ preparation_minutes: 500 }])).rejects.toThrow();
    await f("regler_service($1, null)", [{ pause_jusqu_a: null, livraison_fermee: false, preparation_minutes: 20 }]);
  });

  it("une rupture du jour grise le plat dans la carte publique", async () => {
    expect(await f<boolean>("regler_rupture('pizza-margherita', true, null)")).toBe(true);
    const motif = (await db.query<{ rupture_motif: string | null }>("select rupture_motif from carte_publique where slug = 'pizza-margherita'")).rows[0];
    expect(motif.rupture_motif).toBe("Épuisé pour aujourd'hui.");
    // Une rupture d'hier ne compte plus.
    await db.query("update plats set rupture_jour = current_date - 2 where slug = 'pizza-margherita'");
    expect((await db.query<{ rupture_motif: string | null }>("select rupture_motif from carte_publique where slug = 'pizza-margherita'")).rows[0].rupture_motif).toBeNull();
    expect(await f<boolean>("regler_rupture('inexistant', true, null)")).toBe(false);
  });

  it("aucun droit pour un visiteur sur les tables et fonctions de la tablette", async () => {
    for (const sql of ["select * from personnel", "select * from sessions_personnel", "select * from evenements_commande", "select file_tablette()", "select plats_tablette()"]) {
      for (const role of ["anon", "authenticated"]) {
        await expect(
          db.transaction(async (tx) => {
            await tx.exec(`set local role ${role}`);
            await tx.query(sql);
          }),
        ).rejects.toThrow(/permission denied/);
      }
    }
  });
});

describe("logique de la tablette", () => {
  it("écrit les options comme sur le ticket", () => {
    const cat = {
      tauxTvaPourcent: 2.6,
      plats: {},
      groupes: {
        "choix-pates": { slug: "choix-pates", nom: "Pâtes", choix_min: 1, choix_max: 1, options: [] },
        supplements: { slug: "supplements", nom: "Suppléments", choix_min: 0, choix_max: 5, options: [] },
      },
    };
    expect(detailsTablette(cat, { choix: { "choix-pates": ["Penne"], supplements: ["Jambon"] }, retraits: ["Oignons"], note: "bien cuite" })).toEqual([
      "CHOIX Penne",
      "+ Jambon",
      "SANS Oignons",
      "« bien cuite »",
    ]);
  });

  it("n'accepte qu'une heure proche", () => {
    const t = new Date("2026-11-10T18:00:00Z");
    expect(heureValide("2026-11-10T18:30:00.000Z", t)).toBe("2026-11-10T18:30:00.000Z");
    expect(heureValide("2026-12-10T18:30:00.000Z", t)).toBeNull();
    expect(heureValide("pas une date", t)).toBeNull();
  });

  it("met en pause et ferme la livraison seule", () => {
    const config = { zones: [], npa: [], horaires: [], fermetures: [], reglages: { preparation_minutes: 20, creneau_minutes: 15, avance_jours: 7 } } as ConfigService;
    const maintenant = new Date("2026-11-10T18:00:00Z");
    const avant = maintenant.getTime();
    // La pause se compare à l'heure réelle.
    const pause = { ...config, pause: { active: true, jusqua: new Date(Date.now() + 1_800_000).toISOString(), livraisonFermee: false } };
    expect(etatService(pause, maintenant, "retrait").etat).toBe("pause");
    expect(messagePause(etatService(pause, maintenant, "retrait"))).toMatch(/reprennent à \d{2}h\d{2}/);
    const finie = { ...config, pause: { active: true, jusqua: new Date(Date.now() - 60_000).toISOString(), livraisonFermee: false } };
    expect(etatService(finie, maintenant, "retrait").etat).not.toBe("pause");
    const livraison = { ...config, pause: { active: false, jusqua: null, livraisonFermee: true } };
    expect(etatService(livraison, maintenant, "livraison").etat).toBe("livraison-fermee");
    expect(etatService(livraison, maintenant, "retrait").etat).not.toBe("livraison-fermee");
    expect(avant).toBe(maintenant.getTime());
  });
});
