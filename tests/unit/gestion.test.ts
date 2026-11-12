import { readdirSync, readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";
import { centimes, champsHoraire, champsPlat, champsZone, csvVentes, type Vente } from "@/lib/gestion";
import { lireTableau, type CarteActuelle } from "@/lib/gestion-import";
import { PHOTOS } from "@/lib/photos";

let db: PGlite;
let gerant: string;
let service: string;
beforeAll(async () => {
  db = await creerBaseLocale();
  gerant = (await db.query<{ id: string }>("select id from personnel where email = 'equipe@laferme.test'")).rows[0].id;
  service = (await db.query<{ id: string }>("select id from personnel where email = 'equipe-bureau@laferme.test'")).rows[0].id;
});
async function f<T>(sql: string, valeurs: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, valeurs)).rows[0].r;
}

describe("contrôle des champs", () => {
  it("lit les prix en francs", () => {
    expect(centimes("18")).toBe(1800);
    expect(centimes("4,50")).toBe(450);
    expect(centimes(19.5)).toBe(1950);
    expect(centimes("4.505")).toBeNull();
    expect(centimes("-1")).toBeNull();
    expect(centimes("abc")).toBeNull();
  });

  it("refuse une photo hors du shooting, une station inconnue, un prix illisible", () => {
    expect(champsPlat({ photo: "../../etc/passwd" })).toMatchObject({ ok: false });
    expect(champsPlat({ station: "bar" })).toMatchObject({ ok: false });
    expect(champsPlat({ prix: "dix" })).toMatchObject({ ok: false });
    expect(champsPlat({ prix: "18", prix_valide: true, photo: "" })).toEqual({ ok: true, valeur: { prix_centimes: 1800, prix_valide: true, photo: "" } });
    expect(champsPlat({ inconnu: 1 })).toMatchObject({ ok: false });
  });

  it("contrôle zones et horaires", () => {
    expect(champsZone({ delai_min: 50, delai_max: 40 })).toMatchObject({ ok: false });
    expect(champsZone({ frais: "2.90", active: true })).toEqual({ ok: true, valeur: { frais_centimes: 290, active: true } });
    expect(champsHoraire({ premiere_heure: "18:45", derniere_heure: "22:45", derniere_commande: "21:30", derniere_commande_pizzas: "22:15" })).toMatchObject({ ok: true });
    expect(champsHoraire({ premiere_heure: "22:45", derniere_heure: "18:45", derniere_commande: "21:30", derniere_commande_pizzas: "22:15" })).toMatchObject({ ok: false });
    expect(champsHoraire({ premiere_heure: "18h45" })).toMatchObject({ ok: false });
  });

  it("la liste des photos suit le dossier public/plats", () => {
    expect([...PHOTOS].sort()).toEqual(readdirSync("public/plats").sort());
  });
});

