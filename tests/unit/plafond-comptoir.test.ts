import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { creerBaseLocale } from "@/lib/db/locale";
import { comptoirPermis, lirePlafondComptoir, montantPlafond } from "@/lib/plafond-comptoir";

// Plafond des commandes à payer au comptoir (décision de Jérémy du 12.11.2026, suite de S5 de l'audit de sécurité).
// Le montant vient de la base : aucun prix en dur ici.

let db: PGlite;
let plafond: number;
beforeAll(async () => {
  db = await creerBaseLocale();
  const r = await db.query<{ valeur: unknown; proposition: boolean }>("select valeur, proposition from reglages where cle = 'plafond_comptoir_centimes'");
  expect(r.rows).toHaveLength(1);
  plafond = Number(r.rows[0].valeur);
});

let k = 0;
async function commande(moyen: "comptoir" | "en_ligne", total: number) {
  const cle = `plafond-${++k}-${Date.now()}`;
  return db.query("select id from creer_commande($1)", [
    {
      jeton_suivi: `jeton-${cle}`,
      cle_idempotence: cle,
      mode: "retrait",
      statut: moyen === "comptoir" ? "nouvelle" : "paiement_en_attente",
      statut_paiement: moyen === "comptoir" ? "a_encaisser_retrait" : "en_attente",
      moyen_paiement: moyen,
      client_prenom: "Test",
      client_nom: "Plafond",
      client_telephone: `079 555 55 ${String(k).padStart(2, "0")}`,
      client_email: `plafond${k}@exemple.test`,
      quand_type: "asap",
      pizzas_seulement: true,
      sous_total_centimes: total,
      frais_centimes: 0,
      total_centimes: total,
      tva_centimes: 0,
      taux_tva_pourcent: 2.6,
      origine: "http://localhost:3000",
      lignes: [{ slug: "pizza-margherita", nom: "Pizza Margherita", station: "pizza", qte: 1, unitaire_centimes: total, total_centimes: total, choix: {}, retraits: [], note: "" }],
    },
  ]);
}

describe("réglage en base", () => {
  it("le plafond est un réglage décidé (pas une proposition), lisible par le site", async () => {
    expect(Number.isInteger(plafond) && plafond > 0).toBe(true);
    const r = await db.query<{ proposition: boolean }>("select proposition from reglages where cle = 'plafond_comptoir_centimes'");
    expect(r.rows[0].proposition).toBe(false);
  });

  it("lit le plafond parmi les réglages, null s'il manque ou s'il est invalide", () => {
    expect(lirePlafondComptoir([{ cle: "plafond_comptoir_centimes", valeur: plafond }])).toBe(plafond);
    expect(lirePlafondComptoir([])).toBeNull();
    expect(lirePlafondComptoir([{ cle: "plafond_comptoir_centimes", valeur: "abc" }])).toBeNull();
    expect(lirePlafondComptoir([{ cle: "plafond_comptoir_centimes", valeur: -1 }])).toBeNull();
  });
});

describe("règle", () => {
  it("permet le comptoir jusqu'au plafond compris, jamais au-delà ni sans plafond connu", () => {
    expect(comptoirPermis(plafond, plafond)).toBe(true);
    expect(comptoirPermis(plafond + 1, plafond)).toBe(false);
    expect(comptoirPermis(plafond, null)).toBe(false);
    expect(comptoirPermis(null, plafond)).toBe(false);
  });
});

describe("contrôle en base à l'enregistrement", () => {
  it("accepte une commande au comptoir égale au plafond", async () => {
    await expect(commande("comptoir", plafond)).resolves.toBeDefined();
  });

  it("refuse une commande au comptoir au-delà du plafond, même si le site ne l'a pas vue", async () => {
    await expect(commande("comptoir", plafond + 1)).rejects.toThrow(/plafond_comptoir/);
  });

  it("laisse passer le paiement en ligne au-delà du plafond", async () => {
    await expect(commande("en_ligne", plafond * 2)).resolves.toBeDefined();
  });

  it("refuse le comptoir si le réglage a disparu", async () => {
    await db.query("begin");
    try {
      await db.query("delete from reglages where cle = 'plafond_comptoir_centimes'");
      await expect(commande("comptoir", 100)).rejects.toThrow(/plafond_comptoir/);
    } finally {
      await db.query("rollback");
    }
  });
});

describe("affichage", () => {
  it("garde « CHF » et le montant sur la même ligne", () => {
    expect(montantPlafond(10000)).toBe("CHF\u00a0100");
    expect(montantPlafond(9950)).toBe("CHF\u00a099.50");
  });
});
