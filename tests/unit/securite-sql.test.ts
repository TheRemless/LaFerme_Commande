import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Correctifs de l'audit de sécurité côté base (docs/audits/securite.md).

let db: PGlite;
beforeAll(async () => {
  db = await creerBaseLocale();
});

let n = 0;
const h = () => (++n).toString(16).padStart(64, "0");
async function f<T>(sql: string, valeurs: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, valeurs)).rows[0].r;
}

describe("S1 : la vraie base n'a plus de membre d'équipe de test", () => {
  it("les migrations seules (ce que reçoit Supabase) ne laissent aucune adresse en .test dans le personnel", async () => {
    const racine = path.join(process.cwd(), "supabase");
    const base = new PGlite();
    await base.exec(await readFile(path.join(racine, "local", "roles.sql"), "utf8"));
    for (const fichier of (await readdir(path.join(racine, "migrations"))).filter((x) => x.endsWith(".sql")).sort()) {
      await base.exec(await readFile(path.join(racine, "migrations", fichier), "utf8"));
    }
    await base.exec(await readFile(path.join(racine, "seed.sql"), "utf8"));
    const restants = (await base.query<{ email: string }>("select email from personnel where email like '%.test'")).rows;
    expect(restants).toEqual([]);
    await base.close();
  });

  it("la base embarquée garde les comptes de test des essais", async () => {
    expect(await f<string>("(select role from personnel where email = 'equipe@laferme.test')")).toBe("gerant");
  });
});

describe("S8 : un visiteur n'a aucun droit d'écriture, même sans la sécurité par ligne", () => {
  it("retire insert, update et delete à anon et authenticated sur les tables lisibles", async () => {
    const tables = ["categories", "plats", "groupes_options", "options", "plat_groupes", "plat_retraits", "zones_livraison", "zone_npa", "horaires", "fermetures", "reglages"];
    const ouverts: string[] = [];
    for (const role of ["anon", "authenticated"]) {
      for (const t of tables) {
        for (const droit of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
          if (await f<boolean>(`has_table_privilege('${role}', '${t}', '${droit}')`)) ouverts.push(`${role} ${t} ${droit}`);
        }
      }
      expect(await f<boolean>(`has_table_privilege('${role}', 'plats', 'SELECT')`)).toBe(true);
    }
    expect(ouverts).toEqual([]);
  });
});

describe("S4 : plafond d'essais faux par e-mail sur 24 heures", () => {
  // Laisse passer la limite d'envoi (5 codes par heure) pour simuler une journée d'essais.
  const ouvrirEnvois = () => db.query("delete from tentatives_connexion where action = 'envoi_email'");
  const sansDelai = () => db.query("update codes_connexion set prochain_essai_le = now()");

  for (const cas of [
    { nom: "client", email: "cible@exemple.test", demander: "demander_code", verifier: "verifier_code_limite" },
    { nom: "personnel", email: "equipe@laferme.test", demander: "demander_code_personnel", verifier: "verifier_code_personnel_limite" },
  ]) {
    it(`bloque l'e-mail d'un ${cas.nom} après 15 essais faux, même depuis des IP différentes`, async () => {
      const cleEmail = h();
      for (let code = 0; code < 3; code++) {
        await ouvrirEnvois();
        expect(await f<number>(`${cas.demander}($1, $2, $3, $4, 'ip')`, [cas.email, cleEmail, h(), h()])).toBe(0);
        for (let essai = 0; essai < 5; essai++) {
          await sansDelai();
          const r = await f<{ statut: string }>(`${cas.verifier}($1, $2, $3, $4, 'ip', $5)`, [cas.email, cleEmail, h(), h(), h()]);
          expect(r.statut).toBe("invalide");
        }
      }
      await ouvrirEnvois();
      const bon = h();
      expect(await f<number>(`${cas.demander}($1, $2, $3, $4, 'ip')`, [cas.email, cleEmail, h(), bon])).toBe(0);
      const r = await f<{ statut: string; attente: number }>(`${cas.verifier}($1, $2, $3, $4, 'ip', $5)`, [cas.email, cleEmail, h(), bon, h()]);
      expect(r.statut).toBe("attente");
      expect(r.attente).toBeGreaterThan(20 * 3600);
    });
  }

  it("laisse passer un bon code après quelques erreurs", async () => {
    const cleEmail = h();
    const bon = h();
    await ouvrirEnvois();
    await f("demander_code($1, $2, $3, $4, 'ip')", ["distrait@exemple.test", cleEmail, h(), bon]);
    expect((await f<{ statut: string }>("verifier_code_limite($1, $2, $3, $4, 'ip', $5)", ["distrait@exemple.test", cleEmail, h(), h(), h()])).statut).toBe("invalide");
    await sansDelai();
    expect((await f<{ statut: string }>("verifier_code_limite($1, $2, $3, $4, 'ip', $5)", ["distrait@exemple.test", cleEmail, h(), bon, h()])).statut).toBe("ok");
  });

  it("garde ces fonctions réservées au serveur", async () => {
    for (const fn of ["verifier_code_limite(text, text, text, text, text, text, text, text)", "verifier_code_personnel_limite(text, text, text, text, text, text, text)", "limite_comptoir(text, text, text, text)"]) {
      expect(await f<boolean>(`has_function_privilege('anon', '${fn}', 'EXECUTE')`)).toBe(false);
      expect(await f<boolean>(`has_function_privilege('authenticated', '${fn}', 'EXECUTE')`)).toBe(false);
    }
  });
});

