import { describe, expect, it } from "vitest";
import { chercherCommandes, minutesDeRetard, minutesRestantes } from "@/components/tablette/rush";
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
