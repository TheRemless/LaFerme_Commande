import { describe, expect, it } from "vitest";
import { avecMiseEnRoute, groupesPour, MISE_EN_ROUTE } from "@/components/gestion/navigation";
import { etapesMiseEnRoute, type EtatMiseEnRoute, type EtatServeur } from "@/lib/mise-en-route-etapes";

// Mise en route (vague 3, bo-socle) : chaque étape se coche d'après l'état réel ; le menu la met en tête tant
// qu'elle n'est pas finie.

const vide: EtatMiseEnRoute = {
  equipe: 0, tablette_vue_le: null, imprimantes_testees: [], zones_actives: 2, zones_a_valider: 2, horaires: 10, horaires_a_valider: 10,
  plats_bloquants: 80, livreurs: 0, livreurs_connectes: 0, livreurs_planifies: 0, code_livreur_ouvert: false, courriel_parti: false, paiement_recu: false, essai_rembourse: false,
};
const rien: EtatServeur = { imprimantes: [], courriel_branche: false, paiement_branche: false, alertes_adresse: false };
const pret: EtatMiseEnRoute = {
  equipe: 3, tablette_vue_le: "2026-11-13T17:00:00Z", imprimantes_testees: [1, 2], zones_actives: 2, zones_a_valider: 0, horaires: 10, horaires_a_valider: 0,
  plats_bloquants: 0, livreurs: 2, livreurs_connectes: 1, livreurs_planifies: 1, code_livreur_ouvert: true, courriel_parti: true, paiement_recu: true, essai_rembourse: true,
};
const branche: EtatServeur = {
  imprimantes: [
    { id: 1, nom: "Pizza", station: "pizza", actif: true, en_ligne: true },
    { id: 2, nom: "Cuisine", station: "cuisine", actif: true, en_ligne: true },
  ],
  courriel_branche: true,
  paiement_branche: true,
  alertes_adresse: true,
};
const etape = (m: ReturnType<typeof etapesMiseEnRoute>, cle: string) => m.etapes.find((e) => e.cle === cle)!;

describe("étapes de la mise en route", () => {
  it("restaurant neuf : rien n'est coché, chaque étape dit où on en est et mène à son écran", () => {
    const m = etapesMiseEnRoute(vide, rien);
    // Douze étapes, dont trois conseillées (imprimantes, code des livreurs) qui ne comptent pas pour « finie ».
    expect(m).toMatchObject({ faites: 0, total: 9, finie: false });
    expect(m.etapes.map((e) => e.cle)).toEqual(["courriels", "equipe", "tablette", "imprimante-pizza", "imprimante-cuisine", "horaires", "carte", "livreurs", "code-livreur", "alertes", "paiement", "essai"]);
    expect(m.etapes.filter((e) => e.conseillee).map((e) => e.cle)).toEqual(["imprimante-pizza", "imprimante-cuisine", "code-livreur"]);
    expect(etape(m, "horaires").etat).toBe("Encore en proposition\u00a0: 2 zones et 10 horaires.");
    expect(etape(m, "carte").etat).toBe("80 plats bloquent la mise en ligne.");
    expect(etape(m, "imprimante-pizza").etat).toBe("Aucune imprimante active pour le poste pizza.");
    for (const e of m.etapes) expect(e.guide).toMatch(/^Guide de mise en service\u00a0: docs\/mise-en-service\.md#[a-z-]+$/);
  });

  it("tout réglé : finie ; sans imprimante ni code des livreurs, finie quand même (tickets sur la tablette)", () => {
    expect(etapesMiseEnRoute(pret, branche)).toMatchObject({ faites: 9, finie: true });
    expect(etapesMiseEnRoute({ ...pret, imprimantes_testees: [], code_livreur_ouvert: false }, { ...branche, imprimantes: [] })).toMatchObject({ finie: true });
  });

  it("livreurs : il en faut un connecté et un prévu au planning", () => {
    const m = etapesMiseEnRoute({ ...pret, livreurs_planifies: 0 }, branche);
    expect(etape(m, "livreurs")).toMatchObject({ faite: false, etat: "2 livreurs, dont 1 déjà connecté. Personne au planning." });
  });

  it("une imprimante en ligne sans ticket de test n'est pas cochée ; testée puis éteinte, elle le reste", () => {
    const sansTest = etapesMiseEnRoute({ ...pret, imprimantes_testees: [2] }, branche);
    expect(etape(sansTest, "imprimante-pizza")).toMatchObject({ faite: false, etat: "Pizza est en ligne. Il reste à imprimer un ticket de test." });
    const horsLigne = etapesMiseEnRoute(pret, { ...branche, imprimantes: [{ ...branche.imprimantes[0], en_ligne: false }, branche.imprimantes[1]] });
    expect(etape(horsLigne, "imprimante-pizza")).toMatchObject({ faite: true, etat: "Pizza a sorti son ticket de test. Elle est hors ligne en ce moment." });
    const jamais = etapesMiseEnRoute({ ...pret, imprimantes_testees: [] }, { ...branche, imprimantes: [{ ...branche.imprimantes[0], en_ligne: false }] });
    expect(etape(jamais, "imprimante-pizza")).toMatchObject({ faite: false, etat: "Pizza est ajoutée mais hors ligne." });
  });

  it("envoi et paiement : branchés sans activité ne suffit pas ; livreur jamais connecté non plus", () => {
    const m = etapesMiseEnRoute({ ...pret, courriel_parti: false, paiement_recu: false, livreurs_connectes: 0 }, branche);
    expect(etape(m, "courriels")).toMatchObject({ faite: false, etat: "L'envoi est branché, aucun e-mail n'est encore parti." });
    expect(etape(m, "paiement")).toMatchObject({ faite: false, etat: "Les clés sont posées, aucun paiement n'est encore arrivé." });
    expect(etape(m, "livreurs")).toMatchObject({ faite: false, etat: "2 livreurs, aucun encore connecté. 1 livreur prévu au planning." });
  });

  it("les textes suivent les règles d'écriture : pas de virgule avant « et », pas de tiret d'incise", () => {
    const textes = etapesMiseEnRoute(vide, rien).etapes.flatMap((e) => [e.titre, e.etat, ...e.marche, e.guide ?? ""]);
    for (const t of textes) {
      // Guillemets et deux-points tenus par une espace insécable.
      expect(t).not.toMatch(/« | »| :/);
      expect(t).not.toMatch(/, et /);
      expect(t).not.toMatch(/ [–—] /);
    }
  });
});

describe("place dans le menu", () => {
  it("en tête tant qu'elle n'est pas finie, dans Réglages du restaurant ensuite", () => {
    const groupes = groupesPour("gerant");
    const avant = avecMiseEnRoute(groupes, false);
    expect(avant[0].rubriques).toEqual([MISE_EN_ROUTE]);
    expect(avant.slice(1).flatMap((g) => g.rubriques).some((r) => r.href === MISE_EN_ROUTE.href)).toBe(false);
    const apres = avecMiseEnRoute(groupes, true);
    expect(apres.find((g) => g.titre === "Réglages du restaurant")?.rubriques[0]).toBe(MISE_EN_ROUTE);
    expect(groupesPour("responsable").flatMap((g) => g.rubriques).some((r) => r.href === MISE_EN_ROUTE.href)).toBe(false);
  });
});
