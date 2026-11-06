import { expect, test } from "@playwright/test";

test("sans choix, la carte renvoie à l'accueil", async ({ page }) => {
  await page.goto("/carte");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Livraison ou à emporter ?");
});

test("à emporter pendant le service : dès que possible, puis la carte", async ({ page }) => {
  await page.goto("/?heure=2026-11-10T19:05");
  await page.getByRole("button", { name: /À emporter/ }).click();
  await expect(page.getByText(/Dès que possible, vers \d+h\d\d/)).toBeVisible();
  await page.getByRole("button", { name: "Voir la carte" }).click();
  await expect(page).toHaveURL(/\/carte$/);
  await expect(page.locator(".tete-mode")).toContainText("À emporter, dès que possible");
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

test("le serveur refuse une adresse hors du canton", async ({ request }) => {
  const rep = await request.post("/api/adresse", { data: { npa: "1290", localite: "Versoix" } });
  expect((await rep.json()).statut).toBe("hors-zone");
  const invalide = await request.post("/api/adresse", { data: { featureId: "../../etc" } });
  expect(invalide.status()).toBe(422);
});
