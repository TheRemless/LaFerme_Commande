import { expect, test, type Page } from "@playwright/test";

// Conforts restants du rapport client mystère (docs/audits/client-mystere.md) : CM-11, 15, 21, 22, 23, 26.

const L = (slug: string, qte = 1, extra: Record<string, unknown> = {}) => ({ slug, qte, choix: {}, retraits: [], note: "", ...extra });
const retrait = { mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05" };

async function poser(page: Page, choix: Record<string, unknown>, lignes: unknown[], age = 0) {
  await page.addInitScript(
    ([choix, lignes, age]) => {
      if (sessionStorage.getItem("pose")) return;
      sessionStorage.setItem("pose", "1");
      localStorage.setItem("laferme.choix.v1", JSON.stringify({ ...choix, enregistreLe: Date.now() }));
      localStorage.setItem("laferme.panier.v1", JSON.stringify({ le: Date.now() - age, lignes }));
    },
    [choix, lignes, age] as const,
  );
}

async function payerEnLigne(page: Page) {
  await page.goto("/commande");
  await page.getByLabel("Prénom").fill("Test");
  await page.getByLabel("Nom", { exact: true }).fill("Conforts");
  await page.getByLabel("Téléphone").fill("079 000 00 00");
  await page.getByLabel("E-mail", { exact: true }).fill("conforts@laferme.test");
  await page.getByRole("button", { name: /^Payer CHF/ }).click();
  await page.getByRole("button", { name: "Simuler un paiement réussi" }).click();
  await expect(page).toHaveURL(/\/suivi\//);
}

test("CM-11 : retour arrière après le paiement, on retombe sur le suivi", async ({ page }) => {
  await poser(page, retrait, [L("pizza-margherita", 2)]);
  await payerEnLigne(page);
  const suivi = new URL(page.url()).pathname;
  await page.goBack();
  await expect(page).toHaveURL((u) => u.pathname === suivi);
  await expect(page.getByText("Page introuvable")).toHaveCount(0);
});

test("CM-22 : le suivi reprend le nom de la carte", async ({ page }) => {
  await poser(page, retrait, [L("pizza-margherita", 2), L("pizza-peppino")]);
  await payerEnLigne(page);
  await expect(page.locator(".suivi-detail")).toContainText("2 × Margherita");
  await expect(page.locator(".suivi-detail")).toContainText("1 × Peppino");
  await expect(page.locator(".suivi-detail")).not.toContainText("Pizza peppino");
});

test("CM-15 : un panier de plus de 24 h est vidé avec une explication, une seule fois", async ({ page }) => {
  await poser(page, retrait, [L("pizza-margherita", 2)], 25 * 3600 * 1000);
  await page.goto("/panier");
  await expect(page.getByText("Votre panier précédent avait plus de 24 heures. Il a été vidé.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Votre panier est vide.", { exact: false })).toBeVisible();
  await expect(page.getByText("Votre panier précédent avait plus de 24 heures.", { exact: false })).toHaveCount(0);
});

test("CM-23 : « − » sur la dernière unité, la ligne revient avec « Annuler »", async ({ page }) => {
  await poser(page, retrait, [L("pizza-margherita", 1, { note: "Bien cuite" }), L("lasagne-de-boeuf")]);
  await page.goto("/panier");
  await page.getByRole("button", { name: "Retirer du panier" }).first().click();
  await expect(page.locator(".ligne-nom", { hasText: "Margherita" })).toHaveCount(0);
  await expect(page.getByText("Margherita n'est plus dans le panier.")).toBeVisible();
  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(page.locator(".lignes > li").first()).toContainText("Margherita");
  await expect(page.locator(".lignes > li").first()).toContainText("Bien cuite");
  const panier = await page.evaluate(() => JSON.parse(localStorage.getItem("laferme.panier.v1")!).lignes);
  expect(panier.map((l: { slug: string }) => l.slug)).toEqual(["pizza-margherita", "lasagne-de-boeuf"]);
});

test("CM-21 : un tap sur « À emporter » avant la fin du chargement n'est pas perdu", async ({ page }) => {
  await page.route("**/_next/static/chunks/**", async (r) => {
    await new Promise((ok) => setTimeout(ok, 2500));
    await r.continue();
  });
  await page.goto("/?heure=2026-11-10T19:05", { waitUntil: "commit" });
  await page.getByRole("button", { name: /À emporter/ }).click({ noWaitAfter: true });
  await expect(page.getByRole("button", { name: /À emporter/ })).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
});

test("CM-21 : une adresse tapée avant la fin du chargement est gardée et cherchée", async ({ page }) => {
  await page.route("**/_next/static/chunks/**", async (r) => {
    await new Promise((ok) => setTimeout(ok, 2500));
    await r.continue();
  });
  await page.goto("/?heure=2026-11-10T19:05", { waitUntil: "commit" });
  await page.getByLabel("Adresse de livraison").pressSequentially("Avenue du Gros-Chêne 20");
  await expect(page.locator(".suggestions button").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("Adresse de livraison")).toHaveValue("Avenue du Gros-Chêne 20");
});

test("plat épuisé entre le panier et le paiement : le récapitulatif se recalcule après le refus", async ({ page }) => {
  await poser(page, retrait, [L("pizza-margherita", 2)]);
  await page.route("**/api/commandes", (r) => r.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ erreur: "Margherita : Épuisé pour aujourd'hui." }) }));
  await page.goto("/commande");
  await page.getByLabel("Prénom").fill("Test");
  await page.getByLabel("Nom", { exact: true }).fill("Rupture");
  await page.getByLabel("Téléphone").fill("079 000 00 00");
  await page.getByLabel("E-mail", { exact: true }).fill("rupture@laferme.test");
  await page.waitForLoadState("networkidle");
  const recalcul = page.waitForRequest("**/api/panier");
  await page.getByRole("button", { name: /^Payer CHF/ }).click();
  await expect(page.getByText("Margherita : Épuisé pour aujourd'hui.")).toBeVisible();
  await recalcul;
});

