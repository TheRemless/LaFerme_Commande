import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Carte gérée sans développeur, côté base (supabase/migrations/20261116090000_carte_gestion.sql) :
// plats ajoutés, archivage, catégories, ordre, photos envoyées, plat du jour. Aucun prix écrit ici n'est un prix de la carte :
// ce sont des montants d'essai.

let db: PGlite;
let gerant: string;
let service: string;

async function f<T>(sql: string, v: unknown[] = []): Promise<T> {
  return (await db.query<{ r: T }>(`select ${sql} as r`, v)).rows[0].r;
}
async function erreur(sql: string, v: unknown[] = []): Promise<string> {
  try {
    await f(sql, v);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return "aucune erreur";
}
async function plat(slug: string) {
  return (await db.query<Record<string, unknown>>("select * from plats where slug = $1", [slug])).rows[0];
}
async function publics(): Promise<string[]> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role anon");
    return (await tx.query<{ slug: string }>("select slug from carte_publique")).rows.map((r) => r.slug);
  });
}
async function dernierJournal() {
  return (await db.query<{ objet: string; cle: string; avant: unknown; apres: unknown }>("select objet, cle, avant, apres from journal_gestion order by id desc limit 1")).rows[0];
}

const COMPLET = {
  slug: "risotto-essai",
  categorie: "pates",
  nom: "Risotto d'essai",
  description: "Riz, courge.",
  prix_centimes: 1234,
  prix_valide: true,
  station: "cuisine",
  provenance: "",
  provenances_a_fournir: [],
  allergenes: "lait",
  retraits: ["courge"],
  groupes: [],
};

// JPEG minuscule (en-tête FF D8 FF suffit au contrôle de la base, le serveur produit le vrai fichier).
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]).toString("base64");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");

beforeEach(async () => {
  db = await creerBaseLocale();
  gerant = (await db.query<{ id: string }>("select id from personnel where email = 'equipe@laferme.test'")).rows[0].id;
  service = (await db.query<{ id: string }>("select id from personnel where email = 'equipe-bureau@laferme.test'")).rows[0].id;
});

describe("verrou de mise en ligne", () => {
  it("plats_bloquants donne exactement les mêmes motifs qu'avant la migration", async () => {
    const ancienne = `
      select p.slug, p.nom, 'prix à valider' as motif from plats p where p.commandable and p.prix_a_valider
      union all select p.slug, p.nom, 'allergènes manquants' from plats p where p.commandable and coalesce(p.allergenes, '') = ''
      union all select p.slug, p.nom, 'provenance à fournir' from plats p where p.commandable and cardinality(p.provenances_a_fournir) > 0
      union all select distinct p.slug, p.nom, 'supplément à valider : ' || o.nom from plats p
        join plat_groupes g on g.plat_id = p.id join options o on o.groupe_id = g.groupe_id and o.actif and o.prix_a_valider where p.commandable
      union all select distinct p.slug, p.nom, 'retraits à valider' from plats p join plat_retraits r on r.plat_id = p.id and r.a_valider where p.commandable`;
    const tri = "order by slug, motif";
    const avant = (await db.query(`select * from (${ancienne}) x ${tri}`)).rows;
    const apres = (await db.query(`select * from plats_bloquants ${tri}`)).rows;
    expect(avant.length).toBeGreaterThan(80);
    expect(apres).toEqual(avant);
  });

  it("un plat de la carte d'origine garde son comportement : commandable même incomplet", async () => {
    await f("modifier_plat('pizza-margherita', $1, $2)", [{ commandable: false }, gerant]);
    await f("modifier_plat('pizza-margherita', $1, $2)", [{ commandable: true }, gerant]);
    expect((await plat("pizza-margherita")).commandable).toBe(true);
  });
});

