import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Vague 3, bo-commandes : liste des commandes du back-office (filtres, tri, pagination côté serveur),
// fiche complète (chronologie, e-mails, livreur, tickets, notes) et notes internes. Horloge réglable
// comme dans gerant-vague2-sql.test.ts. Les montants viennent des commandes créées ici, jamais du seed.

let db: PGlite;
let gerant: string;
let service: string;
let livreur: string;

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
async function idPersonnel(email: string): Promise<string> {
  return (await db.query<{ id: string }>("select id from personnel where email = $1", [email])).rows[0].id;
}

let n = 0;
type Options = { mode?: "livraison" | "retrait"; total?: number; prenom?: string; nom?: string; tel?: string; email?: string; comptoir?: boolean; creneau?: { date: string; minutes: number } };
async function commande(o: Options = {}): Promise<string> {
  n += 1;
  const total = o.total ?? 2000 + n;
  const p = {
    jeton_suivi: `jeton-bo-${n}`, cle_idempotence: `bo-${n}`, mode: o.mode ?? "retrait",
    statut: o.comptoir ? "nouvelle" : "paiement_en_attente", statut_paiement: o.comptoir ? "a_encaisser_retrait" : "en_attente",
    moyen_paiement: o.comptoir ? "comptoir" : "en_ligne",
    client_prenom: o.prenom ?? `Client${n}`, client_nom: o.nom ?? "Test", client_telephone: o.tel ?? "079 000 00 00", client_email: o.email ?? `c${n}@laferme.test`,
    quand_type: o.creneau ? "creneau" : "asap", quand_date: o.creneau?.date ?? null, quand_minutes: o.creneau?.minutes ?? null,
    pizzas_seulement: false, sous_total_centimes: total, frais_centimes: 0, total_centimes: total, tva_centimes: 0, taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    ...(o.mode === "livraison" ? { adresse: { rue: "Route de Chancy", numero: "1", npa: "1213", localite: "Onex" }, details_livraison: { etage: "2", code: "1234", instructions: "Sonner deux fois" }, zone_numero: 1 } : {}),
    lignes: [{ slug: "lasagne-de-boeuf", nom: "Lasagne de bœuf", station: "cuisine", qte: 1, unitaire_centimes: total, total_centimes: total, choix: {}, retraits: [], note: "" }],
  };
  const id = (await db.query<{ id: string }>("select id from creer_commande($1)", [p])).rows[0].id;
  if (!o.comptoir) await f("appliquer_paiement($1, $2, 'paye', 'pi_bo', $3)", [`evt-${id}`, id, total]);
  return id;
}
async function accepter(id: string, heure: string) {
  expect(await f("changer_statut($1, 'acceptee', 'tablette:Test', $2::timestamptz)", [id, heure])).toBe(true);
}
type Page = { total: number; page: number; par_page: number; compteurs: Record<string, number>; lignes: Record<string, unknown>[] };
async function liste(p: Record<string, unknown> = {}): Promise<Page> {
  return f<Page>("liste_commandes_gestion($1)", [p]);
}

beforeEach(async () => {
  db = await creerBaseLocale();
  await db.exec(`
    create table horloge_test (t timestamptz);
    create function public.now() returns timestamptz language sql stable as $$ select coalesce((select t from horloge_test limit 1), transaction_timestamp()) $$;
    set search_path = public, pg_catalog;
  `);
  // Mardi 17 novembre 2026, 19h00 à Genève.
  await horloge("2026-11-17T18:00:00Z");
  gerant = await idPersonnel("gerant-bureau@laferme.test");
  service = await idPersonnel("equipe-bureau@laferme.test");
  livreur = await idPersonnel("marco@laferme.test");
});

