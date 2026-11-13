import { describe, expect, it } from "vitest";
import { chercherCommandes, etatTemps, gestePrincipal, minutesDeRetard, minutesRestantes, ordreStable, resumePlats } from "@/components/tablette/rush";
import type { CommandeTablette } from "@/lib/tablette";

const base = { client_nom: "Audit", heure_confirmee: null, statut: "acceptee", cree_le: "2026-11-13T18:00:00Z" };
const c = (x: Partial<CommandeTablette>) => ({ ...base, ...x }) as CommandeTablette;
const liste = [
  c({ id: "a", numero: 7, client_prenom: "Léa", cree_le: "2026-11-13T18:01:00Z" }),
  c({ id: "b", numero: 27, client_prenom: "Marco", client_nom: "Martin", cree_le: "2026-11-13T18:02:00Z" }),
  c({ id: "c", numero: 17, client_prenom: "Lea", statut: "terminee", cree_le: "2026-11-13T18:03:00Z" }),
  c({ id: "d", numero: 2, client_prenom: "Élodie", client_nom: "Marti", cree_le: "2026-11-13T18:04:00Z" }),
].map((x, i) => ({ ...x, client_telephone: ["079 111 22 33", "+41 78 444 55 66", "079 000 00 00", "022 792 16 89"][i] }));

describe("Recherche au comptoir", () => {
  it("un nombre cherche le numéro exact, pas les numéros qui le contiennent", () => {
    expect(chercherCommandes(liste, "7").map((x) => x.id)).toEqual(["a"]);
    expect(chercherCommandes(liste, " 27 ").map((x) => x.id)).toEqual(["b"]);
  });
  it("un nom se trouve sans accents ni majuscules, sur le prénom ou le nom", () => {
    expect(chercherCommandes(liste, "lea").map((x) => x.id)).toEqual(["a", "c"]);
    expect(chercherCommandes(liste, "MARTI").map((x) => x.id)).toEqual(["d", "b"]);
    expect(chercherCommandes(liste, "marco martin").map((x) => x.id)).toEqual(["b"]);
  });
  it("les commandes finies passent après celles encore à faire", () => {
    expect(chercherCommandes(liste, "léa").map((x) => x.statut)).toEqual(["acceptee", "terminee"]);
  });
  it("cinq chiffres ou plus cherchent dans le téléphone, espaces et +41 compris", () => {
    expect(chercherCommandes(liste, "11 22 33").map((x) => x.id)).toEqual(["a"]);
    expect(chercherCommandes(liste, "078 444").map((x) => x.id)).toEqual(["b"]);
    expect(chercherCommandes(liste, "4445566").map((x) => x.id)).toEqual(["b"]);
  });
  it("une recherche vide ne renvoie rien", () => {
    expect(chercherCommandes(liste, "  ")).toEqual([]);
  });
});

describe("Retard sur l'heure promise", () => {
  const maintenant = "2026-11-13T19:42:30Z";
  it("compte les minutes entières dépassées, en cuisine seulement", () => {
    expect(minutesDeRetard({ statut: "acceptee", heure_confirmee: "2026-11-13T19:30:00Z" }, maintenant)).toBe(12);
    expect(minutesDeRetard({ statut: "en_preparation", heure_confirmee: "2026-11-13T19:42:00Z" }, maintenant)).toBeNull();
    expect(minutesDeRetard({ statut: "prete", heure_confirmee: "2026-11-13T19:00:00Z" }, maintenant)).toBeNull();
    expect(minutesDeRetard({ statut: "acceptee", heure_confirmee: null }, maintenant)).toBeNull();
  });
  it("donne le temps restant avant l'heure promise, pas pour un autre jour", () => {
    expect(minutesRestantes({ statut: "acceptee", heure_confirmee: "2026-11-13T19:55:00Z" }, maintenant)).toBe(13);
    expect(minutesRestantes({ statut: "acceptee", heure_confirmee: "2026-11-14T19:30:00Z" }, maintenant)).toBeNull();
    expect(minutesRestantes({ statut: "acceptee", heure_confirmee: "2026-11-13T19:30:00Z" }, maintenant)).toBeNull();
  });
});

