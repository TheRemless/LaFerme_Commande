import { beforeAll, describe, expect, it } from "vitest";
import { chargerCatalogue } from "@/lib/catalogue";
import { chargerConfigService } from "@/lib/config-service";
import { baseLocale } from "@/lib/db/locale";
import { recreerCommande } from "@/lib/recreer-commande";
import { creneaux, type Quand } from "@/lib/service";

// Vague 3, bo-commandes : recréer une commande au téléphone, désactivé par défaut. Prix du jour lus dans le
// catalogue, jamais écrits ici ; créneau tiré de la configuration (le test ne dépend pas de l'heure réelle).

let gerant: { id: string; email: string; nom: string; role: "gerant" };
let quand: Quand;
let n = 0;

async function source(lignes: { slug: string; nom: string; station: string; qte: number }[]): Promise<string> {
  const db = await baseLocale();
  n += 1;
  const p = {
    jeton_suivi: `jeton-recree-${n}`, cle_idempotence: `recree-${n}`, mode: "livraison", statut: "paiement_en_attente", statut_paiement: "en_attente",
    moyen_paiement: "en_ligne", client_prenom: "Giulia", client_nom: "Rossi", client_telephone: "079 555 12 34", client_email: `recree${n}@exemple.ch`,
    quand_type: "asap", pizzas_seulement: false, sous_total_centimes: 1, frais_centimes: 0, total_centimes: 1, tva_centimes: 0, taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000", adresse: { rue: "Route de Chancy", numero: "1", npa: "1213", localite: "Onex" },
    details_livraison: { sonnette: "Rossi", etage: "", code: "", instructions: "" }, zone_numero: 1,
    lignes: lignes.map((l) => ({ ...l, unitaire_centimes: 1, total_centimes: l.qte, choix: {}, retraits: [], note: "bien cuite" })),
  };
  const id = (await db.query<{ id: string }>("select id from creer_commande($1)", [p])).rows[0].id;
  await db.query("select appliquer_paiement($1, $2, 'paye', 'pi_recree', 1)", [`evt-${id}`, id]);
  return id;
}
async function activer(oui: boolean) {
  const db = await baseLocale();
  await db.query("update reglages set valeur = $1::jsonb where cle = 'commande_telephone_active'", [JSON.stringify(oui)]);
}

beforeAll(async () => {
  const db = await baseLocale();
  const g = (await db.query<{ id: string; nom: string }>("select id, nom from personnel where email = 'gerant-bureau@laferme.test'")).rows[0];
  gerant = { ...g, email: "gerant-bureau@laferme.test", role: "gerant" };
  const c = creneaux(await chargerConfigService(), new Date(), "retrait")[0];
  quand = { type: "creneau", date: c.date, minutes: c.minutes };
});

describe("recréer une commande au téléphone", () => {
  it("désactivé par défaut", async () => {
    await activer(false);
    const s = await source([{ slug: "lasagne-de-boeuf", nom: "Lasagne de bœuf", station: "cuisine", qte: 1 }]);
    expect(await recreerCommande(s, quand, "cle-recree-0000-0001", gerant)).toEqual({ ok: false, message: "Recréer une commande au téléphone n'est pas encore activé." });
  });

  it("activé : retrait au comptoir aux prix du jour, mêmes plats et notes, tracé des deux côtés, une seule fois", async () => {
    await activer(true);
    const cat = await chargerCatalogue();
    const plat = cat.plats["lasagne-de-boeuf"];
    const s = await source([{ slug: "lasagne-de-boeuf", nom: plat.nom, station: "cuisine", qte: 2 }]);
    const r = await recreerCommande(s, quand, "cle-recree-0000-0002", gerant);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const db = await baseLocale();
    const c = (await db.query<{ mode: string; moyen_paiement: string; statut: string; total_centimes: number; client_email: string; adresse: unknown }>(
      "select mode, moyen_paiement, statut, total_centimes, client_email, adresse from commandes where id = $1", [r.id])).rows[0];
    expect(c).toMatchObject({ mode: "retrait", moyen_paiement: "comptoir", statut: "nouvelle", total_centimes: 2 * plat.prix_centimes, client_email: `recree${n}@exemple.ch`, adresse: null });
    const note = (await db.query<{ note: string }>("select note from commande_lignes where commande_id = $1", [r.id])).rows[0].note;
    expect(note).toBe("bien cuite");
    const traces = (await db.query<{ detail: string }>("select detail from evenements_commande where commande_id in ($1, $2) and detail like 'recreee%' order by id", [s, r.id])).rows;
    expect(traces).toHaveLength(2);
    const j = (await db.query<{ objet: string }>("select objet from journal_gestion order by id desc limit 1")).rows[0];
    expect(j.objet).toBe("commande_recreee");
    // Double appui : même clé, même commande, pas de deuxième trace.
    const encore = await recreerCommande(s, quand, "cle-recree-0000-0002", gerant);
    expect(encore.ok && encore.id).toBe(r.id);
    expect((await db.query("select 1 from evenements_commande where commande_id = $1 and detail like 'recreee%'", [s])).rows).toHaveLength(1);
  });

  it("un plat qui n'est plus en vente bloque, avec son nom", async () => {
    await activer(true);
    const s = await source([{ slug: "plat-disparu", nom: "Plat disparu", station: "cuisine", qte: 1 }]);
    const r = await recreerCommande(s, quand, "cle-recree-0000-0003", gerant);
    expect(r.ok).toBe(false);
  });

  it("sans heure possible : refus", async () => {
    await activer(true);
    const s = await source([{ slug: "lasagne-de-boeuf", nom: "Lasagne de bœuf", station: "cuisine", qte: 1 }]);
    expect((await recreerCommande(s, { type: "aucun" }, "cle-recree-0000-0004", gerant)).ok).toBe(false);
    expect((await recreerCommande(s, { type: "creneau", date: "2020-01-01", minutes: 1200 }, "cle-recree-0000-0005", gerant)).ok).toBe(false);
  });
});
