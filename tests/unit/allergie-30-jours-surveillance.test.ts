import { describe, expect, it } from "vitest";
import { baseLocale } from "@/lib/db/locale";

// C14 : la surveillance (chaque minute en production) efface les allergies de plus de 30 jours.

const { executerSurveillance } = await import("@/lib/surveillance");

describe("surveillance : allergie effacée après 30 jours", () => {
  it("un tour efface l'allergie d'une commande de 31 jours", async () => {
    const db = await baseLocale();
    const id = (
      await db.query<{ id: string }>("select id from creer_commande($1)", [
        {
          jeton_suivi: "jeton-allergie-surv",
          cle_idempotence: "allergie-surv",
          mode: "retrait",
          statut: "nouvelle",
          statut_paiement: "paye",
          moyen_paiement: "en_ligne",
          client_prenom: "Surv",
          client_nom: "Test",
          client_telephone: "079 000 00 00",
          client_email: "surv@laferme.test",
          quand_type: "asap",
          pizzas_seulement: true,
          sous_total_centimes: 1800,
          frais_centimes: 0,
          total_centimes: 1800,
          tva_centimes: 46,
          taux_tva_pourcent: 2.6,
          origine: "http://localhost:3000",
          allergie: "Arachides",
          lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: 1800, total_centimes: 1800, choix: {}, retraits: [], note: "" }],
        },
      ])
    ).rows[0].id;
    await db.query("update commandes set statut = 'terminee', cree_le = now() - interval '31 days' where id = $1", [id]);
    await db.query("update surveillance_etat set surveillance_le = null where id");
    expect((await executerSurveillance()).fait).toBe(true);
    expect((await db.query<{ allergie: string }>("select allergie from commandes where id = $1", [id])).rows[0].allergie).toBe("");
  });
});