describe("Tableau par urgence", () => {
  const r = { preparation: 20, trajets: { 1: 10, 2: 25 } };
  const maintenant = "2026-11-13T19:30:00Z";
  const cmd = (x: Partial<CommandeTablette>) => ({ statut: "acceptee", mode: "retrait", zone_numero: null, heure_confirmee: "2026-11-13T20:00:00Z", ...x }) as CommandeTablette;

  it("une livraison en zone 2 à 20h15 se lance avant un retrait à 20h05", () => {
    const livraison = etatTemps(cmd({ mode: "livraison", zone_numero: 2, heure_confirmee: "2026-11-13T20:15:00Z" }), maintenant, r);
    const retrait = etatTemps(cmd({ heure_confirmee: "2026-11-13T20:05:00Z" }), maintenant, r);
    expect(livraison).toMatchObject({ niveau: "maintenant", texte: "À lancer" });
    expect(retrait).toMatchObject({ niveau: "calme", texte: "À lancer dans 15 min" });
    expect(livraison.cle).toBeLessThan(retrait.cle);
  });

  it("en retard passe devant tout, le plus ancien en tête ; prêtes et parties à la fin", () => {
    const e = [
      etatTemps(cmd({ heure_confirmee: "2026-11-13T19:40:00Z" }), maintenant, r),
      etatTemps(cmd({ heure_confirmee: "2026-11-13T19:24:00Z" }), maintenant, r),
      etatTemps(cmd({ heure_confirmee: "2026-11-13T19:10:00Z", statut: "en_preparation" }), maintenant, r),
      etatTemps(cmd({ statut: "prete", heure_confirmee: "2026-11-13T19:00:00Z" }), maintenant, r),
    ];
    expect(e.map((x) => x.texte)).toEqual(["À lancer", "En retard de 6 min", "En retard de 20 min", "Prête au comptoir"]);
    expect([...e].sort((a, b) => a.cle - b.cle).map((x) => x.texte)).toEqual(["En retard de 20 min", "En retard de 6 min", "À lancer", "Prête au comptoir"]);
  });

  it("en préparation : le temps avant de sortir, pas avant de lancer", () => {
    expect(etatTemps(cmd({ statut: "en_preparation", heure_confirmee: "2026-11-13T19:42:00Z" }), maintenant, r).texte).toBe("À sortir dans 12 min");
    expect(etatTemps(cmd({ statut: "en_preparation", mode: "livraison", zone_numero: 1, heure_confirmee: "2026-11-13T19:40:00Z" }), maintenant, r).texte).toBe("À sortir");
  });

  it("un geste par ligne, selon le mode et le paiement", () => {
    expect(gestePrincipal(cmd({ mode: "livraison", statut_paiement: "paye" }))?.libelle).toBe("Partie");
    expect(gestePrincipal(cmd({ statut: "en_preparation", statut_paiement: "a_encaisser_retrait" }))?.corps).toEqual({ action: "statut", vers: "prete", de: "en_preparation" });
    expect(gestePrincipal(cmd({ statut: "prete", statut_paiement: "a_encaisser_retrait" }))?.libelle).toBe("Retirée et payée");
    expect(gestePrincipal(cmd({ statut: "prete", statut_paiement: "paye" }))?.libelle).toBe("Retirée");
    expect(gestePrincipal(cmd({ statut: "partie", mode: "livraison", statut_paiement: "paye" }))?.libelle).toBe("Livrée");
    expect(gestePrincipal(cmd({ statut: "terminee", statut_paiement: "a_encaisser_retrait" }))?.libelle).toBe("Encaissée");
    expect(gestePrincipal(cmd({ statut: "terminee", statut_paiement: "paye" }))).toBeNull();
    expect(gestePrincipal(cmd({ statut: "nouvelle", statut_paiement: "paye" }))).toBeNull();
  });

  it("résumé court des plats", () => {
    expect(resumePlats([{ nom: "Pizza Margherita", qte: 2 }, { nom: "Pasta al pesto", qte: 1 }])).toBe("2 Margherita, Pasta al pesto");
  });

  it("ordre figé pendant qu'on touche : les nouvelles à la fin, les parties retirées", () => {
    expect(ordreStable(["c", "a", "d"], ["a", "b", "c"], true)).toEqual(["a", "c", "d"]);
    expect(ordreStable(["c", "a", "d"], ["a", "b", "c"], false)).toEqual(["c", "a", "d"]);
  });
});
