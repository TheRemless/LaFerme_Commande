import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";

// Commande prise au téléphone (vague 3, bo-commandes) : créée acceptée, marquée « telephone », à encaisser,
// hors plafond du comptoir, journalisée au nom de l'équipier. Montants tirés du réglage et des commandes créées ici.

let db: PGlite;
const id: Record<string, string> = {};
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
function commande(total: number, extra: Record<string, unknown> = {}) {
  n += 1;
  return {
    jeton_suivi: `jeton-tel-${n}-abcdefgh`, cle_idempotence: `tel-${n}-cle-essai`, mode: "livraison", statut: "nouvelle",
    statut_paiement: "a_encaisser_retrait", moyen_paiement: "comptoir", client_prenom: "Léa", client_nom: "Rossi",
    client_telephone: "079 555 12 34", client_email: "", quand_type: "asap", pizzas_seulement: true,
    sous_total_centimes: total, frais_centimes: 0, total_centimes: total, tva_centimes: 0, taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000", adresse: { rue: "Route de Chancy", numero: "1", npa: "1213", localite: "Onex" },
    details_livraison: { sonnette: "Rossi", etage: "", code: "", instructions: "" }, zone_numero: 1,
    lignes: [{ slug: "x", nom: "Pizza", station: "pizza", qte: 1, unitaire_centimes: total, total_centimes: total, choix: {}, retraits: [], note: "" }],
    ...extra,
  };
}
const heure = () => new Date(Date.now() + 40 * 60_000).toISOString();
const plafond = () => f<number>("(select (valeur #>> '{}')::integer from reglages where cle = 'plafond_comptoir_centimes')");

beforeAll(async () => {
  db = await creerBaseLocale();
  for (const [cle, role] of [["service", "service"], ["livreur", "livreur"]] as const) {
    id[cle] = (await db.query<{ id: string }>("insert into personnel (email, nom, role) values ($1, $2, $3) returning id::text as id", [`tel-${cle}@laferme.test`, `Tel ${cle}`, role])).rows[0].id;
  }
});

describe("commande prise au téléphone", () => {
  it("l'équipe la crée acceptée, marquée téléphone, à encaisser, au-delà du plafond du comptoir", async () => {
    const p = commande((await plafond()) + 5000);
    const r = await f<{ id: string; numero: number; deja: boolean }>("creer_commande_telephone($1, $2, $3)", [p, heure(), id.service]);
    expect(r.deja).toBe(false);
    const c = (await db.query<{ statut: string; canal: string; statut_paiement: string; heure_confirmee: string | null }>("select statut, canal, statut_paiement, heure_confirmee from commandes where id = $1", [r.id])).rows[0];
    expect(c).toMatchObject({ statut: "acceptee", canal: "telephone", statut_paiement: "a_encaisser_retrait" });
    expect(c.heure_confirmee).not.toBeNull();
    const ev = (await db.query<{ par: string; detail: string | null }>("select par, detail from evenements_commande where commande_id = $1", [r.id])).rows;
    expect(ev.some((e) => e.par === "tablette:Tel service" && e.detail === "prise au téléphone")).toBe(true);
    const j = (await db.query<{ personnel_nom: string; apres: Record<string, unknown> }>("select personnel_nom, apres from journal_gestion where objet = 'commande_telephone' and cle = $1", [r.id])).rows[0];
    expect(j.personnel_nom).toBe("Tel service");
    expect(JSON.stringify(j.apres)).not.toContain("Rossi");
    // Rejouée avec la même clé : la même commande, sans seconde acceptation.
    expect(await f<{ id: string; deja: boolean }>("creer_commande_telephone($1, $2, $3)", [p, heure(), id.service])).toMatchObject({ id: r.id, deja: true });
    // La tablette lit le canal.
    const file = await f<{ id: string; canal: string }[]>("file_tablette()");
    expect(file.find((x) => x.id === r.id)?.canal).toBe("telephone");
  });

  it("le site reste au plafond ; un livreur ne prend pas de commande ; une commande payée en ligne est refusée", async () => {
    expect(await erreur("(select id from creer_commande($1))", [commande((await plafond()) + 5000)])).toContain("plafond_comptoir");
    expect(await erreur("creer_commande_telephone($1, $2, $3)", [commande(2000), heure(), id.livreur])).toContain("personnel_inactif");
    expect(await erreur("creer_commande_telephone($1, $2, $3)", [commande(2000, { moyen_paiement: "en_ligne", statut_paiement: "en_attente" }), heure(), id.service])).toContain(
      "commande_invalide",
    );
  });

  it("sans e-mail, la commande ne fait pas une fiche client", async () => {
    const r = await f<{ id: string }>("creer_commande_telephone($1, $2, $3)", [commande(2500, { client_prenom: "Sansmail" }), heure(), id.service]);
    expect(r.id).toBeTruthy();
    const liste = await f<{ lignes: { email: string }[] }>("clients_gestion($1)", [{}]);
    expect(liste.lignes.some((l) => l.email === "")).toBe(false);
  });
});
