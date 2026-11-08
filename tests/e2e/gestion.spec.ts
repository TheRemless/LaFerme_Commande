import { expect, test, type Page } from "@playwright/test";

// Back-office : réservé au gérant. Un gérant de test par projet (supabase/local/donnees-test.sql).
// L'import est seulement prévisualisé ici : l'appliquer changerait des prix pendant les autres tests
// (l'application est couverte par tests/unit/gestion.test.ts).
test.describe.configure({ mode: "serial" });

let gestion: Page;

async function connecter(page: Page, email: string) {
  await page.goto("/gestion");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Recevoir un code" }).click();
  const code = page.locator(".note-preversion strong");
  await expect(code).toHaveText(/^\d{6}$/);
  await page.getByLabel("Code à 6 chiffres").fill(await code.innerText());
  await page.getByRole("button", { name: "Me connecter" }).click();
}

test.beforeAll(async ({ browser }, info) => {
  gestion = await browser.newPage({ baseURL: "http://localhost:3200" });
  await connecter(gestion, `gerant-${info.project.name}@laferme.test`);
  await expect(gestion.getByRole("heading", { name: "Back-office" })).toBeVisible();
});

test.afterAll(async () => {
  await gestion.close();
});

test("un plat se modifie, ce qui bloque s'affiche, la modification va au journal", async () => {
  await expect(gestion.locator(".ges-bloquants")).toContainText("bloquent la mise en ligne");
  await gestion.getByLabel("Chercher un plat").fill("tonno");
  await gestion.getByRole("button", { name: /^Pizza tonno/ }).click();
  const fiche = gestion.locator(".ges-fiche");
  await fiche.getByLabel("Allergènes").fill("gluten, lait, poisson (test)");
  await fiche.getByRole("button", { name: "Enregistrer le plat" }).click();
  await expect(fiche.getByText("Enregistré.")).toBeVisible();
  await expect(gestion.getByRole("button", { name: /^Pizza tonno/ })).not.toContainText("allergènes manquants");

  await gestion.getByRole("button", { name: "Journal" }).click();
  await expect(gestion.locator(".ges-journal")).toContainText("pizza-tonno");
  await expect(gestion.locator(".ges-journal")).toContainText("gluten, lait, poisson (test)");
});

test("l'import du tableau montre les changements avant de les appliquer", async () => {
  await gestion.getByRole("button", { name: "Importer le tableau" }).click();
  await gestion.getByLabel("Fichier .xlsx").setInputFiles("tests/fixtures/validation-remplie.xlsx");
  await gestion.getByRole("button", { name: "Voir les changements" }).click();
  const apercu = gestion.locator(".ges-apercu");
  await expect(apercu).toContainText("Pizza Margherita");
  await expect(apercu).toContainText("19.50 (validé)");
  await expect(apercu).toContainText("Plat inventé");
  await expect(gestion.getByRole("button", { name: /^Appliquer \d+ changements?$/ })).toBeVisible();
});

test("l'export comptable se télécharge en CSV", async () => {
  await gestion.getByRole("button", { name: "Export comptable" }).click();
  const telechargement = gestion.waitForEvent("download");
  await gestion.getByRole("button", { name: "Télécharger le fichier CSV" }).click();
  const fichier = await telechargement;
  expect(fichier.suggestedFilename()).toMatch(/^la-ferme-ventes-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/);
  const morceaux: Buffer[] = [];
  for await (const m of await fichier.createReadStream()) morceaux.push(m as Buffer);
  expect(Buffer.concat(morceaux).toString("utf8")).toContain("Jour;Numéro;Heure;Mode;Paiement");
});

test("une zone se valide, les horaires et les fermetures s'affichent", async () => {
  await gestion.getByRole("button", { name: "Livraison et horaires" }).click();
  const zone = gestion.locator(".ges-zone").first();
  await zone.getByRole("button", { name: "Enregistrer la zone" }).click();
  await expect(zone.getByText("Enregistré.")).toBeVisible();
  await expect(gestion.locator(".ges-horaire").first()).toBeVisible();
  await expect(gestion.getByRole("heading", { name: "Fermetures" })).toBeVisible();
});

test("le back-office est fermé au personnel de service, aux clients et aux autres sites", async ({ page, request }, info) => {
  await connecter(page, `cuisine-${info.project.name}@laferme.test`);
  await expect(page.getByText("Réservé au gérant.")).toBeVisible();
  const service = (await page.context().cookies()).find((c) => c.name === "laferme-personnel")!;
  expect((await request.get("/api/gestion/carte", { headers: { Cookie: `laferme-personnel=${service.value}` } })).status()).toBe(403);
  expect((await request.get("/api/gestion/carte")).status()).toBe(401);
  expect((await request.get("/api/gestion/export?debut=2026-01-01&fin=2026-12-31")).status()).toBe(401);
  const gerant = (await gestion.context().cookies()).find((c) => c.name === "laferme-personnel")!;
  const pirate = await request.post("/api/gestion/carte", {
    headers: { Origin: "https://pirate.example", Cookie: `laferme-personnel=${gerant.value}` },
    data: { type: "plat", slug: "pizza-tonno", champs: { prix: "1" } },
  });
  expect(pirate.status()).toBe(403);
});