describe("ajouter un plat", () => {
  it("naît hors de la vente, dans sa catégorie, en dernier, journalisé", async () => {
    const r = await f<{ slug: string; commandable: boolean; manques: string[] }>("ajouter_plat($1, $2)", [COMPLET, gerant]);
    expect(r).toEqual({ slug: "risotto-essai", commandable: false, manques: [] });
    const p = await plat("risotto-essai");
    expect(p).toMatchObject({ nom: "Risotto d'essai", prix_centimes: 1234, prix_a_valider: false, commandable: false, origine: "gestion", station: "cuisine" });
    const max = await f<number>("(select max(p.ordre) from plats p join categories c on c.id = p.categorie_id where c.slug = 'pates')");
    expect(p.ordre).toBe(max);
    const retraits = (await db.query("select nom, a_valider from plat_retraits where plat_id = $1", [p.id])).rows;
    expect(retraits).toEqual([{ nom: "courge", a_valider: false }]);
    expect(await dernierJournal()).toMatchObject({ objet: "plat_ajoute", cle: "risotto-essai", avant: null });
    expect(await publics()).not.toContain("risotto-essai");
  });

  it("mis en vente tout de suite s'il est complet et qu'on le demande", async () => {
    const r = await f<{ commandable: boolean }>("ajouter_plat($1, $2)", [{ ...COMPLET, commandable: true }, gerant]);
    expect(r.commandable).toBe(true);
    expect(await publics()).toContain("risotto-essai");
  });

  it("reste hors de la vente tant qu'il manque un champ du verrou, et dit lequel", async () => {
    const r = await f<{ commandable: boolean; manques: string[] }>("ajouter_plat($1, $2)", [
      { ...COMPLET, prix_valide: false, allergenes: "", provenances_a_fournir: ["poulet"], groupes: ["supplements-pizza"], commandable: true },
      gerant,
    ]);
    expect(r.commandable).toBe(false);
    expect(r.manques.slice(0, 3)).toEqual(["prix à valider", "allergènes manquants", "provenance à fournir"]);
    expect(r.manques.some((m) => m.startsWith("supplément à valider"))).toBe(true);
    expect(await erreur("modifier_plat('risotto-essai', $1, $2)", [{ commandable: true }, gerant])).toContain("plat_incomplet: prix à valider");
  });

  it("ne peut pas repasser incomplet une fois en vente, mais la rupture de la tablette passe", async () => {
    await f("ajouter_plat($1, $2)", [{ ...COMPLET, commandable: true }, gerant]);
    expect(await erreur("modifier_plat('risotto-essai', $1, $2)", [{ allergenes: "" }, gerant])).toContain("plat_incomplet");
    // Nouveau prix sans validation : le plat sort de la vente (audit de sécurité 2, S2-02), puis revient validé.
    expect((await f<{ commandable: boolean }>("modifier_plat('risotto-essai', $1, $2)", [{ prix_centimes: 1500 }, gerant])).commandable).toBe(false);
    // Avec « Prix validé », le nouveau prix passe.
    await f("modifier_plat('risotto-essai', $1, $2)", [{ prix_centimes: 1500, prix_valide: true }, gerant]);
    expect((await plat("risotto-essai")).commandable).toBe(true);
    expect(await f<boolean>("regler_rupture('risotto-essai', true, $1)", [service])).toBe(true);
    // Un supplément à valider ajouté à un plat en vente est refusé.
    expect(await erreur("modifier_plat('risotto-essai', $1, $2)", [{ groupes: ["supplements-pizza"] }, gerant])).toContain("plat_incomplet: supplément à valider");
  });

  it("un slug déjà pris (ou vu dans une commande) reçoit un suffixe", async () => {
    await f("ajouter_plat($1, $2)", [COMPLET, gerant]);
    const r = await f<{ slug: string }>("ajouter_plat($1, $2)", [COMPLET, gerant]);
    expect(r.slug).toBe("risotto-essai-2");
    const r2 = await f<{ slug: string }>("ajouter_plat($1, $2)", [{ ...COMPLET, slug: "pizza-margherita" }, gerant]);
    expect(r2.slug).toBe("pizza-margherita-2");
  });

  it("refuse un membre du service, une catégorie inconnue, la catégorie du plat du jour, un groupe inconnu", async () => {
    expect(await erreur("ajouter_plat($1, $2)", [COMPLET, service])).toContain("Réservé au gérant");
    expect(await erreur("ajouter_plat($1, $2)", [{ ...COMPLET, categorie: "nulle-part" }, gerant])).toContain("categorie_inconnue");
    expect(await erreur("ajouter_plat($1, $2)", [{ ...COMPLET, categorie: "plat-du-jour" }, gerant])).toContain("categorie_inconnue");
    expect(await erreur("ajouter_plat($1, $2)", [{ ...COMPLET, groupes: ["inconnu"] }, gerant])).toContain("groupe_inconnu");
    expect(await erreur("ajouter_plat($1, $2)", [{ ...COMPLET, slug: "Pas Un Slug" }, gerant])).toContain("slug_invalide");
  });

  it("change de catégorie et de groupes d'options", async () => {
    await f("ajouter_plat($1, $2)", [COMPLET, gerant]);
    await f("modifier_plat('risotto-essai', $1, $2)", [{ categorie: "poissons", groupes: ["choix-pates"] }, gerant]);
    const r = await f<{ categories: { slug: string; plats: { slug: string; groupes: string[] }[] }[] }>("gestion_carte()");
    const poissons = r.categories.find((c) => c.slug === "poissons")!;
    expect(poissons.plats.find((p) => p.slug === "risotto-essai")?.groupes).toEqual(["choix-pates"]);
    expect(await erreur("modifier_plat('risotto-essai', $1, $2)", [{ categorie: "plat-du-jour" }, gerant])).toContain("categorie_inconnue");
  });
});

