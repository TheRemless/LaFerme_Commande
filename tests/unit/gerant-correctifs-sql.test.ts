import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Correctifs de l'audit « journée du gérant » côté base (docs/audits/gerant.md) : équipe (G03),
// remboursement après coup (G02), commandes passées (G04), retard du soir et remise à zéro (G05, G06).
// Même horloge réglable que tests/unit/service-correctifs-sql.test.ts.

let db: PGlite;

async function horloge(iso: string) {
  await db.query("delete from horloge_test where true");
  await db.query("insert into horloge_test values ($1::timestamptz)", [iso]);
}
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
async function id(email: string): Promise<string> {
  return (await db.query<{ id: string }>("select id from personnel where email = $1", [email])).rows[0].id;
}
async function reglage<T>(cle: string): Promise<T> {
  return (await db.query<{ v: T }>("select valeur as v from reglages where cle = $1", [cle])).rows[0].v;
}

let n = 0;
function commande(extra: Record<string, unknown> = {}) {
  n += 1;
  return {
    jeton_suivi: `jeton-g-${n}`,
    cle_idempotence: `g-${n}`,
    mode: "retrait",
    statut: "paiement_en_attente",
    statut_paiement: "en_attente",
    moyen_paiement: "en_ligne",
    client_prenom: `Prénom${n}`,
    client_nom: n % 2 ? "Dupont" : "Rossi",
    client_telephone: `079 123 45 ${String(n).padStart(2, "0")}`,
    client_email: "g@laferme.test",
    quand_type: "asap",
    pizzas_seulement: false,
    sous_total_centimes: 6000,
    frais_centimes: 0,
    total_centimes: 6000,
    tva_centimes: 152,
    taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    lignes: [
      { slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 2, unitaire_centimes: 2100, total_centimes: 4200, choix: {}, retraits: [], note: "" },
      { slug: "lasagne-de-boeuf", nom: "Lasagne de bœuf", station: "cuisine", qte: 1, unitaire_centimes: 1800, total_centimes: 1800, choix: {}, retraits: [], note: "" },
    ],
    ...extra,
  };
}

// Commande payée en ligne, acceptée puis menée jusqu'à « vers ».
async function payee(vers: "nouvelle" | "acceptee" | "prete" | "terminee" = "terminee", extra: Record<string, unknown> = {}) {
  const c = (await db.query<{ id: string; numero: number }>("select * from creer_commande($1)", [commande(extra)])).rows[0];
  await db.query("update commandes set cree_le = now() where id = $1", [c.id]);
  await f("appliquer_paiement($1, $2, 'paye', 'pi_g', 6000)", [`evt-${c.id}`, c.id]);
  const etapes = ["acceptee", "prete", "terminee"];
  for (const e of etapes.slice(0, etapes.indexOf(vers) + 1)) {
    await f("changer_statut($1, $2, 'tablette:Test', $3)", [c.id, e, e === "acceptee" ? new Date().toISOString() : null]);
  }
  return c;
}

let gerant: string;
let service: string;

beforeEach(async () => {
  db = await creerBaseLocale();
  await db.exec(`
    create table horloge_test (t timestamptz);
    create function public.now() returns timestamptz language sql stable as $$ select coalesce((select t from horloge_test limit 1), transaction_timestamp()) $$;
    set search_path = public, pg_catalog;
  `);
  gerant = await id("equipe@laferme.test");
  service = await id("equipe-bureau@laferme.test");
});

