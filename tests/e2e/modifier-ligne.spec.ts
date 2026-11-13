import { expect, test, type Page } from "@playwright/test";

// Vague 3, client-commande : modifier une ligne du panier (options, retraits, note, quantité) sans la retirer.

const retrait = { mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05" };
const L = (slug: string, extra: Record<string, unknown> = {}) => ({ slug, qte: 1, choix: {}, retraits: [], note: "", ...extra });

async function poser(page: Page, lignes: unknown[]) {
  await page.addInitScript(
    ([choix, lignes]) => {
      if (sessionStorage.getItem("pose")) return;
      sessionStorage.setItem("pose", "1");
      localStorage.setItem("laferme.choix.v1", JSON.stringify({ ...choix, enregistreLe: Date.now() }));
      localStorage.setItem("laferme.panier.v1", JSON.stringify({ le: Date.now(), lignes }));
    },
    [retrait, lignes] as const,
  );
}
const panier = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("laferme.panier.v1")!).lignes);

test("au panier, « Modifier » rouvre la fiche avec les choix de la ligne et la met à jour à sa place", async ({ page }) => {
  await poser(page, [L("lasagne-de-boeuf"), L("pasta-alla-carbonara", { qte: 2, choix: { "choix-pates": ["Penne"] }, note: "Bien chaud" })]);
  await page.goto("/panier");
  await page.getByRole("button", { name: /^Modifier Carbonara|^Modifier .*arbonara/ }).click();
  const fiche = page.getByRole("dialog");
  await expect(fiche.getByLabel("Penne")).toBeChecked();
  await expect(fiche.getByLabel("Note pour la cuisine")).toHaveValue("Bien chaud");
  await expect(fiche.locator(".fiche-pied .qte span")).toHaveText("2");
  await fiche.getByLabel("Spaghetti").check();
  await fiche.getByLabel("Note pour la cuisine").fill("Sans fromage râpé");
  await fiche.getByRole("button", { name: /^Valider, CHF/ }).click();
  await expect(fiche).toBeHidden();
  expect(await panier(page)).toEqual([
    L("lasagne-de-boeuf"),
    L("pasta-alla-carbonara", { qte: 2, choix: { "choix-pates": ["Spaghetti"] }, note: "Sans fromage râpé" }),
  ]);
  await expect(page.locator(".lignes > li").nth(1)).toContainText("Spaghetti");
});

test("une ligne modifiée devenue identique à une autre la rejoint", async ({ page }) => {
  await poser(page, [L("pasta-alla-carbonara", { choix: { "choix-pates": ["Penne"] } }), L("pasta-alla-carbonara", { choix: { "choix-pates": ["Spaghetti"] } })]);
  await page.goto("/panier");
  await page.getByRole("button", { name: /^Modifier/ }).nth(1).click();
  const fiche = page.getByRole("dialog");
  await fiche.getByLabel("Penne").check();
  await fiche.getByRole("button", { name: /^Valider/ }).click();
  expect(await panier(page)).toEqual([L("pasta-alla-carbonara", { qte: 2, choix: { "choix-pates": ["Penne"] } })]);
});

test.describe("bureau", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test("sur la carte, le panier de côté a aussi « Modifier »", async ({ page }) => {
    await poser(page, [L("pizza-margherita", { note: "Bien cuite" })]);
    await page.goto("/carte");
    await page.locator(".panier-col").getByRole("button", { name: /^Modifier/ }).click();
    const fiche = page.getByRole("dialog");
    await expect(fiche.getByLabel("Note pour la cuisine")).toHaveValue("Bien cuite");
    await fiche.getByRole("button", { name: "Un de plus" }).click();
    await fiche.getByRole("button", { name: /^Valider/ }).click();
    expect(await panier(page)).toEqual([L("pizza-margherita", { qte: 2, note: "Bien cuite" })]);
  });
});

test("un plat épuisé depuis l'ajout se rouvre sans pouvoir être validé", async ({ page }) => {
  await poser(page, [L("pizza-margherita")]);
  await page.route("**/panier", async (r) => {
    if (r.request().resourceType() !== "document") return r.continue();
    const rep = await r.fetch();
    // Le plat passe en rupture : la carte servie à la page le dit.
    const html = (await rep.text()).replace(/(\\"slug\\":\\"pizza-margherita\\"[^}]*?\\"rupture_motif\\":)null/g, '$1\\"Épuisé pour aujourd\'hui.\\"');
    await r.fulfill({ response: rep, body: html });
  });
  await page.goto("/panier");
  await page.getByRole("button", { name: /^Modifier/ }).click();
  await expect(page.getByRole("dialog").locator(".fiche-pied .bouton-principal")).toBeDisabled();
});

test("un plat réservé à l'autre mode se rouvre sans pouvoir être validé, avec sa raison", async ({ page }) => {
  await poser(page, [L("lasagne-de-boeuf")]);
  // « Dès que possible » avec l'heure estimée que donne l'accueil (19h40).
  await page.addInitScript(() => {
    const c = JSON.parse(localStorage.getItem("laferme.choix.v1")!);
    localStorage.setItem("laferme.choix.v1", JSON.stringify({ ...c, estimation: 1180 }));
  });
  await page.route("**/panier", async (r) => {
    if (r.request().resourceType() !== "document") return r.continue();
    const rep = await r.fetch();
    const html = (await rep.text()).replace(/(\\"slug\\":\\"lasagne-de-boeuf\\"[^}]*?\\"dispo\\":)null/g, '$1{\\"service\\":null,\\"mode\\":\\"livraison\\",\\"jours\\":null}');
    await r.fulfill({ response: rep, body: html });
  });
  await page.goto("/panier");
  await page.getByRole("button", { name: /^Modifier/ }).click();
  const bouton = page.getByRole("dialog").locator(".fiche-pied .bouton-principal");
  await expect(bouton).toBeDisabled();
  await expect(bouton).toHaveText("Seulement en livraison.");
});
