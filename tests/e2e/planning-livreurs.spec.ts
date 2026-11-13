import { SITE } from "./site";
import { expect, test, type Page } from "@playwright/test";

// Planning et suivi des livreurs (vague 3, bo-operations) : la route du back-office, sans écran pour l'instant
// (il attend la coque). Un seul projet : la route n'a pas d'écran, et le planning est commun à la base.
test.describe.configure({ mode: "serial" });
// Adresse à part : la limite de 20 codes du personnel par adresse et par heure est commune à tous les fichiers
// qui se connectent depuis le poste local (x-forwarded-for n'est lu qu'en local, jamais sur Netlify).
test.use({ extraHTTPHeaders: { "x-forwarded-for": "10.30.0.3" } });

const ORIGINE = { Origin: SITE };

async function connecter(page: Page, email: string) {
  await page.goto("/gestion");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Recevoir un code" }).click();
  const code = page.locator(".note-preversion strong");
  await expect(code).toHaveText(/^\d{8}$/);
  await page.getByLabel("Code à 8 chiffres").fill(await code.innerText());
  await page.getByRole("button", { name: "Me connecter" }).click();
  await expect(page.getByLabel("Code à 8 chiffres")).toHaveCount(0);
}

test("semaine type, absence du jour, statistiques, période refusée", async ({ page, request }, info) => {
  test.skip(info.project.name !== "bureau", "route seule : projet bureau");
  expect((await request.get("/api/gestion/livreurs")).status()).toBe(401);
  await connecter(page, "planning-bureau@laferme.test");
  const lire = async () => (await page.request.get("/api/gestion/livreurs")).json();
  const poster = (data: Record<string, unknown>) => page.request.post("/api/gestion/livreurs", { headers: ORIGINE, data });

  // Période trop longue : refusée (un seul code par e-mail toutes les 30 s, d'où un seul test).
  expect((await page.request.get("/api/gestion/livreurs?debut=2026-11-01&fin=2026-12-31")).status()).toBe(400);

  const d = await lire();
  const moi = d.semaines.find((l: { nom: string }) => l.nom === "Livreur planning");
  expect(moi).toBeTruthy();
  const aujourdHui: string = d.periode.debut;

  try {
    // Tous les soirs de la semaine : ce soir il est prévu.
    const tous = [1, 2, 3, 4, 5, 6, 7].map((jour) => ({ jour, service: "soir" }));
    expect((await poster({ type: "semaine", livreur: moi.id, creneaux: tous })).status()).toBe(200);
    const soir = async () =>
      ((await lire()).planning as { jour: string; service: string; livreurs: { id: string; present: boolean; source: string; motif: string | null }[] }[])
        .find((x) => x.jour === aujourdHui && x.service === "soir")
        ?.livreurs.find((l) => l.id === moi.id);
    expect(await soir()).toMatchObject({ present: true, source: "semaine" });

    // Malade ce soir.
    expect((await poster({ type: "jour", livreur: moi.id, jour: aujourdHui, service: "soir", present: false, motif: "Malade" })).status()).toBe(200);
    expect(await soir()).toMatchObject({ present: false, source: "absent", motif: "Malade" });

    // Hier : refusé.
    const hier = new Date(new Date(`${aujourdHui}T12:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
    const r = await poster({ type: "jour", livreur: moi.id, jour: hier, service: "soir", present: false });
    expect(r.status()).toBe(422);
    expect((await r.json()).erreur).toMatch(/aujourd'hui/);

    // Statistiques : une ligne par livreur qui a eu des livraisons, sans donnée de client.
    const stats = (await lire()).stats as Record<string, unknown>[];
    expect(Array.isArray(stats)).toBe(true);
    expect(JSON.stringify(stats)).not.toMatch(/@|adresse|telephone/);
  } finally {
    await poster({ type: "jour", livreur: moi.id, jour: aujourdHui, service: "soir", present: null });
    await poster({ type: "semaine", livreur: moi.id, creneaux: [] });
  }
});

