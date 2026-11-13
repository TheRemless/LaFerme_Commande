import { expect, test } from "@playwright/test";

// Vague 3, client-commande : restaurant qui se met en pause pendant que le client remplit le formulaire,
// sans changer d'onglet. Le total est recalculé chaque minute : la raison s'affiche avant « Payer ».

test("pause pendant la saisie : annoncée dans la minute, sans clic sur « Payer »", async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(() => {
    if (sessionStorage.getItem("pose")) return;
    sessionStorage.setItem("pose", "1");
    localStorage.setItem("laferme.choix.v1", JSON.stringify({ mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05", enregistreLe: Date.now() }));
    localStorage.setItem("laferme.panier.v1", JSON.stringify({ le: Date.now(), lignes: [{ slug: "pizza-margherita", qte: 2, choix: {}, retraits: [], note: "" }] }));
  });
  await page.goto("/commande");
  await page.clock.runFor(2000);
  await expect(page.getByRole("button", { name: /^Payer CHF/ })).toBeEnabled();
  await page.route("**/api/panier", async (r) => {
    const vraie = await (await r.fetch()).json();
    await r.fulfill({ json: { ...vraie, valide: false, message_quand: "Les commandes en ligne sont en pause jusqu'à 21h00." } });
  });
  await page.getByLabel("Prénom").fill("Test");
  await page.clock.runFor(61_000);
  await expect(page.locator(".commande-form .panier-alerte")).toContainText("en pause");
  await expect(page.getByRole("button", { name: /^Payer/ })).toBeDisabled();
});
