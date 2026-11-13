import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adresseDuCompte } from "./site";

// Appareils connectés de l'équipe (vague 3, bo-socle) : le gérant voit les appareils d'un membre et en coupe un.
test.describe.configure({ mode: "serial" });

async function connecter(page: Page, url: string, email: string) {
  await adresseDuCompte(page, email);
  await page.goto(url);
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Recevoir un code" }).click();
  const code = page.locator(".note-preversion strong");
  await expect(code).toHaveText(/^\d{8}$/);
  await page.getByLabel("Code à 8 chiffres").fill(await code.innerText());
  await page.getByRole("button", { name: "Me connecter" }).click();
}

test("le gérant voit l'appareil d'un membre et le déconnecte, les autres restent connectés", async ({ browser }, info) => {
  const gerant = await (await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL })).newPage();
  const membre = await (await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL })).newPage();
  await connecter(gerant, "/gestion/equipe", `appareils-${info.project.name}@laferme.test`);
  await connecter(membre, "/tablette", `appareils-service-${info.project.name}@laferme.test`);
  await expect(membre.getByRole("button", { name: "Recevoir un code" })).toHaveCount(0);

  await gerant.reload();
  const ligne = gerant.locator(".ges-equipe li", { hasText: `appareils-service-${info.project.name}@laferme.test` });
  await ligne.getByRole("button", { name: /^Appareils \(\d+\)$/ }).click();
  const panneau = gerant.getByRole("dialog", { name: new RegExp("^Appareils de Téléphone") });
  await expect(panneau).toBeVisible();
  // Libellé tiré du navigateur simulé par Playwright : Chrome sur PC (bureau) ou sur un téléphone Android (mobile).
  await expect(panneau.locator(".ges-appareils li").first()).toContainText(info.project.name === "mobile" ? "Chrome sur Android" : "Chrome sur Windows");
  await expect(panneau).toContainText("Connecté le");
  const r = await new AxeBuilder({ page: gerant }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);

  await panneau.getByRole("button", { name: "Déconnecter" }).first().click();
  const boite = gerant.getByRole("dialog", { name: /^Déconnecter / });
  await boite.getByRole("button", { name: "Déconnecter" }).click();
  await expect(gerant.locator(".bo-notif", { hasText: "Appareil déconnecté." })).toBeVisible();

  // Le membre doit se reconnecter sur cet appareil.
  await membre.reload();
  await expect(membre.getByRole("button", { name: "Recevoir un code" })).toBeVisible();
  // Le gérant, lui, reste connecté.
  await gerant.reload();
  await expect(gerant.getByRole("heading", { level: 1, name: "Équipe" })).toBeVisible();
  await gerant.context().close();
  await membre.context().close();
});