describe("fonctions SQL du back-office", () => {
  it("réservées au gérant", async () => {
    await expect(f("modifier_plat('pizza-margherita', $1, $2)", [{ prix_centimes: 100 }, service])).rejects.toThrow(/gérant/);
    await expect(f("modifier_zone(1::smallint, $1, $2)", [{ frais_centimes: 0 }, service])).rejects.toThrow(/gérant/);
  });

  it("modifie un plat, remet le prix à valider s'il change sans validation, et journalise avant et après", async () => {
    await f("modifier_plat('pizza-prosciutto', $1, $2)", [{ prix_centimes: 2100, prix_valide: true }, gerant]);
    const valide = (await db.query<{ prix_a_valider: boolean }>("select prix_a_valider from plats where slug = 'pizza-prosciutto'")).rows[0];
    expect(valide.prix_a_valider).toBe(false);
    await f("modifier_plat('pizza-prosciutto', $1, $2)", [{ prix_centimes: 2200 }, gerant]);
    const change = (await db.query<{ prix_a_valider: boolean; prix_centimes: number }>("select prix_a_valider, prix_centimes from plats where slug = 'pizza-prosciutto'")).rows[0];
    expect(change).toEqual({ prix_a_valider: true, prix_centimes: 2200 });
    const j = (await db.query<{ personnel_nom: string; avant: { prix_centimes: number }; apres: { prix_centimes: number } }>(
      "select personnel_nom, avant, apres from journal_gestion where objet = 'plat' and cle = 'pizza-prosciutto' order by id desc limit 1",
    )).rows[0];
    expect(j).toMatchObject({ personnel_nom: "Équipe test", avant: { prix_centimes: 2100 }, apres: { prix_centimes: 2200 } });
  });

  it("valide les retraits d'un plat", async () => {
    expect(await f<boolean>("modifier_retraits('pizza-margherita', $1, $2)", [["Origan"], gerant])).toBe(true);
    const r = (await db.query<{ nom: string; a_valider: boolean }>("select r.nom, r.a_valider from plat_retraits r join plats p on p.id = r.plat_id where p.slug = 'pizza-margherita'")).rows;
    expect(r).toEqual([{ nom: "Origan", a_valider: false }]);
  });

  it("l'import applique tout ou rien", async () => {
    const avant = (await db.query<{ prix_centimes: number }>("select prix_centimes from plats where slug = 'pizza-4-stagioni'")).rows[0];
    await expect(
      f("importer_validation($1, $2)", [{ plats: [{ slug: "pizza-4-stagioni", prix_centimes: 1, prix_valide: true }, { slug: "inexistant", prix_centimes: 1 }] }, gerant]),
    ).rejects.toThrow(/inconnu/);
    expect((await db.query<{ prix_centimes: number }>("select prix_centimes from plats where slug = 'pizza-4-stagioni'")).rows[0]).toEqual(avant);
  });

  it("valide une zone et un horaire (plus une proposition), ajoute et supprime une fermeture", async () => {
    expect(await f<boolean>("modifier_zone(1::smallint, $1, $2)", [{ frais_centimes: 300 }, gerant])).toBe(true);
    expect((await db.query<{ proposition: boolean }>("select proposition from zones_livraison where numero = 1")).rows[0].proposition).toBe(false);
    const h = (await db.query<{ id: number }>("select id from horaires order by id limit 1")).rows[0].id;
    expect(await f<boolean>("modifier_horaire($1::smallint, $2, $3)", [h, { premiere_heure: "11:30" }, gerant])).toBe(true);
    await f("ajouter_fermeture('2027-08-01', '2027-08-15', 'Vacances', $1)", [gerant]);
    const id = (await db.query<{ id: number }>("select id from fermetures where motif = 'Vacances'")).rows[0].id;
    expect(await f<boolean>("supprimer_fermeture($1::smallint, $2)", [id, gerant])).toBe(true);
    const objets = (await db.query<{ objet: string }>("select distinct objet from journal_gestion")).rows.map((x) => x.objet);
    expect(objets).toEqual(expect.arrayContaining(["zone", "horaire", "fermeture"]));
  });

  it("l'export ne garde que les ventes encaissées", async () => {
    const base = {
      mode: "retrait", moyen_paiement: "comptoir", client_prenom: "A", client_nom: "B", client_telephone: "079", client_email: "a@b.test",
      quand_type: "asap", pizzas_seulement: true, sous_total_centimes: 1000, frais_centimes: 0, total_centimes: 1000, tva_centimes: 25,
      taux_tva_pourcent: 2.6, origine: "http://localhost", lignes: [],
    };
    for (const [cle, statut, paiement] of [["e1", "terminee", "encaisse"], ["e2", "refusee", "rembourse"], ["e3", "nouvelle", "a_encaisser_retrait"], ["e4", "terminee", "paye"]]) {
      await db.query("select * from creer_commande($1)", [{ ...base, jeton_suivi: `j-${cle}`, cle_idempotence: `export-${cle}`, statut, statut_paiement: paiement }]);
    }
    const jour = (await db.query<{ j: string }>("select (now() at time zone 'Europe/Zurich')::date::text as j")).rows[0].j;
    const ventes = await f<Vente[]>("export_ventes($1, $1)", [jour]);
    expect(ventes.map((v) => v.paiement).sort()).toEqual(["comptoir", "en ligne"]);
    const csv = csvVentes(ventes);
    expect(csv.startsWith("﻿Jour;Numéro")).toBe(true);
    // Taux, ventes, total TTC, remboursé, net TTC, TVA nette, hors TVA net (audit du gérant, G02).
    expect(csv).toContain("2.6;2;20.00;0.00;20.00;0.50;19.50");
    expect(csv).not.toMatch(/a@b\.test|079/);
  });

  it("aucun droit pour un visiteur", async () => {
    for (const sql of ["select * from journal_gestion", "select gestion_carte()", "select export_ventes(current_date, current_date)"]) {
      await expect(
        db.transaction(async (tx) => {
          await tx.exec("set local role anon");
          await tx.query(sql);
        }),
      ).rejects.toThrow(/permission denied/);
    }
  });
});

describe("import du tableau de validation", () => {
  it("lit les cases remplies, ignore le reste et signale ce qui ne va pas", async () => {
    const carte = await f<CarteActuelle>("gestion_carte()");
    const fichier = readFileSync("tests/fixtures/validation-remplie.xlsx");
    const a = await lireTableau(fichier.buffer.slice(fichier.byteOffset, fichier.byteOffset + fichier.byteLength) as ArrayBuffer, carte);
    expect(a.plats.find((p) => p.slug === "pizza-margherita")).toMatchObject({ prix_centimes: 1950, prix_valide: true, allergenes: "test-allergenes" });
    expect(a.plats.find((p) => p.slug === "pizza-miss-italia")).toMatchObject({ provenance: "Jambon cru : Italie", provenances_a_fournir: [] });
    // Une provenance déjà en base, laissée telle quelle dans le tableau (avec sa source), ne change pas.
    expect(a.plats.find((p) => p.slug === "pizza-la-ferme")).toBeUndefined();
    expect(a.options).toEqual([{ groupe: "supplements-pizza", nom: "Ananas", prix_centimes: 250, prix_valide: true, actif: false }]);
    expect(a.avertissements.join("\n")).toMatch(/Plat inventé/);
    expect(a.avertissements.join("\n")).toMatch(/peut-être/);
    // Le tableau tel quel (cases jaunes vides) ne change aucun prix.
    const vierge = readFileSync("docs/validation-carte.xlsx");
    const b = await lireTableau(vierge.buffer.slice(vierge.byteOffset, vierge.byteOffset + vierge.byteLength) as ArrayBuffer, carte);
    expect(b.plats.some((p) => "prix_centimes" in p)).toBe(false);
    // Le tableau garde les anciens noms (« Pasta al pomodoro et basilico », « Pizza miss Italia ») :
    // depuis les noms harmonisés, chaque ligne retrouve encore son plat par le slug.
    expect(b.avertissements.filter((x) => x.includes("n'existe pas"))).toEqual([]);
  });
});
