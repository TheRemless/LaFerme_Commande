import { expect, test, type Page } from "@playwright/test";

// Vague 3, client-commande : filtre végétarien, à partir des étiquettes posées par le restaurant (bo-carte).
// Le seed n'en a aucune : on en pose en réécrivant la carte servie avec la page.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("laferme.choix.v1", JSON.stringify({ mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05", enregistreLe: Date.now() }));
  });
});

async function etiqueter(page: Page) {
  await page.route("**/carte", async (r) => {
    if (r.request().resourceType() !== "document") return r.continue();
    const rep = await r.fetch();
    const html = (await rep.text())
      .replace(/(\\"slug\\":\\"pizza-margherita\\"[^}]*?\\"etiquettes\\":)\[\]/, '$1[\\"vegetarien\\"]')
      .replace(/(\\"slug\\":\\"rigatoni-alla-peppino\\"[^}]*?\\"etiquettes\\":)\[\]/, '$1[\\"vegane\\",\\"vegetarien\\",\\"epice\\"]');
    await r.fulfill({ response: rep, body: html });
  });
}

test("sans étiquette posée par le restaurant, pas de filtre", async ({ page }) => {
  await page.goto("/carte");
  await expect(page.getByLabel("Chercher un plat")).toBeVisible();
  await expect(page.getByRole("button", { name: "Végétarien", exact: true })).toHaveCount(0);
});

test("« Végétarien » ne garde que les plats étiquetés, végane compris", async ({ page }) => {
  await etiqueter(page);
  // Chargement complet : les scripts de la page sont là. Sur une machine lente, un clic avant qu'ils aient
  // pris la main ne fait rien ; on reclique jusqu'à ce que le filtre soit vraiment enfoncé.
  await page.goto("/carte");
  const filtre = page.getByRole("button", { name: "Végétarien", exact: true });
  await expect(async () => {
    if ((await filtre.getAttribute("aria-pressed")) !== "true") await filtre.click({ timeout: 5000 });
    await expect(filtre).toHaveAttribute("aria-pressed", "true", { timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByText("2 plats", { exact: true })).toBeVisible();
  await expect(page.locator("li.plat")).toHaveCount(2);
  await page.locator('li[data-slug="rigatoni-alla-peppino"] button').first().click();
  await expect(page.getByRole("dialog")).toContainText("Végane, Épicé");
  await page.keyboard.press("Escape");
  await filtre.click();
  await expect(page.locator("li.plat").nth(5)).toBeVisible();
});
