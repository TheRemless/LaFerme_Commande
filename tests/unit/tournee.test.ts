import { describe, expect, it } from "vitest";
import { deplacer, eloignement, proposerOrdre, type ArretTournee } from "@/lib/tournee";

const a = (id: string, x: Partial<ArretTournee>): ArretTournee => ({ commande_id: id, statut: "acceptee", zone: 1, npa: "1213", rue: "Rue A", numero: "1", heure: "2026-11-14T19:00:00Z", ...x });

describe("ordre de passage proposé", () => {
  it("l'heure promise d'abord quand tout est au même endroit", () => {
    expect(proposerOrdre([a("tard", { heure: "2026-11-14T19:30:00Z" }), a("tot", { heure: "2026-11-14T19:00:00Z" })])).toEqual(["tot", "tard"]);
  });

  it("zone 1 avant zone 2 à heure égale (départ du restaurant à Onex)", () => {
    expect(proposerOrdre([a("z2", { zone: 2, npa: "1219", rue: "Rue B" }), a("z1", { zone: 1, npa: "1213" })])).toEqual(["z1", "z2"]);
  });

  it("enchaîne la même rue même si l'heure promise est un peu plus tard", () => {
    const ordre = proposerOrdre([
      a("rueA-19h00", { heure: "2026-11-14T19:00:00Z" }),
      a("lancy-19h05", { zone: 2, npa: "1212", rue: "Route du Pont-Butin", heure: "2026-11-14T19:05:00Z" }),
      a("rueA-19h10", { heure: "2026-11-14T19:10:00Z", numero: "8" }),
    ]);
    expect(ordre).toEqual(["rueA-19h00", "rueA-19h10", "lancy-19h05"]);
  });

  it("ne fait pas attendre une heure promise bien plus tôt pour rester dans la rue", () => {
    const ordre = proposerOrdre([
      a("rueA-19h00", { heure: "2026-11-14T19:00:00Z" }),
      a("lancy-19h05", { zone: 2, npa: "1212", rue: "Route du Pont-Butin", heure: "2026-11-14T19:05:00Z" }),
      a("rueA-20h00", { heure: "2026-11-14T20:00:00Z", numero: "8" }),
    ]);
    expect(ordre).toEqual(["rueA-19h00", "lancy-19h05", "rueA-20h00"]);
  });

  it("les livraisons parties restent devant", () => {
    expect(proposerOrdre([a("attend", { heure: "2026-11-14T18:00:00Z" }), a("partie", { statut: "partie", heure: "2026-11-14T19:00:00Z" })])).toEqual(["partie", "attend"]);
  });

  it("rue comparée sans accents ni casse", () => {
    expect(eloignement(a("x", { rue: "Avenue du Gros-Chêne" }), a("y", { rue: "avenue du gros-chene" }))).toBe(0);
    expect(eloignement(a("x", { npa: "1213", rue: "Rue A" }), a("y", { npa: "1213", rue: "Rue B" }))).toBe(1);
    expect(eloignement(null, a("y", { zone: 2 }))).toBe(2);
  });

  it("déplacer d'un cran, sans sortir de la liste", () => {
    expect(deplacer(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(deplacer(["a", "b", "c"], "c", 1)).toBeNull();
    expect(deplacer(["a"], "z", 1)).toBeNull();
  });
});

describe("lien de navigation", () => {
  const adresse = { rue: "Avenue du Gros-Chêne", numero: "20", npa: "1213", localite: "Onex" };
  it("Plans sur iPhone, geo: sur Android, sans autre donnée que l'adresse", async () => {
    const { lienNavigation, plateformeDe } = await import("@/lib/navigation");
    expect(plateformeDe("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("ios");
    expect(plateformeDe("Mozilla/5.0 (Linux; Android 14; Pixel 7)")).toBe("android");
    expect(lienNavigation(adresse, "ios")).toBe("https://maps.apple.com/?daddr=Avenue%20du%20Gros-Ch%C3%AAne%2020%2C%201213%20Onex%2C%20Suisse&dirflg=d");
    expect(lienNavigation(adresse, "android")).toMatch(/^geo:0,0\?q=Avenue/);
    expect(lienNavigation(adresse, "autre")).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=/);
  });
});
