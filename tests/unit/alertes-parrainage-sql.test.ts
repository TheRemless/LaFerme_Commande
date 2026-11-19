import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Alertes d'abus du parrainage et suspension d'un parrain (décision de Jérémy du 19.11.2026 : pas de SMS, des
// alertes au gérant), migration 20261217090000_alertes_parrainage.sql.

let db: PGlite;
let n = 0;

async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}
async function val<T>(sql: string, v: unknown[] = []): Promise<T> {
  return Object.values((await db.query<Record<string, T>>(sql, v)).rows[0])[0];
}
async function compte(email: string, nom = "Test"): Promise<string> {
  return (await db.query<{ id: string }>("insert into comptes (email, prenom, nom, telephone) values ($1, 'Léa', $2, '') returning id", [email, nom])).rows[0].id;
}
async function commande(compteId: string, email: string, telephone: string, numero: string, plats = 4000, nom = "Test"): Promise<string> {
  n += 1;
  const id = (
    await db.query<{ id: string }>("select id from creer_commande($1)", [
      {
        jeton_suivi: `jeton-alerte-${n}`,
        cle_idempotence: `alerte-${n}`,
        mode: "livraison",
        statut: "nouvelle",
        statut_paiement: "paye",
        moyen_paiement: "en_ligne",
        client_prenom: "Léa",
        client_nom: nom,
        client_telephone: telephone,
        client_email: email,
        adresse: { rue: "Route de Chancy", numero, npa: "1213", localite: "Onex" },
        zone_numero: 1,
        quand_type: "asap",
        pizzas_seulement: true,
        sous_total_centimes: plats,
        frais_centimes: 500,
        total_centimes: plats + 500,
        tva_centimes: 0,
        taux_tva_pourcent: 2.6,
        origine: "http://localhost:3000",
        compte_id: compteId,
        lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: plats, total_centimes: plats, choix: {}, retraits: [], note: "" }],
      },
    ])
  ).rows[0].id;
  await db.query("update commandes set statut = 'terminee' where id = $1", [id]);
  return id;
}
// Un filleul rattaché au parrain, crédité par une commande de CHF 40 livrée.
async function filleul(code: string, i: number, o: { nom?: string; numero?: string; ip?: string } = {}): Promise<string> {
  const email = `filleul${i}-${n}@exemple.ch`;
  const id = await compte(email, o.nom ?? `Nom${i}`);
  expect(await f<string>("lier_parrainage($1, $2)", [email, code])).toBe("ok");
  if (o.ip) await db.query("insert into journal_connexions (compte_id, evenement, ip_court) values ($1, 'connexion', $2)", [id, o.ip]);
  await commande(id, email, `079 50${i} 00 0${i}`, o.numero ?? `${300 + i}`, 4000, o.nom ?? `Nom${i}`);
  return id;
}
const detecter = () => f<{ id: number; type: string; compte_id: string }[]>("detecter_alertes_parrainage()");

let parrain: string;
let code: string;
let gerant: string;
beforeEach(async () => {
  db = await creerBaseLocale();
  parrain = await compte("parrain@exemple.ch");
  await commande(parrain, "parrain@exemple.ch", "079 111 11 11", "10");
  code = await f<string>("code_parrainage($1)", [parrain]);
  gerant = (await db.query<{ id: string }>("select id from personnel where email = 'equipe@laferme.test'")).rows[0].id;
});

describe("alertes d'abus du parrainage", () => {
  it("plus de 3 filleuls crédités en 30 jours : une alerte, une seule fois", async () => {
    for (let i = 1; i <= 3; i++) await filleul(code, i);
    expect((await detecter()).filter((a) => a.type === "trop_de_filleuls")).toEqual([]);
    await filleul(code, 4);
    const a = (await detecter()).filter((x) => x.type === "trop_de_filleuls");
    expect(a).toHaveLength(1);
    expect(a[0].compte_id).toBe(parrain);
    // Notée envoyée : elle ne revient plus.
    await f("noter_alerte_parrainage_envoyee($1)", [a[0].id]);
    expect((await detecter()).filter((x) => x.type === "trop_de_filleuls")).toEqual([]);
  });

  it("filleuls d'un même parrain qui partagent une adresse, une IP de connexion ou un nom", async () => {
    await filleul(code, 1, { numero: "77", ip: "ab12cd34", nom: "Dupont" });
    await filleul(code, 2, { numero: "77", ip: "ab12cd34", nom: "Dupont" });
    const cas = await detecter();
    expect(cas.map((a) => a.type).sort()).toEqual(expect.arrayContaining(["meme_adresse", "meme_ip", "meme_nom"]));
    // Ni adresse, ni nom, ni e-mail de client gardés avec l'alerte : seulement des nombres.
    const gardes = JSON.stringify((await db.query("select cle, detail from alertes_parrainage")).rows);
    expect(gardes).not.toMatch(/Chancy|Dupont|exemple\.ch/i);
  });

  it("filleuls qui ne recommandent jamais : ratio par parrain, après 30 jours", async () => {
    await db.query("update reglages set valeur = '10' where cle = 'parrainage_alerte_filleuls_30j'");
    const f1 = await filleul(code, 1);
    await filleul(code, 2);
    await filleul(code, 3);
    await db.query("update parrainages set termine_le = now() - interval '40 days' where parrain_id = $1", [parrain]);
    expect((await detecter()).map((a) => a.type)).toContain("sans_suite");
    // Un filleul qui recommande fait baisser le ratio sous le seuil (2 sur 3 = 67 % < 75 %).
    await db.query("delete from alertes_parrainage");
    await commande(f1, "deuxieme@exemple.ch", "079 501 00 01", "301");
    expect((await detecter()).map((a) => a.type)).not.toContain("sans_suite");
  });

  it("un compte qui reçoit plus de parrainage qu'il n'a payé sur 30 jours", async () => {
    await db.query("update reglages set valeur = '1000' where cle = 'parrainage_montant_centimes'");
    await db.query("update reglages set valeur = '3000' where cle = 'parrainage_minimum_centimes'");
    // Parrain : 4 filleuls = CHF 40 reçus, CHF 45 payés : rien. Le 5e : CHF 50 reçus, au-dessus.
    await db.query("update reglages set valeur = '10' where cle = 'parrainage_alerte_filleuls_30j'");
    for (let i = 1; i <= 4; i++) await filleul(code, i);
    expect((await detecter()).filter((a) => a.type === "recu_plus_que_paye" && a.compte_id === parrain)).toEqual([]);
    await filleul(code, 5);
    expect((await detecter()).filter((a) => a.type === "recu_plus_que_paye" && a.compte_id === parrain)).toHaveLength(1);
  });
});

