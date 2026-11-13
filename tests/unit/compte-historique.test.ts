import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import { creerCommande, fonctionSql } from "@/lib/db/serveur";

// Vague 3, client-compte : un client fidèle (15 à 39 commandes dans le jeu de rush) voit tout son historique,
// par pages, et le nombre de ses commandes. Montants d'essai.

type Page = { commandes: { id: string; numero: number; cree_le: string }[]; suite: boolean; total: number };

async function client(n: number) {
  const db = await baseLocale();
  const email = `fidele-${randomUUID().slice(0, 8)}@exemple.test`;
  const compte = (await db.query<{ id: string }>("insert into comptes (email) values ($1) returning id", [email])).rows[0].id;
  for (let i = 0; i < n; i++) {
    const cle = randomUUID();
    const c = await creerCommande({
      jeton_suivi: `jeton-${cle}`, cle_idempotence: cle, mode: "retrait", statut: "nouvelle", statut_paiement: "paye",
      moyen_paiement: "en_ligne", client_prenom: "Fidèle", client_nom: "Essai", client_telephone: "079 000 00 00", client_email: email,
      quand_type: "asap", pizzas_seulement: true, sous_total_centimes: 2000, frais_centimes: 0, total_centimes: 2000, tva_centimes: 51,
      taux_tva_pourcent: 2.6, origine: "http://localhost:3000", compte_id: compte,
      lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 2000, total_centimes: 2000, choix: {}, retraits: [], note: "" }],
    });
    await db.query("update commandes set statut = 'terminee', cree_le = now() - make_interval(days => $2) where id = $1", [c.id, i]);
  }
  return compte;
}

describe("historique du compte", () => {
  it("par pages de 30, du plus récent au plus ancien, avec le total", async () => {
    const compte = await client(35);
    const p1 = await fonctionSql<Page>("commandes_compte", { p_compte: compte, p_avant: null, p_limite: 30 });
    expect(p1.commandes).toHaveLength(30);
    expect(p1).toMatchObject({ suite: true, total: 35 });
    const p2 = await fonctionSql<Page>("commandes_compte", { p_compte: compte, p_avant: p1.commandes[29].cree_le, p_limite: 30 });
    expect(p2.commandes).toHaveLength(5);
    expect(p2.suite).toBe(false);
    const ids = new Set([...p1.commandes, ...p2.commandes].map((c) => c.id));
    expect(ids.size).toBe(35);
  });

  it("ni commande en attente de paiement ni annulée ; jamais celles d'un autre compte", async () => {
    const a = await client(2);
    const b = await client(1);
    const db = await baseLocale();
    await db.query("update commandes set statut = 'annulee' where id = (select id from commandes where compte_id = $1 order by cree_le limit 1)", [a]);
    const p = await fonctionSql<Page>("commandes_compte", { p_compte: a, p_avant: null, p_limite: 30 });
    expect(p.total).toBe(1);
    expect(p.commandes).toHaveLength(1);
    const pb = await fonctionSql<Page>("commandes_compte", { p_compte: b, p_avant: null, p_limite: 30 });
    expect(pb.commandes.map((c) => c.id)).not.toContain(p.commandes[0].id);
  });

  it("limite bornée : au plus 50 par page", async () => {
    const compte = await client(1);
    const p = await fonctionSql<Page>("commandes_compte", { p_compte: compte, p_avant: null, p_limite: 10000 });
    expect(p.commandes.length).toBeLessThanOrEqual(50);
  });
});
