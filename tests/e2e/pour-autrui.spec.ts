import { expect, test, type Page } from "@playwright/test";

// Vague 3, client-commande : commander pour quelqu'un d'autre.

const retrait = { mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05" };

async function poser(page: Page) {
  await page.addInitScript((choix) => {
    if (sessionStorage.getItem("pose")) return;
    sessionStorage.setItem("pose", "1");
    localStorage.setItem("laferme.choix.v1", JSON.stringify({ ...choix, enregistreLe: Date.now() }));
    localStorage.setItem("laferme.panier.v1", JSON.stringify({ le: Date.now(), lignes: [{ slug: "pizza-margherita", qte: 2, choix: {}, retraits: [], note: "" }] }));
  }, retrait);
}

async function coordonnees(page: Page) {
  await page.getByLabel("Prénom").fill("Léa");
  await page.getByLabel("Nom", { exact: true }).fill("Rochat");
  await page.getByLabel("Téléphone", { exact: true }).fill("079 000 00 00");
  await page.getByLabel("E-mail", { exact: true }).fill("autrui@laferme.test");
}

test("la personne qui vient chercher part avec la commande, après un rechargement aussi", async ({ page }) => {
  await poser(page);
  await page.goto("/commande");
  await coordonnees(page);
  await page.getByText("Je commande pour quelqu'un d'autre").click();
  await expect(page.getByText("La personne qui vient chercher la commande.", { exact: false })).toBeVisible();
  await page.getByLabel("Son nom").fill("Marc Rochat");
  await page.getByLabel("Son téléphone").fill("079 111 22 33");
  await page.reload();
  await expect(page.getByLabel("Son nom")).toHaveValue("Marc Rochat");
  await page.getByText("Au comptoir").click();
  const envoi = page.waitForRequest((r) => r.url().endsWith("/api/commandes") && r.method() === "POST");
  await page.getByRole("button", { name: /^Commander, je paie au comptoir/ }).click();
  expect(JSON.parse((await envoi).postData() ?? "{}").destinataire).toEqual({ nom: "Marc Rochat", telephone: "079 111 22 33" });
  await expect(page).toHaveURL(/\/suivi\//);
  expect(await page.evaluate(() => sessionStorage.getItem("laferme.destinataire"))).toBeNull();
});

test("un téléphone faux pour la personne est nommé avant l'envoi", async ({ page }) => {
  await poser(page);
  await page.goto("/commande");
  await coordonnees(page);
  await page.getByText("Je commande pour quelqu'un d'autre").click();
  await page.getByLabel("Son nom").fill("Marc");
  await page.getByLabel("Son téléphone").fill("1234 5678");
  let envois = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/commandes")) envois++;
  });
  await page.getByRole("button", { name: /^Payer CHF/ }).click();
  await expect(page.getByLabel("Son téléphone")).toBeFocused();
  await expect(page.getByText("Vérifiez le numéro de téléphone", { exact: false })).toBeVisible();
  expect(envois).toBe(0);
});

test("décochée, la commande est pour soi", async ({ page }) => {
  await poser(page);
  await page.goto("/commande");
  await coordonnees(page);
  await page.getByText("Je commande pour quelqu'un d'autre").click();
  await page.getByLabel("Son nom").fill("Marc");
  await page.getByText("Je commande pour quelqu'un d'autre").click();
  await page.getByText("Au comptoir").click();
  const envoi = page.waitForRequest((r) => r.url().endsWith("/api/commandes") && r.method() === "POST");
  await page.getByRole("button", { name: /^Commander, je paie au comptoir/ }).click();
  expect(JSON.parse((await envoi).postData() ?? "{}").destinataire).toBeNull();
});
