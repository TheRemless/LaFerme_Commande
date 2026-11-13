import { expect, test, type Page } from "@playwright/test";

// Vague 3, client-commande : filtre végétarien, à partir des étiquettes posées par le restaurant (bo-carte).
// Le seed n'en a aucune : on en pose en réécrivant la carte servie avec la page. Toutes les étiquettes vides
// sont remplacées : les données de la page arrivent en morceaux dont le découpage varie (page faite à la
// demande ou servie du cache), et un remplacement ciblé sur un seul plat pouvait tomber à cheval sur deux
// morceaux, sans bouton « Végétarien » (CI des #111 et #132).

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("laferme.choix.v1", JSON.stringify({ mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05", enregistreLe: Date.now() }));
  });
});

async function etiqueterTout(page: Page, etiquettes: string[]) {
  let remplacees = 0;
  await page.route("**/carte", async (r) => {
    if (r.request().resourceType() !== "document") return r.continue();
    const rep = await r.fetch();
    const valeur = `[${etiquettes.map((e) => `\\"${e}\\"`).join(",")}]`;
    const html = (await rep.text()).replace(/\\"etiquettes\\":\[\]/g, () => {
      remplacees++;
      return `\\"etiquettes\\":${valeur}`;
    });
    await r.fulfill({ response: rep, body: html });
  });
  return () => remplacees;
}

async function enfoncer(page: Page) {
  const filtre = page.getByRole("button", { name: "Végétarien", exact: true });
  // Sur une machine lente, un clic avant que la page ait pris la main ne fait rien : on reclique.
  await expect(async () => {
    if ((await filtre.getAttribute("aria-pressed")) !== "true") await filtre.click({ timeout: 5000 });
    await expect(filtre).toHaveAttribute("aria-pressed", "true", { timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  return filtre;
}

test("sans étiquette posée par le restaurant, pas de filtre", async ({ page }) => {
  await page.goto("/carte");
  await expect(page.getByLabel("Chercher un plat")).toBeVisible();
  await expect(page.getByRole("button", { name: "Végétarien", exact: true })).toHaveCount(0);
});

test("plats étiquetés : le filtre apparaît, s'enfonce et la fiche dit « Végane, Épicé »", async ({ page }) => {
  const remplacees = await etiqueterTout(page, ["vegane", "vegetarien", "epice"]);
  await page.goto("/carte");
  expect(remplacees(), "aucune étiquette réécrite dans la page servie").toBeGreaterThan(0);
  const filtre = await enfoncer(page);
  await expect(page.locator(".recherche-resultat")).toHaveText(/^\d+ plats?$/);
  await page.locator("li.plat button.plat-carte").first().click();
  await expect(page.getByRole("dialog")).toContainText("Végane, Épicé");
  await page.keyboard.press("Escape");
  await filtre.click();
  await expect(filtre).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".recherche-resultat")).toHaveText("");
});

test("étiquettes « épicé » seulement : pas de filtre végétarien", async ({ page }) => {
  await etiqueterTout(page, ["epice"]);
  await page.goto("/carte");
  await expect(page.getByRole("button", { name: "Végétarien", exact: true })).toHaveCount(0);
});