describe("G03 : l'équipe dans le back-office", () => {
  it("le gérant ajoute un membre, qui peut alors recevoir un code", async () => {
    const nouveau = await f<string>("ajouter_personnel($1, $2, 'service', $3)", ["Marco@Exemple.ch ", "Marco", gerant]);
    expect(nouveau).toMatch(/^[0-9a-f-]{36}$/);
    const liste = await f<{ email: string; nom: string; role: string; actif: boolean }[]>("liste_personnel($1)", [gerant]);
    expect(liste.find((p) => p.email === "marco@exemple.ch")).toMatchObject({ nom: "Marco", role: "service", actif: true });
    const j = (await db.query<{ objet: string; cle: string }>("select objet, cle from journal_gestion order by id desc limit 1")).rows[0];
    expect(j).toEqual({ objet: "personnel", cle: "marco@exemple.ch" });
  });

  it("refuse un membre du service, une adresse illisible, un doublon actif", async () => {
    expect(await erreur("ajouter_personnel('a@b.ch', 'A', 'service', $1)", [service])).toContain("Réservé au gérant");
    expect(await erreur("liste_personnel($1)", [service])).toContain("Réservé au gérant");
    expect(await erreur("ajouter_personnel('pas-une-adresse', 'A', 'service', $1)", [gerant])).toContain("adresse_invalide");
    expect(await erreur("ajouter_personnel('equipe-bureau@laferme.test', 'A', 'service', $1)", [gerant])).toContain("deja_membre");
    expect(await erreur("ajouter_personnel('x@y.ch', 'A', 'patron', $1)", [gerant])).toContain("role_invalide");
  });

  it("retirer un membre coupe ses sessions tout de suite, le réinscrire le réactive", async () => {
    await db.query(
      "insert into sessions_personnel (personnel_id, jeton_hache, expire_le) values ($1, 'h-1', now() + interval '30 days'), ($1, 'h-2', now() + interval '30 days')",
      [service],
    );
    expect(await f("personnel_de_session('h-1')")).not.toBeNull();
    expect(await f<boolean>("modifier_personnel($1, $2, $3)", [service, { actif: false }, gerant])).toBe(true);
    expect(await f("personnel_de_session('h-1')")).toBeNull();
    const ouvertes = (await db.query<{ n: number }>("select count(*)::int as n from sessions_personnel where personnel_id = $1 and revoquee_le is null", [service])).rows[0].n;
    expect(ouvertes).toBe(0);
    await f("ajouter_personnel('equipe-bureau@laferme.test', 'Test bureau', 'gerant', $1)", [gerant]);
    const p = (await db.query<{ actif: boolean; role: string }>("select actif, role from personnel where id = $1", [service])).rows[0];
    expect(p).toEqual({ actif: true, role: "gerant" });
  });

  it("change le rôle et coupe les sessions sans retirer", async () => {
    expect(await f<boolean>("modifier_personnel($1, $2, $3)", [service, { role: "gerant" }, gerant])).toBe(true);
    expect(await f<string>("gerant_nom($1)", [service])).toBe("Test bureau");
    await db.query("insert into sessions_personnel (personnel_id, jeton_hache, expire_le) values ($1, 'h-3', now() + interval '30 days')", [service]);
    expect(await f<number>("couper_sessions_personnel($1, $2)", [service, gerant])).toBe(1);
    expect(await f("personnel_de_session('h-3')")).toBeNull();
    expect((await db.query<{ actif: boolean }>("select actif from personnel where id = $1", [service])).rows[0].actif).toBe(true);
  });

  it("impossible de retirer ou de rétrograder le dernier gérant", async () => {
    await db.query("update personnel set actif = false where role = 'gerant' and id <> $1", [gerant]);
    expect(await erreur("modifier_personnel($1, $2, $1)", [gerant, { actif: false }])).toContain("dernier_gerant");
    expect(await erreur("modifier_personnel($1, $2, $1)", [gerant, { role: "service" }])).toContain("dernier_gerant");
    expect(await f<string>("gerant_nom($1)", [gerant])).toBe("Équipe test");
  });
});

