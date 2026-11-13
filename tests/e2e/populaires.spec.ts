import { expect, test, type Page } from "@playwright/test";

// Vague 3, client-commande : plats les plus commandés (C7) et une seule suggestion au panier,
// éteints par défaut. Allumés ici en réécrivant les données servies avec la page.

const retrait = { mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05" };

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

async function allumer(page: Page, chemin: string) {
  await page.route(`**/${chemin}`, async (r) => {
    if (r.request().resourceType() !== "document") return r.continue();
    const rep = await r.fetch();
    // L'ordre des clés dépend de la base (jsonb les trie) : chaque clé est remplacée à part.
    const html = (await rep.text())
      .replace('\\"populaires_actifs\\":false', '\\"populaires_actifs\\":true')
      .replace('\\"suggestion_active\\":false', '\\"suggestion_active\\":true')
      .replace('\\"tous\\":[]', '\\"tous\\":[\\"lasagne-de-boeuf\\",\\"pizza-margherita\\",\\"pizza-peppino\\"]')
      .replace('\\"par_categorie\\":{}', '\\"par_categorie\\":{\\"boissons\\":[\\"coca-cola\\"]}');
    await r.fulfill({ response: rep, body: html });
  });
}

const pizza = { slug: "pizza-margherita", qte: 1, choix: {}, retraits: [], note: "" };

test("éteints par défaut : ni « Les plus commandés » ni suggestion", async ({ page }) => {
  await poser(page, [pizza]);
  await page.goto("/carte");
  await expect(page.locator("section#populaires")).toHaveCount(0);
  await page.goto("/panier");
  await expect(page.locator(".ligne")).toHaveCount(1);
  await expect(page.getByText("La plus commandée", { exact: false })).toHaveCount(0);
});

test("allumés : les plus commandés en tête de la carte", async ({ page }) => {
  await poser(page, []);
  await allumer(page, "carte");
  await page.goto("/carte");
  await expect(page.getByRole("link", { name: "Les plus commandés" })).toBeVisible();
  const section = page.locator("section#populaires");
  await expect(section.locator("li.plat")).toHaveCount(3);
  await expect(section.locator("li.plat").first()).toHaveAttribute("data-slug", "lasagne-de-boeuf");
});

test("allumée : une boisson proposée au panier, ajoutée d'un tap, puis plus rien", async ({ page }) => {
  await poser(page, [pizza]);
  await allumer(page, "panier");
  await page.goto("/panier");
  await expect(page.getByText(/Une boisson avec ça \? La plus commandée est Coca-Cola, CHF 4.50/)).toBeVisible();
  await page.getByRole("button", { name: "Ajouter" }).click();
  await expect(page.locator(".ligne")).toHaveCount(2);
  await expect(page.getByText("La plus commandée", { exact: false })).toHaveCount(0);
});
