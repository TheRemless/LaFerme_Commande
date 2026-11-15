import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Parrainage (validé par Jérémy le 15.11.2026), migration 20261216100000_parrainage.sql, selon la grille de qualite :
// crédit après la première commande livrée du filleul seulement, client vraiment nouveau, pas d'auto-parrainage,
// un seul parrain, plafond par mois.

let db: PGlite;
let n = 0;

async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}
async function val<T>(sql: string, v: unknown[] = []): Promise<T> {
  return Object.values((await db.query<Record<string, T>>(sql, v)).rows[0])[0];
}
async function compte(email: string, telephone = ""): Promise<string> {
  return (await db.query<{ id: string }>("insert into comptes (email, prenom, telephone) values ($1, 'Léa', $2) returning id", [email, telephone])).rows[0].id;
}
const adresse = (numero: string) => ({ rue: "Route de Chancy", numero, npa: "1213", localite: "Onex" });

async function commande(compteId: string | null, email: string, telephone: string, numero: string, statut = "terminee"): Promise<string> {
  n += 1;
  const id = (
    await db.query<{ id: string }>("select id from creer_commande($1)", [
      {
        jeton_suivi: `jeton-parrainage-${n}`,
        cle_idempotence: `parrainage-${n}`,
        mode: "livraison",
        statut: "nouvelle",
        statut_paiement: "paye",
        moyen_paiement: "en_ligne",
        client_prenom: "Léa",
        client_nom: "Test",
        client_telephone: telephone,
        client_email: email,
        adresse: adresse(numero),
        zone_numero: 1,
        quand_type: "asap",
        pizzas_seulement: true,
        sous_total_centimes: 2000,
        frais_centimes: 500,
        total_centimes: 2500,
        tva_centimes: 63,
        taux_tva_pourcent: 2.6,
        origine: "http://localhost:3000",
        compte_id: compteId,
        lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 2000, total_centimes: 2000, choix: {}, retraits: [], note: "" }],
      },
    ])
  ).rows[0].id;
  await db.query("update commandes set statut = $2 where id = $1", [id, statut]);
  return id;
}
const parrainages = (c: string) => val<number>("select coalesce(sum(montant_centimes), 0)::integer from cagnotte_mouvements where compte_id = $1 and type = 'parrainage'", [c]);

let parrain: string;
let code: string;
beforeEach(async () => {
  db = await creerBaseLocale();
  parrain = await compte("parrain@exemple.ch", "079 111 11 11");
  await commande(parrain, "parrain@exemple.ch", "079 111 11 11", "10");
  code = await f<string>("code_parrainage($1)", [parrain]);
});

