import { describe, expect, it } from "vitest";
import { problemesConfiguration, problemesDonnees } from "@/lib/mise-en-ligne";

// S3 et S6 de l'audit de sécurité : le build de production refuse de partir avec des restes de test.

const BONNE = {
  NEXT_PUBLIC_SUPABASE_URL: "https://projet.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_factice",
  URL_SITE: "https://commande.exemple.ch",
  SECRET_COMPTES: "a".repeat(43),
};
const PROPRE = { platsBloquants: [], personnelTest: [], imprimantesTest: [], commandesEtrangeres: 0 };

describe("configuration de production", () => {
  it("accepte une configuration complète", () => {
    expect(problemesConfiguration(BONNE)).toEqual([]);
  });

  it("exige SECRET_COMPTES, assez longue et différente de la clé Supabase", () => {
    expect(problemesConfiguration({ ...BONNE, SECRET_COMPTES: undefined }).join()).toMatch(/SECRET_COMPTES/);
    expect(problemesConfiguration({ ...BONNE, SECRET_COMPTES: "court" }).join()).toMatch(/SECRET_COMPTES/);
    expect(problemesConfiguration({ ...BONNE, SECRET_COMPTES: BONNE.SUPABASE_SECRET_KEY }).join()).toMatch(/SECRET_COMPTES/);
  });

  it("refuse BASE_DE_TEST et SANS_LIMITE_COMPTOIR en production", () => {
    expect(problemesConfiguration({ ...BONNE, BASE_DE_TEST: "1" }).join()).toMatch(/BASE_DE_TEST/);
    expect(problemesConfiguration({ ...BONNE, SANS_LIMITE_COMPTOIR: "1" }).join()).toMatch(/SANS_LIMITE_COMPTOIR/);
  });

  it("garde les contrôles existants (clé Supabase, URL_SITE)", () => {
    expect(problemesConfiguration({ ...BONNE, SUPABASE_SECRET_KEY: undefined }).join()).toMatch(/SUPABASE_SECRET_KEY/);
    expect(problemesConfiguration({ ...BONNE, URL_SITE: "https://exemple.ch/" }).join()).toMatch(/URL_SITE/);
  });
});

describe("données de la base de production", () => {
  it("accepte une base propre", () => {
    expect(problemesDonnees(PROPRE)).toEqual([]);
  });

  it("refuse un plat bloquant, un membre en .test, une imprimante de test, une commande d'une préversion", () => {
    expect(problemesDonnees({ ...PROPRE, platsBloquants: [{ motif: "prix à valider" }, { motif: "prix à valider" }] }).join()).toMatch(/2 × prix à valider/);
    expect(problemesDonnees({ ...PROPRE, personnelTest: ["equipe@laferme.test"] }).join()).toMatch(/equipe@laferme\.test/);
    expect(problemesDonnees({ ...PROPRE, imprimantesTest: ["Test pizza (préversion)"] }).join()).toMatch(/Test pizza/);
    expect(problemesDonnees({ ...PROPRE, commandesEtrangeres: 3 }).join()).toMatch(/3 commandes/);
  });
});
