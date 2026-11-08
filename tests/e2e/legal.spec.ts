import { expect, test } from "@playwright/test";

// Ébauches légales : visibles hors production avec le bandeau, liées depuis le pied de page.
for (const [chemin, titre] of [
  ["/mentions-legales", "Mentions légales"],
  ["/cgv", "Conditions générales de vente"],
  ["/confidentialite", "Déclaration de confidentialité"],
] as const) {
  test(`${titre} : ébauche marquée à faire relire`, async ({ page }) => {
    await page.goto(chemin);
    await expect(page.getByRole("heading", { level: 1, name: titre })).toBeVisible();
    await expect(page.getByRole("note")).toContainText("Ébauche à faire relire");
    expect(await page.locator(".legal mark").count()).toBeGreaterThan(0);
  });
}

test("le pied de page de l'accueil mène aux trois pages", async ({ page }) => {
  await page.goto("/");
  const pied = page.getByRole("navigation", { name: "Informations légales" });
  await pied.getByRole("link", { name: "Confidentialité" }).click();
  await expect(page).toHaveURL(/\/confidentialite$/);
  await expect(page.getByText("geo.admin.ch")).toBeVisible();
});