describe("liste des commandes : pagination et filtres côté serveur", () => {
  it("pagine, compte le total et garde l'ordre du plus récent au plus ancien", async () => {
    for (let i = 0; i < 7; i += 1) {
      await horloge(`2026-11-17T17:${String(10 + i).padStart(2, "0")}:00Z`);
      await commande();
    }
    const p1 = await liste({ par_page: 10, page: 1 });
    expect(p1.total).toBe(7);
    expect(p1.lignes).toHaveLength(7);
    const numeros = p1.lignes.map((l) => l.numero as number);
    expect(numeros).toEqual([...numeros].sort((a, b) => b - a));
    // Le plancher de 10 par page s'applique ; page 2 vide.
    expect((await liste({ par_page: 10, page: 2 })).lignes).toHaveLength(0);
  });

  it("filtre par statut, mode, moyen de paiement et montant, et donne les compteurs par statut", async () => {
    const a = await commande({ mode: "livraison", total: 5000 });
    await commande({ mode: "retrait", total: 1500 });
    await commande({ comptoir: true, total: 3000 });
    await accepter(a, "2026-11-17T18:45:00Z");
    expect((await liste({ statuts: ["acceptee"] })).lignes.map((l) => l.id)).toEqual([a]);
    expect((await liste({ mode: "livraison" })).total).toBe(1);
    expect((await liste({ moyen: "comptoir" })).total).toBe(1);
    expect((await liste({ montant_min: 2000, montant_max: 4000 })).total).toBe(1);
    const tout = await liste({ statuts: ["acceptee"] });
    // Les compteurs ignorent le filtre de statut : ils servent aux pastilles de l'écran.
    expect(tout.compteurs).toEqual({ acceptee: 1, nouvelle: 2 });
  });

  it("retrouve une commande par numéro, téléphone dans toutes ses écritures, e-mail ou nom", async () => {
    const a = await commande({ prenom: "Giulia", nom: "Rossi", tel: "+41 79 555 12 34", email: "Giulia.Rossi@Exemple.ch" });
    await commande();
    const numero = await f<number>("(select numero from commandes where id = $1)", [a]);
    expect((await liste({ recherche: String(numero) })).lignes[0].id).toBe(a);
    expect((await liste({ recherche: "079 555 12 34" })).lignes.map((l) => l.id)).toEqual([a]);
    expect((await liste({ recherche: "0041795551234" })).lignes.map((l) => l.id)).toEqual([a]);
    expect((await liste({ recherche: "giulia.rossi@exemple.ch" })).lignes.map((l) => l.id)).toEqual([a]);
    expect((await liste({ recherche: "rossi" })).lignes.map((l) => l.id)).toEqual([a]);
  });

  it("une recherche sans période remonte 90 jours ; sans recherche, seul le jour même", async () => {
    await horloge("2026-10-01T10:00:00Z");
    const ancienne = await commande({ nom: "Ancienne" });
    await horloge("2026-11-17T18:00:00Z");
    await commande();
    expect((await liste()).total).toBe(1);
    expect((await liste({ recherche: "Ancienne" })).lignes.map((l) => l.id)).toEqual([ancienne]);
  });

  it("filtre les commandes remboursées, par livreur et par zone", async () => {
    const a = await commande({ mode: "livraison" });
    const b = await commande({ mode: "livraison" });
    await accepter(a, "2026-11-17T18:45:00Z");
    await accepter(b, "2026-11-17T18:50:00Z");
    await db.query("insert into livraisons (commande_id, livreur_id, attribuee_par) values ($1, $2, 'tablette:Test')", [a, livreur]);
    await db.query(
      "insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, personnel_nom, fait_le) values ($1, 'cle-bo-0001', 500, 'Test.', 'stripe', 'fait', 'Gérant', now())",
      [b],
    );
    expect((await liste({ livreur })).lignes.map((l) => l.id)).toEqual([a]);
    expect((await liste({ remboursee: true })).lignes.map((l) => l.id)).toEqual([b]);
    expect((await liste({ zone: 1 })).total).toBe(2);
    const ligneA = (await liste({ livreur })).lignes[0];
    expect(ligneA.livreur).toBe("Marco");
    expect(ligneA.localite).toBe("Onex");
  });

  it("calcule le retard et le filtre « en retard »", async () => {
    const enRetard = await commande();
    const aLHeure = await commande();
    const attente = await commande();
    await accepter(enRetard, "2026-11-17T17:40:00Z"); // promise pour 18h40, il est 19h00
    await accepter(aLHeure, "2026-11-17T18:30:00Z");
    await horloge("2026-11-17T18:00:00Z");
    // La troisième attend d'être acceptée depuis plus que le délai d'alerte.
    await db.query("update commandes set paye_le = now() - interval '20 minutes' where id = $1", [attente]);
    const lignes = (await liste({ en_retard: true })).lignes;
    expect(lignes.map((l) => l.id).sort()).toEqual([enRetard, attente].sort());
    expect(lignes.find((l) => l.id === enRetard)?.retard_minutes).toBe(20);
    // Les compteurs suivent le filtre « en retard » : une acceptée et une à accepter.
    expect((await liste({ en_retard: true })).compteurs).toEqual({ acceptee: 1, nouvelle: 1 });
  });

  it("trie par heure prévue, montant ou numéro", async () => {
    const tard = await commande({ total: 1000 });
    const tot = await commande({ total: 9000 });
    await accepter(tard, "2026-11-17T19:30:00Z");
    await accepter(tot, "2026-11-17T18:15:00Z");
    expect((await liste({ tri: "heure" })).lignes.map((l) => l.id)).toEqual([tot, tard]);
    expect((await liste({ tri: "montant" })).lignes.map((l) => l.id)).toEqual([tot, tard]);
    expect((await liste({ tri: "numero" })).lignes.map((l) => l.id)).toEqual([tard, tot]);
  });

  it("l'heure prévue d'un créneau pas encore accepté vient du créneau choisi", async () => {
    await commande({ creneau: { date: "2026-11-17", minutes: 20 * 60 } });
    expect((await liste()).lignes[0].heure_prevue).toBe("2026-11-17T19:00:00+00:00");
  });

  it("ne liste ni les paiements abandonnés ni les commandes jamais payées", async () => {
    n += 1;
    await db.query("select creer_commande($1)", [
      {
        jeton_suivi: `jeton-bo-${n}`, cle_idempotence: `bo-${n}`, mode: "retrait", statut: "paiement_en_attente", statut_paiement: "en_attente",
        moyen_paiement: "en_ligne", client_prenom: "X", client_nom: "Y", client_telephone: "079", client_email: "x@laferme.test", quand_type: "asap",
        pizzas_seulement: false, sous_total_centimes: 100, frais_centimes: 0, total_centimes: 100, tva_centimes: 0, taux_tva_pourcent: 2.6,
        origine: "http://localhost:3000", lignes: [],
      },
    ]);
    expect((await liste()).total).toBe(0);
  });
});

