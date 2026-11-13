import { SITE, connecterPersonnelApi } from "./site";
import { expect, test } from "@playwright/test";

// Fermer le service du jour (vague 3, bo-operations ; droit fermer_service du responsable de service, D1).
// La base embarquée a role_responsable_actif à true (donnees-test.sql). Le test ne ferme jamais le service du jour :
// la base est commune et les autres fichiers commandent pour aujourd'hui. Il prouve la chaîne entière par un motif
// trop court : la route laisse passer le responsable (exigerDroit), la base aussi (auteur_droit), puis refuse le
// motif. La fermeture elle-même est vérifiée en base (tests/unit/fermer-service-sql.test.ts).
test.describe.configure({ mode: "serial", timeout: 90_000 });

const ORIGINE = { Origin: SITE };

test("responsable : passe la route et la base ; refusé pour une autre date, les horaires et les zones ; l'équipe de service refusée", async ({ playwright }, info) => {
  const responsable = await playwright.request.newContext({ baseURL: SITE, extraHTTPHeaders: ORIGINE });
  const equipe = await playwright.request.newContext({ baseURL: SITE, extraHTTPHeaders: ORIGINE });
  try {
    await connecterPersonnelApi(responsable, `responsable-operations-${info.project.name}@laferme.test`);
    // Motif trop court : refusé par la base après le contrôle du droit, rien n'est fermé.
    const motif = await responsable.post("/api/gestion/fermer-jour", { data: { quoi: "soir", motif: " " } });
    expect(motif.status()).toBe(422);
    expect((await motif.json()).erreur).toMatch(/^Indiquez un motif/);
    const quoi = await responsable.post("/api/gestion/fermer-jour", { data: { quoi: "demain", motif: "Panne" } });
    expect((await quoi.json()).erreur).toBe("Fermer : ce midi, ce soir ou toute la journée.");
    // Le reste reste au gérant : une autre date, les horaires, les zones.
    const autreDate = await responsable.post("/api/gestion/service", { data: { type: "fermeture", debut: "2027-02-02", fin: "2027-02-02", motif: "Essai", service: "soir" } });
    expect(autreDate.status()).toBe(403);
    const horaire = await responsable.post("/api/gestion/service", { data: { type: "semaine-fermer", jour: 2, service: "soir" } });
    expect(horaire.status()).toBe(403);
    const zone = await responsable.post("/api/gestion/service", { data: { type: "zone-services", numero: 3, services: ["midi", "soir"] } });
    expect(zone.status()).toBe(403);

    // L'équipe de service n'a pas le droit fermer_service.
    await connecterPersonnelApi(equipe, `cuisine-${info.project.name}@laferme.test`);
    const refus = await equipe.post("/api/gestion/fermer-jour", { data: { quoi: "soir", motif: "Panne" } });
    expect(refus.status()).toBe(403);
  } finally {
    await responsable.dispose();
    await equipe.dispose();
  }
});
