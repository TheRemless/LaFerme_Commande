import type { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Vague 3, bo-commandes : réclamations suivies comme des dossiers, gestes commerciaux. « Plat offert à la
// prochaine commande » désactivé par défaut (D3). Montants tirés des commandes créées ici.

let db: PGlite;
let gerant: string;
let service: string;
let livreur: string;
let n = 0;

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
async function commande(email = "rec@exemple.ch", accepter = true): Promise<{ id: string; jeton: string }> {
  n += 1;
  const jeton = `jeton-reclamation-${n}-abcdef`;
  const p = {
    jeton_suivi: jeton, cle_idempotence: `rec-${n}`, mode: "retrait", statut: "paiement_en_attente", statut_paiement: "en_attente", moyen_paiement: "en_ligne",
    client_prenom: "Giulia", client_nom: "Rossi", client_telephone: "079 555 12 34", client_email: email, quand_type: "asap", pizzas_seulement: false,
    sous_total_centimes: 4000, frais_centimes: 0, total_centimes: 4000, tva_centimes: 0, taux_tva_pourcent: 2.6, origine: "http://localhost:3000",
    lignes: [{ slug: "x", nom: "Tiramisu", station: "cuisine", qte: 1, unitaire_centimes: 4000, total_centimes: 4000, choix: {}, retraits: [], note: "" }],
  };
  const id = (await db.query<{ id: string }>("select id from creer_commande($1)", [p])).rows[0].id;
  await f("appliquer_paiement($1, $2, 'paye', 'pi_rec', 4000)", [`evt-${id}`, id]);
  if (accepter) await f("changer_statut($1, 'acceptee', 'tablette:Test', now())", [id]);
  return { id, jeton };
}
type Rec = { id: string; statut: string; geste: string | null; geste_detail: string | null; email: string; source: string };
const ouvrir = (p: Record<string, unknown>, qui: string) => f<Rec>("ouvrir_reclamation($1, $2)", [p, qui]);

beforeEach(async () => {
  db = await creerBaseLocale();
  const id = async (e: string) => (await db.query<{ id: string }>("select id from personnel where email = $1", [e])).rows[0].id;
  gerant = await id("gerant-bureau@laferme.test");
  service = await id("equipe-bureau@laferme.test");
  livreur = await id("marco@laferme.test");
});

describe("ouvrir une réclamation", () => {
  it("l'équipe la note depuis la commande ; le livreur ne peut pas ; tout est journalisé", async () => {
    const c = await commande("Rec@Exemple.ch");
    const r = await ouvrir({ commande_id: c.id, source: "telephone", type: "manquant", description: "Il manque le tiramisù." }, service);
    expect(r).toMatchObject({ statut: "ouverte", email: "rec@exemple.ch", source: "telephone" });
    expect(await erreur("ouvrir_reclamation($1, $2)", [{ commande_id: c.id, source: "telephone", type: "manquant", description: "x x x" }, livreur])).toContain("Réservé à l'équipe");
    expect(await erreur("ouvrir_reclamation($1, $2)", [{ commande_id: c.id, source: "suivi", type: "manquant", description: "Il manque" }, service])).toContain("source_invalide");
    expect(await erreur("ouvrir_reclamation($1, $2)", [{ email: "personne@exemple.ch", source: "email", type: "autre", description: "Bonjour" }, service])).toContain("client_inconnu");
    const j = (await db.query<{ objet: string; personnel_nom: string }>("select objet, personnel_nom from journal_gestion order by id desc limit 1")).rows[0];
    expect(j).toEqual({ objet: "reclamation", personnel_nom: "Test bureau" });
    const fiche = await f<{ suivis: { texte: string }[]; commande: { numero: number } }>("fiche_reclamation_gestion($1)", [r.id]);
    expect(fiche.suivis.map((s) => s.texte)).toEqual(["Réclamation ouverte."]);
    expect(fiche.commande.numero).toBeGreaterThan(0);
  });

  it("depuis le suivi du client : commande acceptée, 14 jours, trois au plus", async () => {
    const c = await commande();
    const pasAcceptee = await commande("autre@exemple.ch", false);
    expect(await f("reclamation_client($1, 'froid', 'Arrivée froide')", [pasAcceptee.jeton])).toEqual({ resultat: "impossible" });
    expect(await f("reclamation_client('jeton-inconnu-xxxxxxxxxx', 'froid', 'Arrivée froide')")).toEqual({ resultat: "inconnue" });
    for (let i = 0; i < 3; i += 1) expect((await f<{ resultat: string }>("reclamation_client($1, 'froid', 'Arrivée froide')", [c.jeton])).resultat).toBe("ouverte");
    expect(await f("reclamation_client($1, 'froid', 'Encore')", [c.jeton])).toEqual({ resultat: "trop" });
    await db.query("update commandes set cree_le = now() - interval '15 days' where id = $1", [pasAcceptee.id]);
    const liste = await f<{ total: number; lignes: { source: string; cree_par: string }[] }>("reclamations_gestion('{}'::jsonb)");
    expect(liste.total).toBe(3);
    expect(liste.lignes[0]).toMatchObject({ source: "suivi", cree_par: "client" });
  });
});

describe("suivre, geste, clore", () => {
  it("le gérant prend en charge, relie un remboursement fait, puis clôt avec une résolution", async () => {
    const c = await commande();
    const r = await ouvrir({ commande_id: c.id, source: "telephone", type: "froid", description: "Pizza froide à l'arrivée." }, service);
    expect(await erreur("suivre_reclamation($1, $2, $3)", [r.id, { statut: "en_cours" }, service])).toContain("Réservé au gérant");
    await f("suivre_reclamation($1, $2, $3)", [r.id, { statut: "en_cours", texte: "Client rappelé à 20h10." }, gerant]);
    const rb = (await db.query<{ id: string }>(
      "insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, personnel_nom, fait_le) values ($1, 'cle-rec-0001', 1500, 'Pizza froide.', 'stripe', 'fait', 'Gérant', now()) returning id",
      [c.id],
    )).rows[0].id;
    const g = await f<Rec>("noter_geste_reclamation($1, $2, $3)", [r.id, { geste: "remboursement", remboursement_id: rb }, gerant]);
    expect(g).toMatchObject({ geste: "remboursement", geste_detail: "15.00 CHF, Pizza froide." });
    expect(await erreur("noter_geste_reclamation($1, $2, $3)", [r.id, { geste: "aucun", detail: "Déjà fait" }, gerant])).toContain("geste_deja_note");
    expect(await erreur("suivre_reclamation($1, $2, $3)", [r.id, { statut: "close" }, gerant])).toContain("resolution_manquante");
    const close = await f<Rec>("suivre_reclamation($1, $2, $3)", [r.id, { statut: "close", resolution: "Remboursé en partie, client satisfait." }, gerant]);
    expect(close.statut).toBe("close");
    const fiche = await f<{ suivis: { texte: string }[] }>("fiche_reclamation_gestion($1)", [r.id]);
    expect(fiche.suivis.map((s) => s.texte)).toEqual([
      "Réclamation ouverte.", "Client rappelé à 20h10.", "Prise en charge.", "Geste : remboursement de 15.00 CHF, Pizza froide.", "Close : Remboursé en partie, client satisfait.",
    ]);
    expect(await erreur("noter_geste_reclamation($1, $2, $3)", [r.id, { geste: "aucun", detail: "Trop tard" }, gerant])).toContain("reclamation_close");
  });

  it("un remboursement d'une autre commande, ou échoué, ne se relie pas", async () => {
    const a = await commande();
    const b = await commande();
    const r = await ouvrir({ commande_id: a.id, source: "telephone", type: "erreur", description: "Mauvaise pizza." }, service);
    const rb = (await db.query<{ id: string }>(
      "insert into remboursements (commande_id, cle, montant_centimes, motif, moyen, statut, personnel_nom, fait_le) values ($1, 'cle-rec-0002', 500, 'Autre.', 'stripe', 'fait', 'Gérant', now()) returning id",
      [b.id],
    )).rows[0].id;
    expect(await erreur("noter_geste_reclamation($1, $2, $3)", [r.id, { geste: "remboursement", remboursement_id: rb }, gerant])).toContain("remboursement_invalide");
  });

  it("plat offert : désactivé par défaut ; activé, en attente sur le client puis appliqué à sa commande suivante", async () => {
    const c = await commande("fidele@exemple.ch");
    const r = await ouvrir({ commande_id: c.id, source: "telephone", type: "retard", description: "45 minutes de retard." }, service);
    expect(await erreur("noter_geste_reclamation($1, $2, $3)", [r.id, { geste: "plat_offert", detail: "Un dessert offert" }, gerant])).toContain("gestes_desactives");
    await db.query("update reglages set valeur = 'true' where cle = 'gestes_commerciaux_actifs'");
    await f("noter_geste_reclamation($1, $2, $3)", [r.id, { geste: "plat_offert", detail: "Un dessert offert" }, gerant]);
    const attente = await f<{ id: string; detail: string }[]>("gestes_en_attente('Fidele@exemple.ch')");
    expect(attente.map((g) => g.detail)).toEqual(["Un dessert offert"]);
    const suivante = await commande("fidele@exemple.ch");
    const autre = await commande("autre@exemple.ch");
    expect(await f("appliquer_geste($1, $2, $3)", [attente[0].id, autre.id, service])).toBe(false);
    expect(await f("appliquer_geste($1, $2, $3)", [attente[0].id, suivante.id, service])).toBe(true);
    expect(await f("appliquer_geste($1, $2, $3)", [attente[0].id, suivante.id, service])).toBe(false);
    expect(await f("gestes_en_attente('fidele@exemple.ch')")).toEqual([]);
    // Réglage éteint ensuite : plus rien en attente n'est montré.
    await db.query("update reglages set valeur = 'false' where cle = 'gestes_commerciaux_actifs'");
    expect(await erreur("appliquer_geste($1, $2, $3)", [attente[0].id, suivante.id, service])).toContain("gestes_desactives");
  });

  it("réduction : éteinte sans les deux réglages ; allumée, un code personnel, une fois, pour ce client seul", async () => {
    const c = await commande("reduc@exemple.ch");
    const r = await ouvrir({ commande_id: c.id, source: "telephone", type: "froid", description: "Pizza arrivée froide." }, service);
    const geste = (p: Record<string, unknown>) => f<Rec & { code_id: string | null }>("noter_geste_reclamation($1, $2, $3)", [r.id, { geste: "reduction", ...p }, gerant]);
    expect(await erreur("noter_geste_reclamation($1, $2, $3)", [r.id, { geste: "reduction", type: "pourcentage", valeur: 10 }, gerant])).toContain("gestes_desactives");
    await db.query("update reglages set valeur = 'true' where cle = 'gestes_commerciaux_actifs'");
    expect(await erreur("noter_geste_reclamation($1, $2, $3)", [r.id, { geste: "reduction", type: "pourcentage", valeur: 10 }, gerant])).toContain("codes_desactives");
    await db.query("insert into reglages (cle, valeur) values ('codes_promo_actifs', 'true') on conflict (cle) do update set valeur = 'true'");
    for (const p of [{ type: "pourcentage", valeur: 0 }, { type: "pourcentage", valeur: 101 }, { type: "montant", valeur: 0 }, { type: "montant" }, { type: "cadeau", valeur: 5 }, { type: "montant", valeur: "500" }])
      expect(await erreur("noter_geste_reclamation($1, $2, $3)", [r.id, { geste: "reduction", ...p }, gerant])).toContain("reduction_invalide");
    const rec = await geste({ type: "pourcentage", valeur: 15 });
    expect(rec).toMatchObject({ geste: "reduction", statut: "en_cours" });
    expect(rec.geste_detail).toMatch(/^15 % sur la prochaine commande, code LAFERME-[0-9A-F]{8}$/);
    const fiche = await f<{ code: { code: string; type: string; valeur: number; utilise_commande: number | null }; codes_actifs: boolean }>("fiche_reclamation_gestion($1)", [r.id]);
    expect(fiche.codes_actifs).toBe(true);
    expect(fiche.code).toMatchObject({ type: "pourcentage", valeur: 15, utilise_commande: null });
    const code = fiche.code.code;
    const evaluer = (email: string, telephone: string | null) =>
      f<{ ok: boolean; raison?: string; remise_centimes?: number }>("evaluer_code($1)", [{ code, email, telephone, mode: "retrait", sous_total_centimes: 4000, frais_centimes: 0 }]);
    // Un autre client : le code « n'existe pas » ; le client, par son e-mail (avec +étiquette) ou son téléphone : 15 %.
    expect(await evaluer("autre@exemple.ch", "079 000 00 00")).toMatchObject({ ok: false, raison: "inconnu" });
    expect(await evaluer("reduc+promo@exemple.ch", null)).toMatchObject({ ok: true, remise_centimes: 600 });
    expect(await evaluer("nouvelle@exemple.ch", "+41 79 555 12 34")).toMatchObject({ ok: true, remise_centimes: 600 });
    expect(await erreur("noter_geste_reclamation($1, $2, $3)", [r.id, { geste: "plat_offert", detail: "Un dessert" }, gerant])).toContain("geste_deja_note");
    // Journal et fil du dossier disent le geste.
    const suivis = (await f<{ suivis: { texte: string }[] }>("fiche_reclamation_gestion($1)", [r.id])).suivis.map((x) => x.texte);
    expect(suivis.at(-1)).toBe(`Geste : réduction de 15 % sur la prochaine commande, code ${code}`);
  });

  it("réduction en francs ; à la suppression du compte, le code pas encore utilisé part", async () => {
    await db.query("update reglages set valeur = 'true' where cle = 'gestes_commerciaux_actifs'");
    await db.query("insert into reglages (cle, valeur) values ('codes_promo_actifs', 'true') on conflict (cle) do update set valeur = 'true'");
    const c = await commande("partant@exemple.ch");
    const r = await ouvrir({ commande_id: c.id, source: "email", type: "manquant", description: "Il manquait la boisson." }, service);
    const rec = await f<Rec>("noter_geste_reclamation($1, $2, $3)", [r.id, { geste: "reduction", type: "montant", valeur: 500 }, gerant]);
    expect(rec.geste_detail).toMatch(/^CHF 5\.00 sur la prochaine commande, code LAFERME-/);
    expect(await f<{ codes: { valeur: number }[] }>("donnees_gestion_client('partant@exemple.ch')")).toMatchObject({ codes: [{ type: "montant", valeur: 500 }] });
    await f("effacer_notes_client('partant@exemple.ch')");
    expect((await db.query("select 1 from codes_promo where client_email = 'partant@exemple.ch'")).rows).toHaveLength(0);
    expect(await f<{ code: unknown }>("fiche_reclamation_gestion($1)", [r.id])).toMatchObject({ code: null });
  });

  it("liste : ouvertes d'abord, filtres, compteurs ; aucun droit direct pour un visiteur", async () => {
    const c = await commande();
    const a = await ouvrir({ commande_id: c.id, source: "telephone", type: "froid", description: "Froid." }, service);
    await ouvrir({ commande_id: c.id, source: "sur_place", type: "erreur", description: "Erreur." }, service);
    await f("suivre_reclamation($1, $2, $3)", [a.id, { statut: "close", resolution: "Excuses." }, gerant]);
    const p = await f<{ compteurs: Record<string, number>; lignes: { statut: string }[] }>("reclamations_gestion('{}'::jsonb)");
    expect(p.compteurs).toEqual({ ouverte: 1, close: 1 });
    expect(p.lignes.map((l) => l.statut)).toEqual(["ouverte", "close"]);
    expect((await f<{ total: number }>("reclamations_gestion($1)", [{ types: ["froid"] }])).total).toBe(1);
    expect((await f<{ total: number }>("reclamations_gestion($1)", [{ commande_id: c.id, statuts: ["ouverte"] }])).total).toBe(1);
    expect(await f("has_table_privilege('anon', 'reclamations', 'select') or has_function_privilege('anon', 'reclamation_client(text, text, text)', 'execute')")).toBe(false);
  });
});
