import { expect, test, type Page } from "@playwright/test";

// Vague 3, client-commande : allergie ou intolérance pour toute la commande, transmise à la cuisine.
// Gardée dans l'onglet (rechargement, refus), effacée une fois la commande passée, jamais dans le compte.

const retrait = { mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05" };

async function poser(page: Page) {
  await page.addInitScript((choix) => {
    if (sessionStorage.getItem("pose")) return;
    sessionStorage.setItem("pose", "1");
    localStorage.setItem("laferme.choix.v1", JSON.stringify({ ...choix, enregistreLe: Date.now() }));
    localStorage.setItem("laferme.panier.v1", JSON.stringify({ le: Date.now(), lignes: [{ slug: "pizza-margherita", qte: 2, choix: {}, retraits: [], note: "" }] }));
  }, retrait);
}

test("l'allergie part avec la commande, survit au rechargement puis s'efface", async ({ page }) => {
  await poser(page);
  await page.goto("/commande");
  const champ = page.getByLabel("Allergie ou intolérance");
  await expect(champ).toHaveAttribute("maxlength", "120");
  await champ.fill("Arachides (enfant de 6 ans)");
  await page.reload();
  await expect(page.getByLabel("Allergie ou intolérance")).toHaveValue("Arachides (enfant de 6 ans)");

  await page.getByLabel("Prénom").fill("Test");
  await page.getByLabel("Nom", { exact: true }).fill("Allergie");
  await page.getByLabel("Téléphone").fill("079 000 00 00");
  await page.getByLabel("E-mail", { exact: true }).fill("allergie@laferme.test");
  await page.getByText("Au comptoir").click();
  const envoi = page.waitForRequest((r) => r.url().endsWith("/api/commandes") && r.method() === "POST");
  await page.getByRole("button", { name: /^Commander, je paie au comptoir/ }).click();
  expect(JSON.parse((await envoi).postData() ?? "{}").allergie).toBe("Arachides (enfant de 6 ans)");
  await expect(page).toHaveURL(/\/suivi\//);
  expect(await page.evaluate(() => sessionStorage.getItem("laferme.allergie"))).toBeNull();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("Arachides");
});

test("sans allergie, le champ reste facultatif", async ({ page }) => {
  await poser(page);
  await page.goto("/commande");
  await expect(page.getByLabel("Allergie ou intolérance")).not.toHaveAttribute("required", "");
  await expect(page.getByText("sans pouvoir garantir l'absence de traces", { exact: false })).toBeVisible();
});

test("une allergie saisie il y a plus de deux heures n'est pas reprise", async ({ page }) => {
  await poser(page);
  await page.addInitScript(() => {
    if (sessionStorage.getItem("allergie-posee")) return;
    sessionStorage.setItem("allergie-posee", "1");
    sessionStorage.setItem("laferme.allergie", JSON.stringify({ texte: "Gluten", le: Date.now() - 3 * 3600 * 1000 }));
  });
  await page.goto("/commande");
  await expect(page.getByLabel("Allergie ou intolérance")).toHaveValue("");
});