describe("G02 : remboursement après coup", () => {
  it("rembourse une partie, puis le reste, jamais plus que le total", async () => {
    await horloge("2026-11-14T19:00:00Z");
    const c = await payee("terminee");
    const r1 = await f<{ id: string; statut: string; moyen: string; deja: boolean }>("demander_remboursement($1, 2100, 'Pizza froide', 'cle-test-r1', $2)", [c.id, gerant]);
    expect(r1).toMatchObject({ statut: "en_cours", moyen: "stripe", deja: false });
    await f("terminer_remboursement($1, true, 're_1', null)", [r1.id]);
    expect(await erreur("demander_remboursement($1, 4000, 'Le reste', 'cle-test-r2', $2)", [c.id, gerant])).toContain("montant_trop_eleve");
    const r2 = await f<{ id: string }>("demander_remboursement($1, 3900, 'Le reste', 'cle-test-r3', $2)", [c.id, gerant]);
    await f("terminer_remboursement($1, true, 're_2', null)", [r2.id]);
    const cmd = (await db.query<{ statut_paiement: string; statut: string }>("select statut_paiement, statut from commandes where id = $1", [c.id])).rows[0];
    expect(cmd).toEqual({ statut_paiement: "rembourse", statut: "terminee" });
    expect(await erreur("demander_remboursement($1, 1, 'Encore', 'cle-test-r4', $2)", [c.id, gerant])).toMatch(/pas_encaissee|montant_trop_eleve/);
  });

  it("même clé, même remboursement : un double appui ne rembourse pas deux fois", async () => {
    const c = await payee("prete");
    const a = await f<{ id: string; deja: boolean }>("demander_remboursement($1, 1000, 'Oubli', 'cle-test-double', $2)", [c.id, gerant]);
    const b = await f<{ id: string; deja: boolean }>("demander_remboursement($1, 1000, 'Oubli', 'cle-test-double', $2)", [c.id, gerant]);
    expect(b).toMatchObject({ id: a.id, deja: true });
    const nb = (await db.query<{ n: number }>("select count(*)::int as n from remboursements where commande_id = $1", [c.id])).rows[0].n;
    expect(nb).toBe(1);
    expect(await erreur("demander_remboursement($1, 2000, 'Oubli', 'cle-test-double', $2)", [c.id, gerant])).toContain("cle_reutilisee");
  });

  it("un échec ne compte pas dans le montant déjà remboursé", async () => {
    const c = await payee("terminee");
    const r = await f<{ id: string }>("demander_remboursement($1, 6000, 'Tout', 'cle-test-e1', $2)", [c.id, gerant]);
    await f("terminer_remboursement($1, false, null, 'Stripe ne répond pas')", [r.id]);
    const r2 = await f<{ statut: string }>("demander_remboursement($1, 6000, 'Tout', 'cle-test-e2', $2)", [c.id, gerant]);
    expect(r2.statut).toBe("en_cours");
  });

  it("réservé au gérant, après « Prête », « Partie » ou « Terminée » seulement", async () => {
    const c = await payee("terminee");
    expect(await erreur("demander_remboursement($1, 100, 'Test', 'cle-test-s1', $2)", [c.id, service])).toContain("Réservé au gérant");
    const neuve = await payee("acceptee");
    expect(await erreur("demander_remboursement($1, 100, 'Test', 'cle-test-s2', $2)", [neuve.id, gerant])).toContain("statut_non_remboursable");
    expect(await erreur("demander_remboursement($1, 0, 'Test', 'cle-test-s3', $2)", [c.id, gerant])).toContain("montant_invalide");
    expect(await erreur("demander_remboursement($1, 100, '', 'cle-test-s4', $2)", [c.id, gerant])).toContain("motif_invalide");
  });

  it("au comptoir, le remboursement est noté en espèces et fait tout de suite", async () => {
    const c = (await db.query<{ id: string }>("select * from creer_commande($1)", [
      commande({ statut: "nouvelle", statut_paiement: "a_encaisser_retrait", moyen_paiement: "comptoir" }),
    ])).rows[0];
    await f("changer_statut($1, 'acceptee', 'tablette:Test', now())", [c.id]);
    await f("changer_statut($1, 'prete', 'tablette:Test')", [c.id]);
    await f("marquer_encaisse($1, 'tablette:Test')", [c.id]);
    const r = await f<{ moyen: string; statut: string }>("demander_remboursement($1, 2100, 'Erreur de plat', 'cle-test-c1', $2)", [c.id, gerant]);
    expect(r).toMatchObject({ moyen: "especes", statut: "fait" });
  });

  it("l'export retire le remboursé des ventes, au jour du remboursement", async () => {
    await horloge("2026-11-14T19:00:00Z");
    const c = await payee("terminee");
    const r = await f<{ id: string }>("demander_remboursement($1, 2100, 'Pizza froide', 'cle-test-x1', $2)", [c.id, gerant]);
    await horloge("2026-11-17T10:00:00Z");
    await f("terminer_remboursement($1, true, 're_x', null)", [r.id]);
    const novembre = await f<{ montant_centimes: number; tva_centimes: number; jour: string; numero: number }[]>("export_remboursements('2026-11-01', '2026-11-30')");
    expect(novembre).toHaveLength(1);
    expect(novembre[0]).toMatchObject({ montant_centimes: 2100, tva_centimes: 53, jour: "2026-11-17", numero: c.numero });
    expect(await f<unknown[]>("export_remboursements('2026-11-01', '2026-11-16')")).toHaveLength(0);
    // La vente reste dans sa période : seul le remboursement la diminue.
    const ventes = await f<{ numero: number }[]>("export_ventes('2026-11-14', '2026-11-14')");
    expect(ventes.map((v) => v.numero)).toContain(c.numero);
  });

  it("une commande remboursée en entier après coup reste une vente, avec son remboursement", async () => {
    const c = await payee("terminee");
    const r = await f<{ id: string }>("demander_remboursement($1, 6000, 'Tout', 'cle-test-t1', $2)", [c.id, gerant]);
    await f("terminer_remboursement($1, true, 're_t', null)", [r.id]);
    const jour = (await db.query<{ j: string }>("select jour::text as j from commandes where id = $1", [c.id])).rows[0].j;
    const ventes = await f<{ numero: number }[]>("export_ventes($1, $1)", [jour]);
    expect(ventes.map((v) => v.numero)).toContain(c.numero);
  });
});