describe("suspension d'un parrain", () => {
  it("gérant seulement, motif obligatoire ; bloque les nouveaux crédits et les nouveaux liens, garde les anciens", async () => {
    const ancien = await filleul(code, 1);
    const enAttente = await compte("en-attente@exemple.ch");
    await f("lier_parrainage('en-attente@exemple.ch', $1)", [code]);
    const service = (await db.query<{ id: string }>("select id from personnel where email = 'equipe-bureau@laferme.test'")).rows[0].id;
    await expect(f("suspendre_parrain($1, 'Abus', $2)", [parrain, service])).rejects.toThrow(/Réservé au gérant/);
    await expect(f("suspendre_parrain($1, '', $2)", [parrain, gerant])).rejects.toThrow(/motif/);
    await f("suspendre_parrain($1, 'Filleuls à la même adresse', $2)", [parrain, gerant]);
    // Les anciens crédits restent.
    expect(await val<number>("select coalesce(sum(montant_centimes), 0)::integer from cagnotte_mouvements where compte_id = $1 and type = 'parrainage_filleul'", [ancien])).toBe(1000);
    // Le filleul en attente n'est pas crédité ; un nouveau lien est refusé.
    await commande(enAttente, "en-attente@exemple.ch", "079 600 00 01", "400");
    expect(await val<string>("select raison from parrainages where filleul_id = $1", [enAttente])).toBe("parrain_suspendu");
    await compte("nouveau@exemple.ch");
    expect(await f<string>("lier_parrainage('nouveau@exemple.ch', $1)", [code])).toBe("parrain_suspendu");
    expect(await val<number>("select count(*)::integer from journal_gestion where objet = 'parrainage'")).toBe(1);
    // Réactivé : les nouveaux liens repartent.
    await f("reactiver_parrain($1, $2)", [parrain, gerant]);
    await compte("apres@exemple.ch");
    expect(await f<string>("lier_parrainage('apres@exemple.ch', $1)", [code])).toBe("ok");
  });

  it("écran du back-office : parrains, filleuls, montants, signaux ; tables fermées", async () => {
    await filleul(code, 1, { numero: "77", nom: "Dupont" });
    await filleul(code, 2, { numero: "77", nom: "Dupont" });
    await detecter();
    const liste = await f<{ parrain_id: string; email: string; suspendu: unknown; filleuls: { statut: string; montant_centimes: number }[]; signaux: { type: string }[] }[]>("parrainages_gestion()");
    const p = liste.find((x) => x.parrain_id === parrain)!;
    expect(p.email).toBe("parrain@exemple.ch");
    // Le second partage l'adresse du premier : refusé par la base, il reste visible avec sa raison.
    expect(p.filleuls.map((x) => x.statut)).toEqual(["credite", "refuse"]);
    expect(p.filleuls.map((x) => x.montant_centimes)).toEqual([1000, 0]);
    expect(p.signaux.map((s) => s.type)).toEqual(expect.arrayContaining(["meme_adresse", "meme_nom"]));
    for (const t of ["alertes_parrainage", "parrains_suspendus"]) {
      expect(await val<boolean>("select relrowsecurity from pg_class where relname = $1", [t])).toBe(true);
    }
    const qui = (await db.query<{ grantee: string }>(
      "select grantee from information_schema.routine_privileges where routine_name = 'suspendre_parrain' and privilege_type = 'EXECUTE'")).rows.map((r) => r.grantee);
    expect(qui).toContain("service_role");
    expect(qui).not.toContain("anon");
  });
});