describe("liste : réclamations ouvertes", () => {
  it("filtre les commandes avec une réclamation ouverte et en donne le nombre", async () => {
    const a = await commande();
    await commande();
    const gerantId = gerant;
    const r = await f<{ id: string }>("ouvrir_reclamation($1, $2)", [{ commande_id: a, source: "telephone", type: "froid", description: "Arrivée froide." }, gerantId]);
    const p = await liste({ avec_reclamation: true });
    expect(p.lignes.map((l) => l.id)).toEqual([a]);
    expect(p.lignes[0].reclamations).toBe(1);
    await f("suivre_reclamation($1, $2, $3)", [r.id, { statut: "close", resolution: "Excuses." }, gerantId]);
    expect((await liste({ avec_reclamation: true })).total).toBe(0);
  });
});

describe("fiche complète d'une commande", () => {
  it("rassemble chronologie, e-mails, livreur, tickets, notes et l'historique du client", async () => {
    const ancienne = await commande({ mode: "livraison", email: "fidele@laferme.test", total: 3000 });
    await accepter(ancienne, "2026-11-17T18:30:00Z");
    const c = await commande({ mode: "livraison", email: "FIDELE@laferme.test", total: 4000 });
    await accepter(c, "2026-11-17T18:45:00Z");
    await db.query("insert into livraisons (commande_id, livreur_id, attribuee_par) values ($1, $2, 'tablette:Test')", [c, livreur]);
    await f("enregistrer_courriel($1)", [{ commande_id: c, destinataire: "fidele@laferme.test", sujet: "Commande confirmée", texte: "Bonjour", html: "<p>Bonjour</p>", fournisseur: "doublure" }]);
    await f("ajouter_note_commande($1, $2, $3)", [c, "Client rappelé, il attend en bas.", gerant]);
    const fiche = await f<Record<string, unknown>>("fiche_commande_gestion($1)", [c]);
    expect(fiche.id).toBe(c);
    expect((fiche.livreur as { nom: string }).nom).toBe("Marco");
    expect((fiche.zone as { numero: number }).numero).toBe(1);
    expect((fiche.courriels as { sujet: string }[]).map((x) => x.sujet)).toEqual(["Commande confirmée"]);
    // Le contenu n'est pas dans la fiche : il se lit à part, à la demande.
    expect(JSON.stringify(fiche.courriels)).not.toContain("Bonjour");
    expect((fiche.notes as { texte: string; personnel_nom: string }[])[0]).toMatchObject({ texte: "Client rappelé, il attend en bas.", personnel_nom: "Gérant bureau" });
    expect(fiche.client).toMatchObject({ commandes: 2, depense_centimes: 7000 });
    const types = (fiche.chronologie as { type: string }[]).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["creation", "paiement", "statut", "livreur", "courriel", "note"]));
    const dates = (fiche.chronologie as { le: string }[]).map((e) => Date.parse(e.le));
    expect(dates).toEqual([...dates].sort((a, b) => a - b));
  });

  it("le contenu d'un e-mail ne se lit que par sa commande", async () => {
    const a = await commande();
    const b = await commande();
    await f("enregistrer_courriel($1)", [{ commande_id: a, destinataire: "c@laferme.test", sujet: "Sujet", texte: "Texte du message", html: "<p>x</p>", fournisseur: "doublure" }]);
    const mail = (await db.query<{ id: string }>("select id from courriels where commande_id = $1", [a])).rows[0].id;
    expect(await f("courriel_commande_gestion($1, $2)", [a, mail])).toMatchObject({ sujet: "Sujet", texte: "Texte du message" });
    expect(await f("courriel_commande_gestion($1, $2)", [b, mail])).toBeNull();
    // Le HTML n'est jamais renvoyé : l'écran n'affiche que le texte.
    expect(JSON.stringify(await f("courriel_commande_gestion($1, $2)", [a, mail]))).not.toContain("<p>");
  });

  it("une commande inconnue rend null", async () => {
    expect(await f("fiche_commande_gestion($1)", ["00000000-0000-0000-0000-000000000000"])).toBeNull();
  });
});