describe("parrainage", () => {
  it("lien personnel : un code stable de 8 caractères", async () => {
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(await f<string>("code_parrainage($1)", [parrain])).toBe(code);
  });

  it("CHF 10 à chacun après la première commande livrée du filleul, pas à l'inscription ni au paiement", async () => {
    const filleul = await compte("filleul@exemple.ch");
    expect(await f<string>("lier_parrainage('Filleul@Exemple.ch', $1)", [code.toLowerCase()])).toBe("ok");
    expect(await parrainages(parrain)).toBe(0);
    const id = await commande(filleul, "filleul@exemple.ch", "079 222 22 22", "20", "acceptee");
    expect(await parrainages(filleul)).toBe(0);
    await db.query("update commandes set statut = 'terminee' where id = $1", [id]);
    expect([await parrainages(parrain), await parrainages(filleul)]).toEqual([1000, 1000]);
    // Une deuxième commande ne crédite plus rien.
    await commande(filleul, "filleul@exemple.ch", "079 222 22 22", "20");
    expect([await parrainages(parrain), await parrainages(filleul)]).toEqual([1000, 1000]);
    expect(await f<{ credites: number; parraine: string | null }>("parrainage_compte($1)", [parrain])).toMatchObject({ credites: 1, parraine: null });
    expect(await f<{ parraine: string }>("parrainage_compte($1)", [filleul])).toMatchObject({ parraine: "credite" });
  });

  it("client nouveau seulement : e-mail qui a déjà commandé, compte ancien, deuxième parrain refusés", async () => {
    await commande(null, "deja@exemple.ch", "079 333 33 33", "30");
    await compte("deja@exemple.ch");
    expect(await f<string>("lier_parrainage('deja@exemple.ch', $1)", [code])).toBe("ancien");
    const vieux = await compte("vieux@exemple.ch");
    await db.query("update comptes set cree_le = now() - interval '2 days' where id = $1", [vieux]);
    expect(await f<string>("lier_parrainage('vieux@exemple.ch', $1)", [code])).toBe("ancien");
    await compte("une-fois@exemple.ch");
    expect(await f<string>("lier_parrainage('une-fois@exemple.ch', $1)", [code])).toBe("ok");
    expect(await f<string>("lier_parrainage('une-fois@exemple.ch', $1)", [code])).toBe("deja");
    expect(await f<string>("lier_parrainage('parrain@exemple.ch', $1)", [code])).toBe("soi_meme");
    expect(await f<string>("lier_parrainage('inconnu@exemple.ch', $1)", [code])).toBe("code");
    expect(await f<string>("lier_parrainage('une-fois@exemple.ch', 'ZZZZZZZZ')")).toBe("code");
  });

  it("pas d'auto-parrainage : téléphone du parrain ou adresse déjà vue, refusé sans crédit", async () => {
    const memeTel = await compte("meme-tel@exemple.ch");
    await f("lier_parrainage('meme-tel@exemple.ch', $1)", [code]);
    await commande(memeTel, "meme-tel@exemple.ch", "+41 79 111 11 11", "40");
    expect(await parrainages(parrain)).toBe(0);
    expect(await val<string>("select raison from parrainages where filleul_id = $1", [memeTel])).toBe("telephone");

    const memeAdresse = await compte("meme-adresse@exemple.ch");
    await f("lier_parrainage('meme-adresse@exemple.ch', $1)", [code]);
    await commande(memeAdresse, "meme-adresse@exemple.ch", "079 444 44 44", "10");
    expect(await parrainages(parrain)).toBe(0);
    expect(await val<string>("select raison from parrainages where filleul_id = $1", [memeAdresse])).toBe("adresse");
  });

  it("au plus 10 parrainages par compte et par mois (réglable)", async () => {
    await db.query("update reglages set valeur = '2' where cle = 'parrainage_plafond_mois'");
    for (const e of ["a@exemple.ch", "b@exemple.ch", "c@exemple.ch"]) await compte(e);
    expect(await f<string>("lier_parrainage('a@exemple.ch', $1)", [code])).toBe("ok");
    expect(await f<string>("lier_parrainage('b@exemple.ch', $1)", [code])).toBe("ok");
    expect(await f<string>("lier_parrainage('c@exemple.ch', $1)", [code])).toBe("plafond");
  });

  it("rien quand la cagnotte est éteinte ; livraison close « client absent » ne compte pas", async () => {
    const absent = await compte("absent@exemple.ch");
    await f("lier_parrainage('absent@exemple.ch', $1)", [code]);
    const id = await commande(absent, "absent@exemple.ch", "079 555 55 55", "50", "partie");
    await db.query("update commandes set statut = 'terminee', motif = 'Client absent à la livraison.' where id = $1", [id]);
    expect(await parrainages(absent)).toBe(0);
    await db.query("update reglages set valeur = 'false' where cle = 'fidelite_active'");
    await compte("eteint@exemple.ch");
    expect(await f<string>("lier_parrainage('eteint@exemple.ch', $1)", [code])).toBe("desactive");
  });

  it("supprimer un compte efface ses parrainages ; tables fermées, fonctions réservées au serveur", async () => {
    const filleul = await compte("efface@exemple.ch");
    await f("lier_parrainage('efface@exemple.ch', $1)", [code]);
    await db.query("delete from comptes where id = $1", [filleul]);
    expect(await val<number>("select count(*)::integer from parrainages where filleul_id = $1", [filleul])).toBe(0);
    expect(await val<boolean>("select relrowsecurity from pg_class where relname = 'parrainages'")).toBe(true);
    const qui = (await db.query<{ grantee: string }>(
      "select grantee from information_schema.routine_privileges where routine_name = 'lier_parrainage' and privilege_type = 'EXECUTE'")).rows.map((r) => r.grantee);
    expect(qui).toContain("service_role");
    expect(qui).not.toContain("anon");
  });

  it("réglages du back-office : montant et plafond bornés", async () => {
    const gerant = (await db.query<{ id: string }>("select id from personnel where email = 'equipe@laferme.test'")).rows[0].id;
    const base = { taux_pourcent: 5, seuil_centimes: 1000, soirs_doubles: { jours: [], dates: [] } };
    await expect(f("regler_fidelite($1, $2)", [{ ...base, parrainage_montant_centimes: 9000, parrainage_plafond_mois: 10 }, gerant])).rejects.toThrow(/parrainage/);
    const r = await f<{ parrainage_montant_centimes: number; parrainage_plafond_mois: number }>("regler_fidelite($1, $2)", [{ ...base, parrainage_montant_centimes: 1500, parrainage_plafond_mois: 5 }, gerant]);
    expect(r).toMatchObject({ parrainage_montant_centimes: 1500, parrainage_plafond_mois: 5 });
    expect((await f<{ montant_centimes: number }>("parrainage_compte($1)", [parrain])).montant_centimes).toBe(1500);
  });

  it("revue de sécurité : variantes de numéro, téléphone du destinataire, Gmail à points, compte qui a déjà commandé", async () => {
    // « +41 (0)79 111 11 11 » est le numéro du parrain écrit autrement.
    const variante = await compte("variante@exemple.ch");
    await f("lier_parrainage('variante@exemple.ch', $1)", [code]);
    await commande(variante, "variante@exemple.ch", "+41 (0)79 111 11 11", "60");
    expect(await val<string>("select raison from parrainages where filleul_id = $1", [variante])).toBe("telephone");

    // Vrai numéro mis dans « la personne qui reçoit ».
    const dest = await compte("dest@exemple.ch");
    await f("lier_parrainage('dest@exemple.ch', $1)", [code]);
    const id = await commande(dest, "dest@exemple.ch", "079 666 66 66", "70", "acceptee");
    await db.query(`update commandes set destinataire = '{"nom": "Moi", "telephone": "079 111 11 11"}' where id = $1`, [id]);
    await db.query("update commandes set statut = 'terminee' where id = $1", [id]);
    expect(await val<string>("select raison from parrainages where filleul_id = $1", [dest])).toBe("telephone");

    // Gmail ignore les points et ce qui suit « + » : même boîte que le parrain.
    await db.query("update comptes set email = 'jeremie.test@gmail.com' where id = $1", [parrain]);
    await compte("j.eremie.test+bis@gmail.com");
    expect(await f<string>("lier_parrainage('j.eremie.test+bis@gmail.com', $1)", [code])).toBe("ancien");

    // Compte de moins de 24 heures qui a déjà commandé avec un autre e-mail de contact.
    const presse = await compte("presse@exemple.ch");
    await commande(presse, "autre-contact@exemple.ch", "079 777 77 77", "80");
    expect(await f<string>("lier_parrainage('presse@exemple.ch', $1)", [code])).toBe("ancien");
  });

  it("revue de sécurité : rien sur une commande non payée ou remboursée ; crédits repris au remboursement total", async () => {
    const f1 = await compte("rembourse-avant@exemple.ch");
    await f("lier_parrainage('rembourse-avant@exemple.ch', $1)", [code]);
    const id1 = await commande(f1, "rembourse-avant@exemple.ch", "079 888 88 81", "90", "prete");
    await db.query("update commandes set statut_paiement = 'rembourse' where id = $1", [id1]);
    await db.query("update commandes set statut = 'terminee' where id = $1", [id1]);
    expect(await parrainages(f1)).toBe(0);

    const f2 = await compte("rembourse-apres@exemple.ch");
    await f("lier_parrainage('rembourse-apres@exemple.ch', $1)", [code]);
    const id2 = await commande(f2, "rembourse-apres@exemple.ch", "079 888 88 82", "91");
    expect(await parrainages(f2)).toBe(1000);
    await db.query("update commandes set statut_paiement = 'rembourse' where id = $1", [id2]);
    expect([await parrainages(parrain), await parrainages(f2)]).toEqual([0, 0]);
  });

  it("au comptoir : le crédit attend l'encaissement de la première commande", async () => {
    const f1 = await compte("comptoir@exemple.ch");
    await f("lier_parrainage('comptoir@exemple.ch', $1)", [code]);
    const id = await commande(f1, "comptoir@exemple.ch", "079 999 99 91", "95", "prete");
    await db.query("update commandes set statut_paiement = 'a_encaisser_retrait', moyen_paiement = 'comptoir' where id = $1", [id]);
    await db.query("update commandes set statut = 'terminee' where id = $1", [id]);
    expect(await parrainages(f1)).toBe(0);
    expect(await val<string>("select statut from parrainages where filleul_id = $1", [f1])).toBe("en_attente");
    await db.query("update commandes set statut_paiement = 'encaisse' where id = $1", [id]);
    expect([await parrainages(parrain), await parrainages(f1)]).toEqual([1000, 1000]);
  });
});