test("créneau complet entre le choix et le paiement : le refus mène au choix de l'heure", async ({ page }) => {
  await poser(page, { ...retrait, quand: { type: "creneau", date: "2026-11-10", minutes: 1230 } }, [L("pizza-margherita", 2)]);
  await page.route("**/api/commandes", (r) =>
    r.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ erreur: "Ce créneau est complet. Choisissez une autre heure ou appelez-nous au 022 792 16 89." }) }),
  );
  await page.goto("/commande");
  await page.getByLabel("Prénom").fill("Test");
  await page.getByLabel("Nom", { exact: true }).fill("Complet");
  await page.getByLabel("Téléphone").fill("079 000 00 00");
  await page.getByLabel("E-mail", { exact: true }).fill("complet@laferme.test");
  await page.getByRole("button", { name: /^Payer CHF/ }).click();
  const alerte = page.locator(".commande-form .panier-alerte");
  await expect(alerte).toContainText("Ce créneau est complet.");
  await expect(alerte.getByRole("link", { name: "Changer l'heure" })).toHaveAttribute("href", "/");
});

test.describe("téléphone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("CM-26 : une fois l'adresse choisie, « Voir la carte » est à l'écran", async ({ page }) => {
    await page.goto("/?heure=2026-11-10T19:05");
    await page.getByLabel("Adresse de livraison").fill("Avenue du Gros-Chêne 20");
    await page.locator(".suggestions button").first().click();
    await expect(page.getByText("Dans notre zone de livraison")).toBeVisible();
    const bouton = page.getByRole("button", { name: "Voir la carte" });
    await expect(bouton).toBeInViewport();
    await expect(page.getByLabel("Nom sur la sonnette")).toBeInViewport();
  });

  test("CM-26 : à emporter, « Voir la carte » est à l'écran", async ({ page }) => {
    await page.goto("/?heure=2026-11-10T19:05");
    await page.getByRole("button", { name: /À emporter/ }).click();
    await expect(page.getByRole("button", { name: "Voir la carte" })).toBeInViewport();
  });
});