describe("S5 : commandes au comptoir limitées", () => {
  let k = 0;
  async function commandeComptoir(telephone: string, email: string, cle = `comptoir-${++k}-${Date.now()}`) {
    await f("(select id from creer_commande($1))", [
      {
        jeton_suivi: `jeton-${cle}`,
        cle_idempotence: cle,
        mode: "retrait",
        statut: "nouvelle",
        statut_paiement: "a_encaisser_retrait",
        moyen_paiement: "comptoir",
        client_prenom: "Test",
        client_nom: "Comptoir",
        client_telephone: telephone,
        client_email: email,
        quand_type: "asap",
        pizzas_seulement: true,
        sous_total_centimes: 1800,
        frais_centimes: 0,
        total_centimes: 1800,
        tva_centimes: 46,
        taux_tva_pourcent: 2.6,
        origine: "http://localhost:3000",
        lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 1800, total_centimes: 1800, choix: {}, retraits: [], note: "" }],
      },
    ]);
    return cle;
  }
  const limite = (telephone: string, email: string, ip: string, cle: string) => f<string>("limite_comptoir($1, $2, $3, $4)", [telephone, email, ip, cle]);

  it("refuse une troisième commande à retirer pour le même téléphone ou le même e-mail", async () => {
    await commandeComptoir("079 111 11 11", "a@exemple.test");
    const deuxieme = await commandeComptoir("+41 79 111 11 11".replace("+41 ", "0"), "b@exemple.test");
    expect(await limite("079.111.11.11", "c@exemple.test", h(), "nouvelle-cle-1")).toBe("contact");
    expect(await limite("079 222 22 22", "A@exemple.test", h(), "nouvelle-cle-2")).toBe("ok");
    // Un double clic sur une commande déjà enregistrée n'est pas une nouvelle commande.
    expect(await limite("079 111 11 11", "b@exemple.test", h(), deuxieme)).toBe("ok");
  });

  it("libère le téléphone une fois la commande retirée", async () => {
    await commandeComptoir("079 333 33 33", "d@exemple.test");
    await commandeComptoir("079 333 33 33", "d@exemple.test");
    expect(await limite("079 333 33 33", "d@exemple.test", h(), "nouvelle-cle-3")).toBe("contact");
    await db.query("update commandes set statut = 'terminee' where client_telephone = '079 333 33 33'");
    expect(await limite("079 333 33 33", "d@exemple.test", h(), "nouvelle-cle-4")).toBe("ok");
  });

  it("refuse la sixième commande au comptoir de la même connexion dans l'heure", async () => {
    const ip = h();
    for (let i = 0; i < 5; i++) expect(await limite(`079 444 44 0${i}`, `ip${i}@exemple.test`, ip, `cle-ip-${i}`)).toBe("ok");
    expect(await limite("079 444 44 09", "ip9@exemple.test", ip, "cle-ip-9")).toBe("ip");
  });
});