describe("retirer, archiver, remettre", () => {
  it("archiver retire de la vente et de la carte, sans toucher aux commandes passées ni à l'export", async () => {
    const c = (await db.query<{ id: string }>("select * from creer_commande($1)", [
      {
        jeton_suivi: "jeton-archive", cle_idempotence: "archive-1", mode: "retrait", statut: "nouvelle", statut_paiement: "a_encaisser_retrait",
        moyen_paiement: "comptoir", client_prenom: "A", client_nom: "B", client_telephone: "079 000 00 01", client_email: "a@laferme.test",
        quand_type: "asap", pizzas_seulement: true, sous_total_centimes: 1000, frais_centimes: 0, total_centimes: 1000, tva_centimes: 25,
        taux_tva_pourcent: 2.6, origine: "http://localhost:3000",
        lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 1000, total_centimes: 1000, choix: {}, retraits: [], note: "" }],
      },
    ])).rows[0];
    await f("marquer_encaisse($1, 'tablette:Test')", [c.id]);
    const jour = await f<string>("(select jour::text from commandes where id = $1)", [c.id]);
    const avant = await f<unknown[]>("export_ventes($1::date, $1::date)", [jour]);

    expect(await f<boolean>("archiver_plat('pizza-margherita', true, $1)", [gerant])).toBe(true);
    expect(await plat("pizza-margherita")).toMatchObject({ commandable: false });
    expect((await plat("pizza-margherita")).archive_le).not.toBeNull();
    expect(await publics()).not.toContain("pizza-margherita");
    expect(await erreur("modifier_plat('pizza-margherita', $1, $2)", [{ commandable: true }, gerant])).toContain("plat_archive");
    const ligne = (await db.query("select plat_slug, nom, unitaire_centimes from commande_lignes where commande_id = $1", [c.id])).rows[0];
    expect(ligne).toEqual({ plat_slug: "pizza-margherita", nom: "Pizza Margherita", unitaire_centimes: 1000 });
    expect(await f<unknown[]>("export_ventes($1::date, $1::date)", [jour])).toEqual(avant);
    // La tablette ne propose plus de le mettre en rupture.
    const tablette = await f<{ slug: string }[]>("plats_tablette()");
    expect(tablette.map((p) => p.slug)).not.toContain("pizza-margherita");

    expect(await f<boolean>("archiver_plat('pizza-margherita', false, $1)", [gerant])).toBe(true);
    expect((await plat("pizza-margherita")).archive_le).toBeNull();
    expect((await plat("pizza-margherita")).commandable).toBe(false);
    await f("modifier_plat('pizza-margherita', $1, $2)", [{ commandable: true }, gerant]);
    expect(await publics()).toContain("pizza-margherita");
    expect(await dernierJournal()).toMatchObject({ objet: "plat", cle: "pizza-margherita" });
  });

  it("création et archivage ne s'annulent pas depuis le journal, un changement de champ si", async () => {
    await f("ajouter_plat($1, $2)", [COMPLET, gerant]);
    const ajout = await f<number>("(select max(id)::int from journal_gestion)");
    expect(await erreur("annuler_journal($1, $2)", [ajout, gerant])).toContain("non_annulable");
    await f("archiver_plat('risotto-essai', true, $1)", [gerant]);
    const archive = await f<number>("(select max(id)::int from journal_gestion)");
    expect(await erreur("annuler_journal($1, $2)", [archive, gerant])).toContain("non_annulable");
    await f("modifier_plat('tiramisu', $1, $2)", [{ description: "Essai" }, gerant]);
    const modif = await f<number>("(select max(id)::int from journal_gestion)");
    await f("annuler_journal($1, $2)", [modif, gerant]);
    expect((await plat("tiramisu")).description).toBe("");
  });
});