describe("G04 : commandes passées", () => {
  it("cherche par numéro, nom ou téléphone et compte par jour", async () => {
    await horloge("2026-11-13T19:00:00Z");
    const a = await payee("terminee");
    const b = await payee("terminee");
    await horloge("2026-11-14T19:00:00Z");
    await payee("terminee");
    const parNom = await f<{ id: string }[]>("commandes_gestion(null, null, 'rossi')");
    expect(parNom.map((x) => x.id)).toContain(b.id);
    expect(parNom.map((x) => x.id)).not.toContain(a.id);
    const tel = (await db.query<{ t: string }>("select client_telephone as t from commandes where id = $1", [a.id])).rows[0].t.replace(/\D/g, "");
    const parTel = await f<{ id: string }[]>("commandes_gestion(null, null, $1)", [tel]);
    expect(parTel.map((x) => x.id)).toEqual([a.id]);
    const parNumero = await f<{ numero: number }[]>("commandes_gestion('2026-11-13', '2026-11-13', $1)", [String(a.numero)]);
    expect(parNumero.map((x) => x.numero)).toContain(a.numero);
    const jour = await f<{ id: string }[]>("commandes_gestion('2026-11-13', '2026-11-13', null)");
    expect(jour).toHaveLength(2);
    const jours = await f<{ jour: string; commandes: number; ventes_centimes: number }[]>("jours_gestion('2026-11-13', '2026-11-14')");
    expect(jours.find((j) => j.jour === "2026-11-13")).toMatchObject({ commandes: 2, ventes_centimes: 12000 });
    expect(jours.find((j) => j.jour === "2026-11-14")).toMatchObject({ commandes: 1, ventes_centimes: 6000 });
  });

  it("donne la fiche d'une commande avec ses lignes, son historique et ses remboursements", async () => {
    const c = await payee("terminee");
    const r = await f<{ id: string }>("demander_remboursement($1, 1000, 'Geste', 'cle-test-f1', $2)", [c.id, gerant]);
    await f("terminer_remboursement($1, true, 're_f', null)", [r.id]);
    const fiche = await f<{ numero: number; lignes: unknown[]; evenements: unknown[]; remboursements: { montant_centimes: number }[]; rembourse_centimes: number }>(
      "commande_gestion($1)",
      [c.id],
    );
    expect(fiche.lignes).toHaveLength(2);
    expect(fiche.evenements.length).toBeGreaterThanOrEqual(3);
    expect(fiche.remboursements[0].montant_centimes).toBe(1000);
    expect(fiche.rembourse_centimes).toBe(1000);
  });
});

