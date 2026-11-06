import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { prixCourt } from "../../src/lib/prix";

const carte = JSON.parse(readFileSync(path.join(process.cwd(), "docs", "carte-proposee.json"), "utf8"));


test("la carte affiche chaque plat de la base avec son prix", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/carte$/);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "Pizzas", "Entrées", "Pâtes et risottos", "Poissons", "Viandes", "Desserts", "Boissons",
  ]);
  await expect(page.locator("li.plat")).toHaveCount(carte.plats.length);
  await expect(page.locator("main")).toHaveAttribute("data-source", /^(supabase|locale)$/);
  for (const p of carte.plats.slice(0, 10)) {
    await expect(page.locator(`li.plat[data-slug="${p.id}"] .plat-prix`)).toHaveText(prixCourt(Math.round(p.prixPropose * 100)));
  }
});

test("les catégories mènent à leur section", async ({ page }) => {
  await page.goto("/carte");
  await page.getByRole("navigation", { name: "Catégories" }).getByRole("link", { name: "Desserts" }).click();
  await expect(page).toHaveURL(/#desserts$/);
  await expect(page.getByRole("heading", { name: "Desserts" })).toBeInViewport();
});

test("la préversion signale les prix à valider", async ({ page }) => {
  await page.goto("/carte");
  await expect(page.getByRole("note")).toContainText("en attente de validation");
});

test("la page ne déborde pas en largeur", async ({ page }) => {
  await page.goto("/carte");
  const deborde = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(deborde).toBe(false);
});
