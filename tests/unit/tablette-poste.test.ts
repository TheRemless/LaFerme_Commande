import { describe, expect, it } from "vitest";
import { nomCourt, vuePoste, type PosteActif } from "@/components/tablette/poste";
import type { CommandeTablette } from "@/lib/tablette";

// Vue par poste (vague 3, D12 à l'essai) : file d'un poste, reste à sortir par plat, dernières sorties.

const ligne = (nom: string, station: "pizza" | "cuisine", qte = 1) => ({ nom, qte, station, choix: {}, retraits: [], note: "", details: [] });
const commande = (id: string, numero: number, statut: string, lignes: ReturnType<typeof ligne>[]) =>
  ({ id, numero, statut, mode: "retrait", client_prenom: "Léa", client_nom: "Martin", heure_confirmee: "2026-11-13T19:30:00Z", heure_proposee: "2026-11-13T19:30:00Z", lignes }) as unknown as CommandeTablette;
const poste = (commande_id: string, station: "pizza" | "cuisine", a_faire_le: string, pret_le: string | null = null, pret_par: PosteActif["pret_par"] = null): PosteActif =>
  ({ commande_id, station, a_faire_le, lance_le: null, pret_le, pret_par });

describe("vuePoste", () => {
  const commandes = [
    commande("a", 12, "en_preparation", [ligne("Pizza Margherita", "pizza", 2), ligne("Lasagne", "cuisine")]),
    commande("b", 11, "acceptee", [ligne("Pizza Margherita", "pizza"), ligne("Pizza Diavola", "pizza")]),
    commande("c", 9, "prete", [ligne("Pizza Diavola", "pizza")]),
    commande("d", 8, "refusee", [ligne("Pizza Diavola", "pizza")]),
  ];
  const postes = [
    poste("a", "pizza", "2026-11-13T18:50:00Z"),
    poste("a", "cuisine", "2026-11-13T18:50:00Z"),
    poste("b", "pizza", "2026-11-13T18:45:00Z"),
    poste("c", "pizza", "2026-11-13T18:30:00Z", "2026-11-13T18:55:00Z", "poste"),
    poste("d", "pizza", "2026-11-13T18:20:00Z"),
  ];

  it("commande pas encore mise en route : hors file et hors reste, comptée plus tard (M2)", () => {
    const v = vuePoste(commandes, postes, "pizza", new Date("2026-11-13T18:47:00Z"));
    expect(v.en_cours.map((c) => c.numero)).toEqual([11]);
    expect(v.plus_tard).toBe(1);
    expect(v.reste).toEqual([
      { nom: "Pizza Diavola", qte: 1 },
      { nom: "Pizza Margherita", qte: 1 },
    ]);
  });

  it("file du poste dans l'ordre des tickets, seulement ses lignes, sans les refusées", () => {
    const v = vuePoste(commandes, postes, "pizza");
    expect(v.en_cours.map((c) => c.numero)).toEqual([11, 12]);
    expect(v.en_cours[1].lignes.map((l) => l.nom)).toEqual(["Pizza Margherita"]);
    expect(v.en_cours[1].client).toBe("Léa M.");
  });

  it("reste à sortir par plat, le plus nombreux d'abord", () => {
    expect(vuePoste(commandes, postes, "pizza").reste).toEqual([
      { nom: "Pizza Margherita", qte: 3 },
      { nom: "Pizza Diavola", qte: 1 },
    ]);
    expect(vuePoste(commandes, postes, "cuisine").reste).toEqual([{ nom: "Lasagne", qte: 1 }]);
  });

  it("dernières sorties : rouvrable seulement si la commande est encore en cuisine", () => {
    const v = vuePoste(commandes, postes, "pizza");
    expect(v.sorties).toEqual([{ id: "c", numero: 9, pret_le: "2026-11-13T18:55:00Z", par_le_poste: true, rouvrable: false, plats: 1 }]);
  });

  it("nom court au poste pizza", () => {
    expect(nomCourt("Pizza Margherita", "pizza")).toBe("Margherita");
    expect(nomCourt("Pizza Margherita", "cuisine")).toBe("Pizza Margherita");
  });
});
