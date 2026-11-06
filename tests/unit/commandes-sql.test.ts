import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

let db: PGlite;
beforeAll(async () => {
  db = await creerBaseLocale();
});

const commande = (cle: string) => ({
  jeton_suivi: `jeton-${cle}`,
  cle_idempotence: cle,
  mode: "retrait",
  statut: "paiement_en_attente",
  statut_paiement: "en_attente",
  moyen_paiement: "en_ligne",
  client_prenom: "Test",
  client_nom: "Essai",
  client_telephone: "079 000 00 00",
  client_email: "test@exemple.ch",
  quand_type: "asap",
  pizzas_seulement: true,
  sous_total_centimes: 1000,
  frais_centimes: 0,
  total_centimes: 1000,
  tva_centimes: 25,
  taux_tva_pourcent: 2.6,
  origine: "http://localhost:3000",
  lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 1000, total_centimes: 1000, choix: {}, retraits: [], note: "" }],
});

describe("fonctions SQL des commandes", () => {
  it("crée une commande numérotée, une seule fois par clé", async () => {
    const a = (await db.query<{ id: string; numero: number; deja: boolean }>("select * from creer_commande($1)", [commande("k1")])).rows[0];
    const b = (await db.query<{ id: string; numero: number; deja: boolean }>("select * from creer_commande($1)", [commande("k1")])).rows[0];
    const c = (await db.query<{ numero: number }>("select * from creer_commande($1)", [commande("k2")])).rows[0];
    expect(b.id).toBe(a.id);
    expect(b.deja).toBe(true);
    expect(c.numero).toBe(a.numero + 1);
    const lignes = (await db.query<{ n: number }>("select count(*)::int as n from commande_lignes where commande_id = $1", [a.id])).rows[0];
    expect(lignes.n).toBe(1);
  });

  it("applique chaque événement de paiement une seule fois et dans un seul sens", async () => {
    const { id } = (await db.query<{ id: string }>("select * from creer_commande($1)", [commande("k3")])).rows[0];
    const applique = async (ev: string, type: string) =>
      (await db.query<{ r: boolean }>("select appliquer_paiement($1, $2, $3, 'pi_test', 1000) as r", [ev, id, type])).rows[0].r;
    expect(await applique("ev1", "paye")).toBe(true);
    expect(await applique("ev1", "paye")).toBe(false);
    expect(await applique("ev2", "echec")).toBe(false);
    const c = (await db.query<{ statut: string; statut_paiement: string }>("select statut, statut_paiement from commandes where id = $1", [id])).rows[0];
    expect(c).toEqual({ statut: "nouvelle", statut_paiement: "paye" });
    expect(await applique("ev3", "rembourse")).toBe(true);
  });

  it("ne laisse rien lire ni appeler à un visiteur", async () => {
    for (const sql of ["select * from commandes", "select commande_par_jeton('jeton-k1')", `select * from creer_commande('{}'::jsonb)`]) {
      await expect(
        db.transaction(async (tx) => {
          await tx.exec("set local role anon");
          await tx.query(sql);
        }),
      ).rejects.toThrow(/permission/);
    }
  });
});
