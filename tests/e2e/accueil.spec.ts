import { expect, test } from "@playwright/test";

test("sans choix, la carte renvoie à l'accueil", async ({ page }) => {
  await page.goto("/carte");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Livraison ou à emporter ?");
});

test("à emporter pendant le service : dès que possible, puis la carte", async ({ page }) => {
  await page.goto("/?heure=2026-11-10T19:05");
  await page.getByRole("button", { name: /À emporter/ }).click();
  await expect(page.getByText(/Dès que possible, entre \d+h\d\d et \d+h\d\d/)).toBeVisible();
  await page.getByRole("button", { name: "Voir la carte" }).click();
  await expect(page).toHaveURL(/\/carte$/);
  // L'en-tête reprend l'heure annoncée à l'accueil (audit design, D07).
  await expect(page.locator(".tete-mode")).toContainText(/À emporter vers \d+h\d\d/);
});

test("restaurant fermé : on commande pour le prochain service", async ({ page }) => {
  await page.goto("/?heure=2026-11-09T12:00");
  await page.getByRole("button", { name: /À emporter/ }).click();
  await expect(page.getByText(/La cuisine est fermée en ce moment/)).toBeVisible();
  await expect(page.getByLabel("Jour")).toHaveValue("2026-11-10");
});

test("fermeture annuelle annoncée avec la réouverture", async ({ page }) => {
  await page.goto("/?heure=2026-12-23T12:00");
  await expect(page.getByText("On rouvre le mardi 12 janvier.")).toBeVisible();
});

// Dépend de l'API fédérale geo.admin.ch, appelée pour de vrai.
test("livraison : adresse dans la zone, puis hors zone", async ({ page }) => {
  await page.goto("/?heure=2026-11-10T19:05");
  await page.getByLabel("Adresse de livraison").fill("Avenue du Gros-Chêne 20");
  await page.locator(".suggestions button").first().click();
  await expect(page.getByText("Dans notre zone de livraison")).toBeVisible();
  await expect(page.getByRole("button", { name: "Voir la carte" })).toBeDisabled();
  await page.getByLabel("Nom sur la sonnette").fill("Test");
  await expect(page.getByRole("button", { name: "Voir la carte" })).toBeEnabled();

  await page.getByRole("button", { name: "Changer d'adresse" }).click();
  await page.getByLabel("Adresse de livraison").fill("Rue de Lausanne 20 1201");
  await page.locator(".suggestions button").first().click();
  await expect(page.getByText(/est hors de notre zone de livraison/)).toBeVisible();
  await page.getByRole("button", { name: "Commander à emporter" }).click();
  await expect(page.getByRole("button", { name: /À emporter/ })).toHaveAttribute("aria-pressed", "true");
});

test("le serveur refuse une adresse hors zone", async ({ request }) => {
  const rep = await request.post("/api/adresse", { data: { rue: "Route de Suisse", numero: "10", npa: "1290", localite: "Versoix" } });
  expect((await rep.json()).statut).toBe("hors-zone");
  const invalide = await request.post("/api/adresse", { data: { featureId: "../../etc" } });
  expect(invalide.status()).toBe(422);
});

// Lot 8c : l'accueil est servi depuis le cache, sans rien de propre au visiteur. L'heure qui fait foi
// et les adresses d'un client connecté arrivent ensuite par /api/accueil.
test("accueil en cache, heure et adresses par /api/accueil", async ({ request }) => {
  await request.get("/");
  const page = await request.get("/");
  expect(page.headers()["x-nextjs-cache"]).toMatch(/HIT|STALE/);
  const rep = await request.get("/api/accueil?heure=2026-11-10T19:05");
  expect(rep.headers()["cache-control"]).toContain("no-store");
  const r = await rep.json();
  expect(r.heureSimulee).toBe("2026-11-10T19:05");
  expect(r.maintenant).toBe(Date.parse("2026-11-10T19:05:00+01:00"));
  expect(r.adresses).toEqual([]);
  const reel = await (await request.get("/api/accueil")).json();
  expect(Math.abs(reel.maintenant - Date.now())).toBeLessThan(60_000);
  expect(reel.heureSimulee).toBeNull();
});

// CM-01 : une adresse saisie à la main est retrouvée dans le registre dès l'accueil, comme au paiement.
// Dépend de l'API fédérale geo.admin.ch, appelée pour de vrai.
test("saisie à la main : abréviation acceptée, NPA faux refusé dès l'accueil", async ({ page }) => {
  await page.goto("/?heure=2026-11-10T19:05");
  await page.getByLabel("Adresse de livraison").fill("Av. du Gros-Chêne 20");
  await page.getByRole("button", { name: "Mon adresse n'apparaît pas" }).click();
  await page.getByLabel("Rue", { exact: true }).fill("Av. du Gros-Chêne");
  await page.getByLabel("Numéro").fill("20");
  await page.getByLabel("NPA").fill("1213");
  await page.getByLabel("Localité").fill("Onex");
  await expect(page.getByText("Dans notre zone de livraison")).toBeVisible();
  await expect(page.getByText("On livrera Avenue du Gros-Chêne 20, 1213 Onex.")).toBeVisible();

  await page.getByLabel("Rue", { exact: true }).fill("Rue de la Servette");
  await page.getByLabel("Numéro").fill("50");
  await expect(page.getByText(/Nous ne trouvons pas cette adresse/)).toBeVisible();
  await expect(page.getByText("Dans notre zone de livraison")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Voir la carte" })).toBeDisabled();
});

test("le serveur retrouve une adresse abrégée et rend l'adresse officielle", async ({ request }) => {
  const rep = await request.post("/api/adresse", { data: { rue: "Av. du Gros-Chêne", numero: "20", npa: "1213", localite: "Onex" } });
  const r = await rep.json();
  expect(r.statut).toBe("livrable");
  expect(r.adresse).toMatchObject({ rue: "Avenue du Gros-Chêne", numero: "20", npa: "1213", featureId: expect.any(String) });
  const faux = await request.post("/api/adresse", { data: { rue: "Rue de la Servette", numero: "50", npa: "1213", localite: "Onex" } });
  expect(faux.status()).toBe(422);
});