describe("notes internes", () => {
  it("réservées au gérant, journalisées, texte borné", async () => {
    const c = await commande();
    expect(await erreur("ajouter_note_commande($1, 'Note', $2)", [c, service])).toContain("Réservé au gérant");
    expect(await erreur("ajouter_note_commande($1, ' ', $2)", [c, gerant])).toContain("note_invalide");
    expect(await erreur("ajouter_note_commande($1, $2, $3)", [c, "x".repeat(501), gerant])).toContain("note_invalide");
    expect(await erreur("ajouter_note_commande($1, 'Note', $2)", ["00000000-0000-0000-0000-000000000000", gerant])).toContain("commande_inconnue");
    await f("ajouter_note_commande($1, '  Allergie aux noix signalée au téléphone  ', $2)", [c, gerant]);
    const j = (await db.query<{ objet: string; cle: string; apres: { texte: string } }>("select objet, cle, apres from journal_gestion order by id desc limit 1")).rows[0];
    expect(j).toMatchObject({ objet: "note_commande", cle: c, apres: { texte: "Allergie aux noix signalée au téléphone" } });
    expect((await liste({ avec_note: true })).lignes.map((l) => l.id)).toEqual([c]);
  });

  it("aucun droit direct pour un visiteur", async () => {
    const r = await db.query<{ ok: boolean }>(
      "select has_table_privilege('anon', 'notes_commande', 'select') or has_function_privilege('anon', 'liste_commandes_gestion(jsonb)', 'execute') or has_function_privilege('anon', 'ajouter_note_commande(uuid, text, uuid)', 'execute') as ok",
    );
    expect(r.rows[0].ok).toBe(false);
  });
});
