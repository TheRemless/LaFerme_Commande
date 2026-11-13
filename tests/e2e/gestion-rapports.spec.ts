import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adresseDuCompte } from "./site";

// Rapports du back-office (vague 3, bo-pilotage) : période, service, état vide ou chiffres, réseau coupé.
// Les chiffres eux-mêmes sont vérifiés en base (tests/unit/pilotage-ventes-sql.test.ts).
test.describe.configure({ mode: "serial" });

let gestion: Page;

test.beforeAll(async ({ browser }, info) => {
  gestion = await (await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL })).newPage();
  const email = `rapports-${info.project.name}@laferme.test`;
  await gestion.goto("/gestion/rapports");
  await adresseDuCompte(gestion, email);
  await gestion.getByLabel("E-mail", { exact: true }).fill(email);
  await gestion.getByRole("button", { name: "Recevoir un code" }).click();
  const code = gestion.locator(".note-preversion strong");
  // Premier test sur un serveur qui vient de démarrer : la base embarquée se charge à la première demande,
  // le code peut mettre plus de 5 s à s'afficher. Un second clic tomberait sur la limite d'un code par 30 s.
  await expect(code).toHaveText(/^\d{8}$/, { timeout: 30000 });
  await gestion.getByLabel("Code à 8 chiffres").fill(await code.innerText());
  await gestion.getByRole("button", { name: "Me connecter" }).click();
  await expect(gestion.getByRole("heading", { level: 1, name: "Rapports" })).toBeVisible();
});

test.afterAll(async () => {
  await gestion.context().close();
});

const resultat = () => gestion.getByRole("heading", { name: "L'essentiel" }).or(gestion.getByText("Aucune commande sur cette période."));

test("une période et un service donnent les chiffres ou un état vide clair, sans débordement", async () => {
  await expect(resultat()).toBeVisible();
  const reponse = gestion.waitForResponse((r) => r.url().includes("/api/gestion/pilotage/ventes") && r.url().includes("service=soir"));
  await gestion.getByText("Soir", { exact: true }).click();
  expect((await reponse).status()).toBe(200);
  await expect(gestion.getByRole("radio", { name: "Soir" })).toBeChecked();
  await expect(gestion.getByText(/, le soir, comparé/)).toBeVisible();
  await expect(resultat()).toBeVisible();

  await gestion.getByRole("button", { name: "30 derniers jours" }).click();
  await expect(resultat()).toBeVisible();
  expect(await gestion.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  const axe = await new AxeBuilder({ page: gestion }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
});

test("le réseau coupé se dit, et « Réessayer » relit les chiffres", async () => {
  await gestion.route("**/api/gestion/pilotage/ventes**", (route) => route.abort("internetdisconnected"));
  await gestion.getByText("Midi", { exact: true }).click();
  await expect(gestion.getByText("Pas de connexion. Vérifiez le réseau et réessayez.")).toBeVisible();
  await gestion.unroute("**/api/gestion/pilotage/ventes**");
  await gestion.getByRole("button", { name: "Réessayer" }).click();
  await expect(resultat()).toBeVisible();
});
