import { expect, test, type Page } from "@playwright/test";

// Vague 3, client-commande : rien n'est laissé gris sans raison entre le panier et le paiement.
// Réseau coupé, calcul lent, créneau rempli entre-temps, retour sur l'onglet, double clic sur « Payer ».

const L = (slug: string, qte = 1) => ({ slug, qte, choix: {}, retraits: [], note: "" });
const retrait = { mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05" };

async function poser(page: Page, choix: Record<string, unknown>, lignes: unknown[]) {
  await page.addInitScript(
    ([choix, lignes]) => {
      if (sessionStorage.getItem("pose")) return;
      sessionStorage.setItem("pose", "1");
      localStorage.setItem("laferme.choix.v1", JSON.stringify({ ...choix, enregistreLe: Date.now() }));
      localStorage.setItem("laferme.panier.v1", JSON.stringify({ le: Date.now(), lignes }));
    },
    [choix, lignes] as const,
  );
}

async function remplir(page: Page, nom: string) {
  await page.getByLabel("Prénom").fill("Test");
  await page.getByLabel("Nom", { exact: true }).fill(nom);
  await page.getByLabel("Téléphone").fill("079 000 00 00");
  await page.getByLabel("E-mail", { exact: true }).fill(`${nom.toLowerCase()}@laferme.test`);
}

test("réseau coupé pendant le calcul : la raison s'affiche et « Réessayer » relance", async ({ page }) => {
  await poser(page, retrait, [L("pizza-margherita", 2)]);
  await page.route("**/api/panier", (r) => r.abort("internetdisconnected"));
  await page.goto("/commande");
  await expect(page.getByText("Le total n'a pas pu être calculé. Vérifiez la connexion.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Payer/ })).toBeDisabled();
  await page.unroute("**/api/panier");
  await page.getByRole("button", { name: "Réessayer" }).click();
  await expect(page.getByRole("button", { name: /^Payer CHF/ })).toBeEnabled();
  await expect(page.getByText("Le total n'a pas pu être calculé.", { exact: false })).toHaveCount(0);
});

test("calcul lent : le panier dit qu'il calcule au lieu d'un bouton gris muet", async ({ page }) => {
  await poser(page, retrait, [L("pizza-margherita", 2)]);
  await page.route("**/api/panier", async (r) => {
    await new Promise((ok) => setTimeout(ok, 3000));
    await r.continue();
  });
  await page.goto("/panier");
  await expect(page.getByText("Calcul du total en cours…")).toBeVisible();
  await expect(page.getByRole("link", { name: /^Commander, / })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Calcul du total en cours…")).toHaveCount(0);
});

test("créneau rempli entre-temps : annoncé avant le clic sur « Payer », avec le lien vers l'heure", async ({ page }) => {
  await poser(page, { ...retrait, quand: { type: "creneau", date: "2026-11-10", minutes: 1230 } }, [L("pizza-margherita", 2)]);
  await page.route("**/api/panier", async (r) => {
    const vraie = await (await r.fetch()).json();
    await r.fulfill({
      json: { ...vraie, valide: false, creneau_complet: true, message_quand: "Ce créneau est complet. Choisissez une autre heure ou appelez-nous au 022 792 16 89." },
    });
  });
  await page.goto("/commande");
  const alerte = page.locator(".commande-form .panier-alerte");
  await expect(alerte).toContainText("Ce créneau est complet.");
  await expect(alerte.getByRole("link", { name: "Changer l'heure" })).toHaveAttribute("href", "/");
  await expect(page.getByRole("button", { name: /^Payer/ })).toBeDisabled();
});

test("retour sur l'onglet : le panier est recalculé (plat épuisé, pause, créneau plein entre-temps)", async ({ page }) => {
  await poser(page, retrait, [L("pizza-margherita", 2)]);
  await page.goto("/commande");
  await expect(page.getByRole("button", { name: /^Payer CHF/ })).toBeEnabled();
  await page.route("**/api/panier", async (r) => {
    const vraie = await (await r.fetch()).json();
    await r.fulfill({ json: { ...vraie, valide: false, message_quand: "Les commandes en ligne sont en pause. Appelez-nous au 022 792 16 89." } });
  });
  const recalcul = page.waitForRequest("**/api/panier");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await recalcul;
  await expect(page.locator(".commande-form .panier-alerte")).toContainText("en pause");
  await expect(page.getByRole("button", { name: /^Payer/ })).toBeDisabled();
});

test("double clic sur « Payer » : une seule commande", async ({ page }) => {
  await poser(page, retrait, [L("pizza-margherita", 2)]);
  const envois: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/commandes") && r.method() === "POST") envois.push(JSON.parse(r.postData() ?? "{}").cle);
  });
  await page.goto("/commande");
  await remplir(page, "Doubleclic");
  await expect(page.getByRole("button", { name: /^Payer CHF/ })).toBeEnabled();
  await page.getByRole("button", { name: /^Payer CHF/ }).dblclick();
  await expect(page).toHaveURL(/paiement-test/);
  // Deux envois au plus, avec la même clé : le serveur n'en garde qu'une commande.
  expect(new Set(envois).size).toBe(1);
});

test("paiement annulé sur un créneau : la place tenue par sa propre commande ne le bloque pas", async ({ page }) => {
  await poser(page, { ...retrait, quand: { type: "creneau", date: "2026-11-10", minutes: 1245 } }, [L("pizza-margherita", 2)]);
  await page.goto("/commande");
  await remplir(page, "Annule");
  await page.getByRole("button", { name: /^Payer CHF/ }).click();
  await expect(page).toHaveURL(/paiement-test/);
  const recalcul = page.waitForRequest((r) => r.url().endsWith("/api/panier"));
  await page.goto("/commande?annule=1");
  expect(JSON.parse((await recalcul).postData() ?? "{}").placeTenue).toBe(true);
  await expect(page.getByRole("button", { name: /^Payer CHF/ })).toBeEnabled();
});
