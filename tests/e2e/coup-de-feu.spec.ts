import { codeDuPersonnel, SITE } from "./site";
import { expect, test, type Page } from "@playwright/test";

// Coup de feu (vague 3, bo-operations) : la route du back-office /api/gestion/coup-de-feu, sans écran pour
// l'instant (l'écran du back-office attend la coque ; la tablette a sa route et son bouton, session « tablette »). Le geste touche des réglages
// lus par tout le site : on le lance avec 1 minute de retard seulement, et on le finit tout de suite, pour ne
// pas gêner les autres fichiers de tests qui tournent en même temps.
test.describe.configure({ mode: "serial" });
// Adresse à part : la limite de 20 codes du personnel par adresse et par heure est commune à tous les fichiers
// qui se connectent depuis le poste local (x-forwarded-for n'est lu qu'en local, jamais sur Netlify).
test.use({ extraHTTPHeaders: { "x-forwarded-for": "10.30.0.1" } });

const ORIGINE = { Origin: SITE };

async function connecter(page: Page, email: string) {
  await page.goto("/tablette");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Code à 8 chiffres").fill(await codeDuPersonnel(page));
  await page.getByRole("button", { name: "Me connecter" }).click();
  await expect(page.getByLabel("Code à 8 chiffres")).toHaveCount(0);
}

test("fermée aux visiteurs, à l'équipe de la tablette et aux autres sites", async ({ page, request }, info) => {
  expect((await request.get("/api/gestion/coup-de-feu")).status()).toBe(401);
  expect((await request.post("/api/gestion/coup-de-feu", { headers: ORIGINE, data: { action: "finir" } })).status()).toBe(401);
  await connecter(page, `cdf-service-${info.project.name}@laferme.test`);
  expect((await page.request.get("/api/gestion/coup-de-feu")).status()).toBe(403);
  expect((await page.request.post("/api/gestion/coup-de-feu", { headers: ORIGINE, data: { action: "finir" } })).status()).toBe(403);
});

test("le gérant lance et finit un coup de feu", async ({ page }, info) => {
  await connecter(page, `cdf-${info.project.name}@laferme.test`);
  // Une requête d'un autre site, même avec la session, est refusée.
  const pirate = await page.request.post("/api/gestion/coup-de-feu", {
    headers: { Origin: "https://pirate.example" },
    data: { action: "lancer", retard_minutes: 1, duree_minutes: 15 },
  });
  expect(pirate.status()).toBe(403);

  const etat = await (await page.request.get("/api/gestion/coup-de-feu")).json();
  expect(etat.defaut).toMatchObject({ retard_minutes: 20, duree_minutes: 60 });

  const invalide = await page.request.post("/api/gestion/coup-de-feu", { headers: ORIGINE, data: { action: "lancer", retard_minutes: 1, duree_minutes: 5 } });
  expect(invalide.status()).toBe(422);
  expect((await invalide.json()).erreur).toMatch(/Durée/);

  try {
    const r = await page.request.post("/api/gestion/coup-de-feu", { headers: ORIGINE, data: { action: "lancer", retard_minutes: 1, duree_minutes: 15 } });
    expect(r.status()).toBe(200);
    const lance = await r.json();
    // Les deux projets (bureau, mobile) tournent en même temps : le dernier lancement peut être l'autre.
    expect(lance.en_cours.par).toMatch(/^Coup de feu (bureau|mobile)$/);
    expect(lance.en_cours.applique.retard_minutes).toBeGreaterThanOrEqual(1);
  } finally {
    const fin = await (await page.request.post("/api/gestion/coup-de-feu", { headers: ORIGINE, data: { action: "finir" } })).json();
    // L'autre projet a pu le finir juste avant : « deja » vaut alors vrai. Dans tous les cas, plus rien en cours.
    expect(fin.en_cours).toBeNull();
  }
});
