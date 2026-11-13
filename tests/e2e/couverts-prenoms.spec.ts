import { expect, test, type Page } from "@playwright/test";

// Vague 3, client-commande : couverts (C8) et prénom par ligne (C5), construits mais éteints par défaut.
// Allumés ici en réécrivant les réglages servis avec la page.

const retrait = { mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05" };
const pizza = { slug: "pizza-margherita", qte: 1, choix: {}, retraits: [], note: "" };

async function poser(page: Page, lignes: unknown[]) {
  await page.addInitScript(
    ([c, l]) => {
      if (sessionStorage.getItem("pose")) return;
      sessionStorage.setItem("pose", "1");
      localStorage.setItem("laferme.choix.v1", JSON.stringify({ ...c, enregistreLe: Date.now() }));
      localStorage.setItem("laferme.panier.v1", JSON.stringify({ le: Date.now(), lignes: l }));
    },
    [retrait, lignes] as const,
  );
}

async function allumer(page: Page, chemin: string, cle: string) {
  await page.route(`**/${chemin}`, async (r) => {
    if (r.request().resourceType() !== "document") return r.continue();
    const rep = await r.fetch();
    await r.fulfill({ response: rep, body: (await rep.text()).replaceAll(`\\"${cle}\\":false`, `\\"${cle}\\":true`) });
  });
}

test("éteints par défaut : ni case des couverts ni prénom dans la fiche", async ({ page }) => {
  await poser(page, [pizza]);
  await page.goto("/commande");
  await expect(page.getByLabel("Prénom")).toBeVisible();
  await expect(page.getByText("Couverts et serviettes")).toHaveCount(0);
  await page.goto("/carte");
  await page.locator('li[data-slug="pizza-margherita"] button').first().click();
  await expect(page.getByRole("dialog").getByLabel("Note pour la cuisine")).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Pour qui ?")).toHaveCount(0);
});

test("couverts allumés : case décochée par défaut, envoyée cochée", async ({ page }) => {
  await poser(page, [pizza, { ...pizza, slug: "pizza-peppino" }]);
  await allumer(page, "commande", "couvertsActifs");
  await page.goto("/commande");
  const caseCouverts = page.getByLabel("Couverts et serviettes");
  await expect(caseCouverts).not.toBeChecked();
  await caseCouverts.check();
  await page.getByLabel("Prénom").fill("Test");
  await page.getByLabel("Nom", { exact: true }).fill("Couverts");
  await page.getByLabel("Téléphone", { exact: true }).fill("079 000 00 00");
  await page.getByLabel("E-mail", { exact: true }).fill("couverts@laferme.test");
  await page.getByText("Au comptoir").click();
  const envoi = page.waitForRequest((r) => r.url().endsWith("/api/commandes") && r.method() === "POST");
  await page.getByRole("button", { name: /^Commander, je paie au comptoir/ }).click();
  expect(JSON.parse((await envoi).postData() ?? "{}").couverts).toBe(true);
});

test("prénom par ligne allumé : « Pour qui ? » dans la fiche, rappelé au panier", async ({ page }) => {
  await poser(page, []);
  await allumer(page, "carte", "prenomActif");
  await page.goto("/carte");
  await page.locator('li[data-slug="pizza-margherita"] button').first().click();
  const fiche = page.getByRole("dialog");
  await fiche.getByLabel("Pour qui ?").fill("Léa");
  await fiche.getByRole("button", { name: /^Ajouter, / }).click();
  const lignes = await page.evaluate(() => JSON.parse(localStorage.getItem("laferme.panier.v1")!).lignes);
  expect(lignes[0].pour).toBe("Léa");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".panier-col .ligne-opts")).toContainText("Pour Léa");
});
