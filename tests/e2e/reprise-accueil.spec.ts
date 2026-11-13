import { expect, test, type Page } from "@playwright/test";

// Vague 3, client-commande : un client connecté reprend sa dernière commande dès l'accueil.

let n = 0;
async function identite(page: Page) {
  const id = `reprise-${test.info().project.name}-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 8)}`;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `10.7.${n}.${Math.floor(Math.random() * 250)}` });
  return `${id}@laferme.test`;
}

async function seConnecter(page: Page, email: string) {
  await page.goto("/compte");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Recevoir un code" }).click();
  const note = page.locator(".note-preversion strong");
  await expect(note).toHaveText(/^\d{6}$/);
  await page.getByLabel("Code à 6 chiffres").fill(await note.innerText());
  await page.getByRole("button", { name: "Me connecter" }).click();
  await expect(page.getByRole("heading", { name: "Vos commandes" })).toBeVisible();
}

test("connecté, la dernière commande se reprend dès l'accueil et mène au panier", async ({ page }) => {
  const email = await identite(page);
  await seConnecter(page, email);
  // Une première commande à emporter, payée au comptoir.
  await page.evaluate(() => {
    localStorage.setItem("laferme.choix.v1", JSON.stringify({ mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05", enregistreLe: Date.now() }));
    localStorage.setItem("laferme.panier.v1", JSON.stringify({ le: Date.now(), lignes: [{ slug: "pizza-margherita", qte: 2, choix: {}, retraits: [], note: "" }] }));
  });
  await page.goto("/commande");
  await page.getByLabel("Prénom").fill("Léa");
  await page.getByLabel("Nom", { exact: true }).fill("Reprise");
  await page.getByLabel("Téléphone", { exact: true }).fill("079 000 00 00");
  await page.getByText("Au comptoir").click();
  await page.getByRole("button", { name: /^Commander, je paie au comptoir/ }).click();
  await expect(page).toHaveURL(/\/suivi\//);

  // Le lendemain : panier et choix expirés.
  await page.evaluate(() => localStorage.clear());
  await page.goto("/?heure=2026-11-10T19:05");
  await expect(page.getByText(/^Votre dernière commande, /)).toBeVisible();
  await expect(page.getByText("2 × Margherita")).toBeVisible();
  await page.getByRole("button", { name: "Reprendre cette commande" }).click();
  await expect(page.getByText("2 plats remis dans votre panier.")).toBeVisible();
  await expect(page.getByRole("button", { name: /À emporter/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Voir le panier" }).click();
  await expect(page).toHaveURL(/\/panier/);
  await expect(page.locator(".lignes > li")).toContainText("Margherita");
});

test("invité : rien à reprendre", async ({ page }) => {
  await page.goto("/?heure=2026-11-10T19:05");
  await expect(page.getByRole("button", { name: /À emporter/ })).toBeVisible();
  await expect(page.getByText(/^Votre dernière commande/)).toHaveCount(0);
});
