import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";
import { creerCommande, fonctionSql } from "@/lib/db/serveur";

// Vague 3, client-commande : la dernière commande d'un client connecté, proposée dès l'accueil.
// Montants d'essai, pas des prix de la carte.

let compte: string;
let autre: string;

async function nouveauCompte(): Promise<string> {
  const db = await baseLocale();
  return (await db.query<{ id: string }>("insert into comptes (email) values ($1) returning id", [`derniere-${randomUUID().slice(0, 8)}@exemple.test`])).rows[0].id;
}

async function commande(compteId: string, statut: string, nom: string) {
  const cle = randomUUID();
  const c = await creerCommande({
    jeton_suivi: `jeton-${cle}`,
    cle_idempotence: cle,
    mode: "retrait",
    statut,
    statut_paiement: statut === "paiement_en_attente" ? "en_attente" : "a_encaisser_retrait",
    moyen_paiement: statut === "paiement_en_attente" ? "en_ligne" : "comptoir",
    client_prenom: "Essai",
    client_nom: "Derniere",
    client_telephone: "079 000 00 00",
    client_email: "derniere@exemple.test",
    quand_type: "asap",
    pizzas_seulement: true,
    sous_total_centimes: 4000,
    frais_centimes: 0,
    total_centimes: 4000,
    tva_centimes: 102,
    taux_tva_pourcent: 2.6,
    origine: "http://localhost:3000",
    compte_id: compteId,
    lignes: [{ slug: "pizza-margherita", nom, station: "pizza", qte: 2, unitaire_centimes: 2000, total_centimes: 4000, choix: {}, retraits: [], note: "" }],
  });
  return c.id;
}

beforeAll(async () => {
  compte = await nouveauCompte();
  autre = await nouveauCompte();
});

describe("dernière commande du compte", () => {
  it("aucune commande : null", async () => {
    expect(await fonctionSql("derniere_commande_compte", { p_compte: compte })).toBeNull();
  });

  it("la plus récente qui a abouti, sans celles en attente de paiement", async () => {
    await commande(compte, "terminee", "Pizza Margherita");
    const recente = await commande(compte, "nouvelle", "Pizza Peppino");
    await commande(compte, "paiement_en_attente", "Pizza Diavola");
    const d = await fonctionSql<{ id: string; mode: string; lignes: { nom: string; qte: number }[] }>("derniere_commande_compte", { p_compte: compte });
    expect(d.id).toBe(recente);
    expect(d.mode).toBe("retrait");
    expect(d.lignes).toEqual([{ nom: "Pizza Peppino", qte: 2 }]);
  });

  it("jamais celle d'un autre compte", async () => {
    expect(await fonctionSql("derniere_commande_compte", { p_compte: autre })).toBeNull();
  });
});
