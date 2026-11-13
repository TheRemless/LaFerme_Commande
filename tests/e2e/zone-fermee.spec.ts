import { expect, test } from "@playwright/test";

// Vague 3, client-commande : zone fermée jusqu'à une heure (back-office, #79) annoncée à l'accueil.

test("adresse dans une zone fermée : l'heure de reprise et la sortie vers l'emporter", async ({ page }) => {
  const jusqua = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
  await page.route("**/api/adresse", (r) => r.fulfill({ json: { statut: "zone-fermee", verifiee: true, jusqua } }));
  await page.goto("/?heure=2026-11-10T19:05");
  await page.getByLabel("Adresse de livraison").fill("Avenue du Gros-Chêne 20");
  await page.locator(".suggestions button").first().click();
  await expect(page.getByText(/^La livraison reprend (à|le) .* dans votre quartier\.$/)).toBeVisible();
  await expect(page.getByText("hors de notre zone", { exact: false })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Voir la carte" })).toBeDisabled();
  await page.getByRole("button", { name: "Commander à emporter" }).click();
  await expect(page.getByRole("button", { name: /À emporter/ })).toHaveAttribute("aria-pressed", "true");
});
