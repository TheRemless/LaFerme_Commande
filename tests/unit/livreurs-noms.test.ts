import { describe, expect, it } from "vitest";
import { appliquerNoms, nomsDistincts } from "@/lib/livreurs-noms";

// Livreurs homonymes : « Nora (nora.b) » et « Nora (nora.k) », les autres noms inchangés, partout dans la réponse.

const LIVREURS = [
  { id: "a", nom: "Nora", email: "nora.b@laferme.test" },
  { id: "b", nom: "nora", email: "nora.k@laferme.test" },
  { id: "c", nom: "Sami", email: "sami@laferme.test" },
];

describe("noms des livreurs", () => {
  it("deux noms égaux (sans tenir compte de la casse) se distinguent par le début de l'e-mail", () => {
    const n = nomsDistincts(LIVREURS);
    expect(n.get("a")).toBe("Nora (nora.b)");
    expect(n.get("b")).toBe("nora (nora.k)");
    expect(n.get("c")).toBe("Sami");
  });
  it("appliqués aux semaines, au planning et aux statistiques, sans rien toucher d'autre", () => {
    const n = nomsDistincts(LIVREURS);
    const r = appliquerNoms(
      {
        semaines: [{ id: "a", nom: "Nora", creneaux: [{ jour: 5, service: "soir" }] }],
        planning: [{ jour: "2026-11-20", service: "soir", presents: 1, livreurs: [{ id: "b", nom: "nora", present: true }] }],
        stats: [{ livreur_id: "a", nom: "Nora", actif: true, livraisons: 3 }],
        autre: { id: "z", nom: "Inconnu" },
      },
      n,
    );
    expect(r.semaines[0]).toEqual({ id: "a", nom: "Nora (nora.b)", creneaux: [{ jour: 5, service: "soir" }] });
    expect(r.planning[0].livreurs[0].nom).toBe("nora (nora.k)");
    expect(r.planning[0].presents).toBe(1);
    expect(r.stats[0].nom).toBe("Nora (nora.b)");
    expect(r.autre.nom).toBe("Inconnu");
  });
});