describe("catégories et ordre", () => {
  it("ajoute, renomme, réordonne ; le plat du jour reste en tête", async () => {
    const s = await f<string>("ajouter_categorie('salades', 'Salades', $1)", [gerant]);
    expect(s).toBe("salades");
    expect(await erreur("ajouter_categorie('salades', 'salades', $1)", [gerant])).toContain("categorie_existe");
    expect(await f<boolean>("renommer_categorie('salades', 'Salades d''hiver', $1)", [gerant])).toBe(true);
    expect(await f<boolean>("renommer_categorie('plat-du-jour', 'Autre', $1)", [gerant])).toBe(false);
    await f("ordonner_categories($1, $2)", [["salades", "pizzas"], gerant]);
    const ordre = (await db.query<{ slug: string }>("select slug from categories order by ordre")).rows.map((r) => r.slug);
    expect(ordre.slice(0, 3)).toEqual(["plat-du-jour", "salades", "pizzas"]);
    expect(await f<number>("(select ordre from categories where slug = 'plat-du-jour')")).toBe(0);
    expect(await dernierJournal()).toMatchObject({ objet: "categorie", cle: "ordre" });
  });

  it("réordonne les plats d'une catégorie, ceux qui ne sont pas nommés suivent", async () => {
    await f("ordonner_plats('desserts', $1, $2)", [["tiramisu"], gerant]);
    const ordre = (await db.query<{ slug: string }>("select p.slug from plats p join categories c on c.id = p.categorie_id where c.slug = 'desserts' order by p.ordre")).rows;
    expect(ordre[0].slug).toBe("tiramisu");
    expect(new Set(ordre.map((_, i) => i)).size).toBe(ordre.length);
    expect(await f<boolean>("ordonner_plats('nulle-part', $1, $2)", [[], gerant])).toBe(false);
  });

  it("un supplément ajouté part à valider sauf validation explicite", async () => {
    expect(await f<boolean>("ajouter_option('supplements-pizza', 'Speck', 300, false, $1)", [gerant])).toBe(true);
    expect(await erreur("ajouter_option('supplements-pizza', 'speck', 300, false, $1)", [gerant])).toContain("option_existe");
    const o = (await db.query("select prix_a_valider, actif from options where nom = 'Speck'")).rows[0];
    expect(o).toEqual({ prix_a_valider: true, actif: true });
  });
});

