import { expect, test } from "@playwright/test";

// Vague 3, client-commande : option cochée d'avance par le restaurant (par_defaut, bo-carte #82).
// Aucune option n'est par défaut dans le seed : on en pose une en réécrivant le catalogue servi avec la page.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("laferme.choix.v1", JSON.stringify({ mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05", enregistreLe: Date.now() }));
  });
});

test("une option par défaut arrive cochée dans la fiche, le client peut la changer", async ({ page }) => {
  await page.route("**/carte", async (r) => {
    if (r.request().resourceType() !== "document") return r.continue();
    const rep = await r.fetch();
    const html = (await rep.text()).replace(/(\\"nom\\":\\"Penne\\"[^}]*?\\"par_defaut\\":)false/, "$1true");
    await r.fulfill({ response: rep, body: html });
  });
  await page.goto("/carte");
  await page.locator('li[data-slug="pasta-alla-carbonara"] button').first().click();
  const fiche = page.getByRole("dialog");
  await expect(fiche.getByLabel("Penne")).toBeChecked();
  await expect(fiche.locator(".fiche-pied .bouton-principal")).toBeEnabled();
  await fiche.getByLabel("Spaghetti").check();
  await expect(fiche.getByLabel("Penne")).not.toBeChecked();
});

test("sans option par défaut, le choix obligatoire reste à faire", async ({ page }) => {
  await page.goto("/carte");
  await page.locator('li[data-slug="pasta-alla-carbonara"] button').first().click();
  const fiche = page.getByRole("dialog");
  await expect(fiche.getByLabel("Penne")).not.toBeChecked();
  await expect(fiche.locator(".fiche-pied .bouton-principal")).toBeDisabled();
});
