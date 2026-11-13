import { expect, test, type Page } from "@playwright/test";

// Vague 3, client-commande : champ « Code » des codes promo (moteur de bo-carte), éteint par défaut.
// Le calcul de la remise est testé côté serveur (tests/unit/code-promo-client.test.ts) ; ici, l'écran.

const retrait = { mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05" };

async function poser(page: Page) {
  await page.addInitScript((c) => {
    if (sessionStorage.getItem("pose")) return;
    sessionStorage.setItem("pose", "1");
    localStorage.setItem("laferme.choix.v1", JSON.stringify({ ...c, enregistreLe: Date.now() }));
    localStorage.setItem("laferme.panier.v1", JSON.stringify({ le: Date.now(), lignes: [{ slug: "pizza-margherita", qte: 2, choix: {}, retraits: [], note: "" }] }));
  }, retrait);
}

test("éteint par défaut : pas de champ « Code »", async ({ page }) => {
  await poser(page);
  await page.goto("/commande");
  await expect(page.getByLabel("Prénom")).toBeVisible();
  await expect(page.getByLabel(/^Code/)).toHaveCount(0);
});

test("un QR /?code= range le code dans l'onglet et le retire de l'adresse", async ({ page }) => {
  await page.goto("/?code=flyer-onex&heure=2026-11-10T19:05");
  await expect(page).toHaveURL((u) => !u.searchParams.has("code") && u.searchParams.get("heure") === "2026-11-10T19:05");
  expect(await page.evaluate(() => sessionStorage.getItem("laferme.code"))).toBe("FLYER-ONEX");
});

test("allumé : le code s'applique, la remise s'affiche et part avec la commande", async ({ page }) => {
  await poser(page);
  await page.route("**/commande", async (r) => {
    if (r.request().resourceType() !== "document") return r.continue();
    const rep = await r.fetch();
    await r.fulfill({ response: rep, body: (await rep.text()).replaceAll('\\"codesActifs\\":false', '\\"codesActifs\\":true') });
  });
  // Réponse du calcul : la remise vient du serveur (simulée ici, le réglage de la base reste éteint).
  await page.route("**/api/panier", async (r) => {
    const corps = JSON.parse(r.request().postData() ?? "{}");
    const vraie = await (await r.fetch()).json();
    if (corps.code !== "ESSAI-DIX") return r.fulfill({ json: vraie });
    await r.fulfill({
      json: { ...vraie, code: { code: "ESSAI-DIX", ok: true, remise_centimes: 360 }, remise_centimes: 360, total_centimes: vraie.total_centimes - 360 },
    });
  });
  await page.goto("/commande");
  await page.getByLabel(/^Code/).fill("essai-dix");
  await page.getByRole("button", { name: "Appliquer" }).click();
  await expect(page.getByText("Code ESSAI-DIX : − CHF 3.60.")).toBeVisible();
  await expect(page.locator(".sommes")).toContainText("Code ESSAI-DIX");
  await page.getByLabel("Prénom").fill("Test");
  await page.getByLabel("Nom", { exact: true }).fill("Code");
  await page.getByLabel("Téléphone", { exact: true }).fill("079 000 00 00");
  await page.getByLabel("E-mail", { exact: true }).fill("code@laferme.test");
  await page.getByText("Au comptoir").click();
  const envoi = page.waitForRequest((r) => r.url().endsWith("/api/commandes") && r.method() === "POST");
  await page.getByRole("button", { name: /^Commander, je paie au comptoir/ }).click();
  expect(JSON.parse((await envoi).postData() ?? "{}").code).toBe("ESSAI-DIX");
});