describe("photos envoyées", () => {
  it("pose la photo, la sert, la remplace et efface l'ancienne, la retire", async () => {
    const nom = await f<string>("envoyer_photo('tiramisu', $1, 2133, 1600, $2)", [JPEG, gerant]);
    expect(nom).toMatch(/^[0-9a-f-]{36}\.jpg$/);
    expect((await plat("tiramisu")).photo).toBe(nom);
    expect(await f<string>("photo_plat($1)", [nom])).toBe(JPEG);
    expect(await dernierJournal()).toMatchObject({ objet: "photo", cle: "tiramisu", avant: { photo: "tiramisu.jpg" } });

    const nom2 = await f<string>("envoyer_photo('tiramisu', $1, 2133, 1600, $2)", [JPEG, gerant]);
    expect(await f<string | null>("photo_plat($1)", [nom])).toBeNull();
    expect(await f<number>("(select count(*)::int from photos_plats)")).toBe(1);

    // Revenir à une photo du shooting efface la photo envoyée.
    await f("modifier_plat('tiramisu', $1, $2)", [{ photo: "tiramisu.jpg" }, gerant]);
    expect(await f<number>("(select count(*)::int from photos_plats)")).toBe(0);
    expect(await f<string | null>("photo_plat($1)", [nom2])).toBeNull();

    await f("envoyer_photo('tiramisu', $1, 2133, 1600, $2)", [JPEG, gerant]);
    expect(await f<boolean>("retirer_photo('tiramisu', $1)", [gerant])).toBe(true);
    expect((await plat("tiramisu")).photo).toBeNull();
    expect(await f<number>("(select count(*)::int from photos_plats)")).toBe(0);
  });

  it("refuse ce qui n'est pas un JPEG, un membre du service, une photo inconnue", async () => {
    expect(await erreur("envoyer_photo('tiramisu', $1, 10, 10, $2)", [PNG, gerant])).toContain("photo_invalide");
    expect(await erreur("envoyer_photo('tiramisu', $1, 10, 10, $2)", [JPEG, service])).toContain("Réservé au gérant");
    expect(await f<string | null>("envoyer_photo('nulle-part', $1, 10, 10, $2)", [JPEG, gerant])).toBeNull();
    expect(await erreur("modifier_plat('tiramisu', $1, $2)", [{ photo: "00000000-0000-0000-0000-000000000000.jpg" }, gerant])).toContain("photo_inconnue");
    // Une photo envoyée pour un plat ne se pose pas sur un autre.
    const nom = await f<string>("envoyer_photo('tiramisu', $1, 10, 10, $2)", [JPEG, gerant]);
    expect(await erreur("modifier_plat('panna-cotta', $1, $2)", [{ photo: nom }, gerant])).toContain("photo_inconnue");
  });

  it("un visiteur ne lit ni la table des photos ni la fonction", async () => {
    await f("envoyer_photo('tiramisu', $1, 10, 10, $2)", [JPEG, gerant]);
    for (const role of ["anon", "authenticated"]) {
      expect(await f<boolean>("has_table_privilege($1, 'photos_plats', 'select')", [role])).toBe(false);
      expect(await f<boolean>("has_function_privilege($1, 'photo_plat(text)', 'execute')", [role])).toBe(false);
      expect(await f<boolean>("has_function_privilege($1, 'envoyer_photo(text, text, integer, integer, uuid)', 'execute')", [role])).toBe(false);
    }
  });
});