describe("G05 et G06 : retard du soir et remise à zéro chaque nuit", () => {
  it("le retard se règle de la tablette et revient à zéro la nuit, comme la livraison fermée et la pause sans fin", async () => {
    await horloge("2026-11-14T19:00:00Z");
    // La migration date la dernière remise du jour où elle est appliquée (horloge réelle) : on cale ici
    // la remise sur le samedi simulé, puis un second passage le même jour ne remet rien à zéro.
    await f("remise_du_jour()");
    expect(await f("remise_du_jour()")).toBeNull();
    await f("regler_service($1, null)", [{ retard_minutes: 20, livraison_fermee: true, pause_jusqu_a: "sans-fin" }]);
    expect(await reglage<number>("retard_minutes")).toBe(20);
    await horloge("2026-11-14T22:30:00Z");
    expect(await f("remise_du_jour()")).toBeNull();
    // 5h du matin à Genève : nouveau jour de service.
    await horloge("2026-11-15T04:05:00Z");
    expect(await f("remise_du_jour()")).not.toBeNull();
    expect(await reglage<number>("retard_minutes")).toBe(0);
    expect(await reglage<boolean>("livraison_fermee")).toBe(false);
    expect(await reglage<unknown>("pause_jusqu_a")).toBeNull();
    expect(await f("remise_du_jour()")).toBeNull();
  });

  it("garde une pause automatique (tablette muette) : on la lève à la main", async () => {
    await horloge("2026-11-14T19:00:00Z");
    await f("remise_du_jour()");
    expect(await f<boolean>("pause_automatique()")).toBe(true);
    await horloge("2026-11-15T09:00:00Z");
    await f("remise_du_jour()");
    expect(await reglage<string>("pause_jusqu_a")).toBe("sans-fin");
  });

  it("refuse un retard hors limites", async () => {
    expect(await erreur("regler_service($1, null)", [{ retard_minutes: 200 }])).toContain("Retard");
  });
});

describe("créneaux pleins pour le sélecteur d'heure", () => {
  it("liste les créneaux pleins par mode, sans rien sur les clients", async () => {
    await db.query("update reglages set valeur = '1' where cle = 'capacite_retraits_par_creneau'");
    await db.query("select * from creer_commande($1)", [
      commande({ statut: "nouvelle", statut_paiement: "a_encaisser_retrait", moyen_paiement: "comptoir", quand_type: "creneau", quand_date: "2026-11-20", quand_minutes: 1170 }),
    ]);
    const pleins = await f<Record<string, unknown>[]>("creneaux_pleins('2026-11-19', '2026-11-21')");
    expect(pleins).toEqual([{ date: "2026-11-20", mode: "retrait", minutes: 1170 }]);
    expect(await f<unknown[]>("creneaux_pleins('2026-11-21', '2026-11-22')")).toEqual([]);
  });
});

describe("revue de code du lot gérant", () => {
  it("trouve un téléphone tapé au format international", async () => {
    const a = await payee("terminee");
    const tel = (await db.query<{ t: string }>("select client_telephone as t from commandes where id = $1", [a.id])).rows[0].t;
    const national = tel.replace(/\D/g, "");
    for (const forme of [`+41 ${national.slice(1)}`, `0041${national.slice(1)}`]) {
      const r = await f<{ id: string }[]>("commandes_gestion(null, null, $1)", [forme]);
      expect(r.map((x) => x.id)).toContain(a.id);
    }
  });

  it("réinscrire un ancien membre ne rouvre pas ses vieilles sessions", async () => {
    await db.query("insert into sessions_personnel (personnel_id, jeton_hache, expire_le) values ($1, 'h-vieille', now() + interval '30 days')", [service]);
    // Retrait à l'ancienne, en SQL, sans couper les sessions.
    await db.query("update personnel set actif = false where id = $1", [service]);
    await f("ajouter_personnel('equipe-bureau@laferme.test', 'Test bureau', 'service', $1)", [gerant]);
    expect(await f("personnel_de_session('h-vieille')")).toBeNull();
  });

  it("la fiche donne la clé d'un remboursement resté en cours, pour le relancer", async () => {
    const c = await payee("terminee");
    await f("demander_remboursement($1, 1000, 'Coupure', 'cle-test-relance', $2)", [c.id, gerant]);
    const fiche = await f<{ remboursements: { cle: string; statut: string }[] }>("commande_gestion($1)", [c.id]);
    expect(fiche.remboursements[0]).toMatchObject({ cle: "cle-test-relance", statut: "en_cours" });
  });
});
