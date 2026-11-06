import { expect, test } from "@playwright/test";

// Retrait, mardi 19h05 simulé (préversion).
const choixRetrait = (heure = "2026-11-10T19:05") =>
  JSON.stringify({ mode: "retrait", quand: { type: "asap" }, heureSimulee: heure, enregistreLe: Date.now() });

test.describe("fiche et panier", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((c) => {
      if (!localStorage.getItem("laferme.choix.v1")) localStorage.setItem("laferme.choix.v1", c);
    }, choixRetrait());
  });

  test("les pâtes exigent un choix, puis le panier garde la ligne après rechargement", async ({ page }) => {
    await page.goto("/carte");
    await page.locator('li[data-slug="pasta-alla-carbonara"] button').click();
    const fiche = page.getByRole("dialog");
    await expect(fiche.locator(".fiche-pied .bouton-principal")).toBeDisabled();
    await fiche.getByLabel("Penne").check();
    await fiche.getByRole("button", { name: /^Ajouter/ }).click();
    await expect(fiche).toBeHidden();
    await page.reload();
    await page.goto("/panier");
    await expect(page.locator(".ligne")).toHaveCount(1);
    await expect(page.locator(".ligne-opts")).toContainText("Penne");
  });

  test("les suppléments s'arrêtent au maximum du groupe", async ({ page }) => {
    await page.goto("/carte");
    await page.locator('li[data-slug="pizza-margherita"] button').click();
    const fiche = page.getByRole("dialog");
    await fiche.getByRole("button", { name: /Voir les/ }).click();
    const cases = fiche.locator('fieldset:has(legend:text("Ajouter")) input[type=checkbox]');
    const max = Number((await fiche.locator(".groupe-regle").first().innerText()).match(/jusqu'à (\d+)/)![1]);
    for (let i = 0; i < max; i++) await cases.nth(i).check();
    await expect(cases.nth(max)).toBeDisabled();
  });

  test("Échap ferme la fiche", async ({ page }) => {
    await page.goto("/carte");
    await page.locator('li[data-slug="pizza-margherita"] button').click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });
});

test.describe("calcul serveur", () => {
  const ligne = (slug: string, autre = {}) => ({ slug, qte: 1, choix: {}, retraits: [], note: "", ...autre });

  test("ignore tout prix envoyé par le navigateur et applique frais et minimum", async ({ request }) => {
    const rep = await request.post("/api/panier", {
      data: {
        mode: "livraison",
        adresse: { rue: "Test", npa: "1213", localite: "Onex" },
        quand: { type: "asap" },
        heure: "2026-11-10T19:05",
        lignes: [{ ...ligne("pizza-margherita"), prix_centimes: 1, unitaire_centimes: 1 }],
      },
    });
    const r = await rep.json();
    expect(r.lignes[0].unitaire_centimes).toBeGreaterThan(1);
    expect(r.frais_centimes).toBeGreaterThan(0);
    expect(r.manque_minimum_centimes).toBeGreaterThan(0);
    expect(r.valide).toBe(false);
  });

  test("après la dernière commande de la carte, seules les pizzas passent", async ({ request }) => {
    const base = { mode: "retrait", quand: { type: "asap" }, heure: "2026-11-10T21:40" };
    const mixte = await (await request.post("/api/panier", { data: { ...base, lignes: [ligne("pizza-margherita"), ligne("pasta-alla-carbonara", { choix: { "choix-pates": ["Penne"] } })] } })).json();
    expect(mixte.message_quand).toMatch(/que les pizzas/);
    expect(mixte.valide).toBe(false);
    const pizzas = await (await request.post("/api/panier", { data: { ...base, lignes: [ligne("pizza-margherita")] } })).json();
    expect(pizzas.message_quand).toBeNull();
    expect(pizzas.valide).toBe(true);
  });

  test("refuse un panier illisible ou une adresse hors zone", async ({ request }) => {
    expect((await request.post("/api/panier", { data: { mode: "retrait", lignes: "x" } })).status()).toBe(422);
    const hors = await request.post("/api/panier", { data: { mode: "livraison", adresse: { npa: "1290", localite: "Versoix" }, lignes: [ligne("pizza-margherita")] } });
    expect(hors.status()).toBe(422);
  });
});