describe("plat du jour", () => {
  // La vue carte_publique lie now() à sa création : l'horloge de test ne la règle pas. On part donc
  // du vrai jour de Genève et on déplace la date du plat pour simuler le lendemain.
  let aujourdhui: string;
  let JOUR: Record<string, unknown>;
  const SLUG = "jour-essai";
  beforeEach(async () => {
    aujourdhui = await f<string>("((pg_catalog.now() at time zone 'Europe/Zurich')::date)::text");
    JOUR = { slug: SLUG, nom: "Osso buco d'essai", description: "", prix_centimes: 2500, station: "cuisine", jour: aujourdhui, service: "midi", allergenes: "céleri", commandable: true };
  });
  const decaler = (jours: number) => db.query("update plats set jour = jour + $1::int where slug = $2", [jours, SLUG]);

  it("s'affiche seulement le jour dit, en tête, puis disparaît seul", async () => {
    const r = await f<{ commandable: boolean }>("ajouter_plat_du_jour($1, $2)", [JOUR, gerant]);
    expect(r.commandable).toBe(true);
    expect(await publics()).toContain(SLUG);
    const ligne = await db.transaction(async (tx) => {
      await tx.exec("set local role anon");
      return (await tx.query<Record<string, unknown>>("select categorie_slug, categorie_ordre, jour_service from carte_publique where slug = $1", [SLUG])).rows[0];
    });
    expect(ligne).toMatchObject({ categorie_slug: "plat-du-jour", categorie_ordre: 0, jour_service: "midi" });
    expect((await f<{ slug: string }[]>("plats_tablette()")).map((p) => p.slug)).toContain(SLUG);

    // Prévu pour demain : pas encore affiché.
    await decaler(1);
    expect(await publics()).not.toContain(SLUG);
    // C'était hier : disparu, et ne bloque plus la mise en ligne.
    await decaler(-2);
    expect(await publics()).not.toContain(SLUG);
    expect((await f<{ slug: string }[]>("plats_tablette()")).map((p) => p.slug)).not.toContain(SLUG);
    expect(await f<number>("(select count(*)::int from plats_bloquants where slug = $1)", [SLUG])).toBe(0);
  });

  it("suit le verrou : sans allergènes, il n'est pas en vente ; son prix vaut dès la saisie", async () => {
    const r = await f<{ commandable: boolean; manques: string[] }>("ajouter_plat_du_jour($1, $2)", [{ ...JOUR, allergenes: "", prix_valide: false }, gerant]);
    expect(r).toMatchObject({ commandable: false, manques: ["allergènes manquants"] });
    expect(await publics()).not.toContain(SLUG);
    await f("modifier_plat($1, $2, $3)", [SLUG, { allergenes: "céleri", commandable: true }, gerant]);
    // Un prix changé dans la journée reste valable, sans case à cocher.
    await f("modifier_plat($1, $2, $3)", [SLUG, { prix_centimes: 2700 }, gerant]);
    expect(await plat(SLUG)).toMatchObject({ prix_centimes: 2700, prix_a_valider: false, commandable: true });
    expect(await publics()).toContain(SLUG);
  });

  it("refuse une date passée ou trop lointaine, un service inconnu, un membre du service", async () => {
    const decale = (n: number) => f<string>("(($1::date + $2::int)::text)", [aujourdhui, n]);
    expect(await erreur("ajouter_plat_du_jour($1, $2)", [{ ...JOUR, jour: await decale(-1) }, gerant])).toContain("jour_invalide");
    expect(await erreur("ajouter_plat_du_jour($1, $2)", [{ ...JOUR, jour: await decale(15) }, gerant])).toContain("jour_invalide");
    expect(await erreur("ajouter_plat_du_jour($1, $2)", [{ ...JOUR, service: "nuit" }, gerant])).toContain("service_invalide");
    expect(await erreur("ajouter_plat_du_jour($1, $2)", [JOUR, service])).toContain("Réservé au gérant");
  });

  it("le service se change, la catégorie non ; le back-office le liste à part", async () => {
    await f("ajouter_plat_du_jour($1, $2)", [JOUR, gerant]);
    expect(await f<boolean>("modifier_service_jour($1, 'journee', $2)", [SLUG, gerant])).toBe(true);
    expect(await erreur("modifier_plat($1, $2, $3)", [SLUG, { categorie: "pates" }, gerant])).toContain("categorie_inconnue");
    const g = await f<{ categories: { slug: string }[]; plats_du_jour: { slug: string; jour_service: string }[]; aujourdhui: string }>("gestion_carte()");
    expect(g.categories.map((c) => c.slug)).not.toContain("plat-du-jour");
    expect(g.plats_du_jour).toEqual([expect.objectContaining({ slug: SLUG, jour_service: "journee" })]);
    expect(g.aujourdhui).toBe(aujourdhui);
    expect(await dernierJournal()).toMatchObject({ objet: "plat_du_jour", cle: SLUG });
  });
});
