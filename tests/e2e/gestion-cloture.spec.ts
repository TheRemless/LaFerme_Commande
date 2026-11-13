import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adresseDuCompte, codeDuPersonnel } from "./site";

// Clôture du jour (vague 3, bo-pilotage) : compter la caisse, confirmer, clôturer, reclôturer ; montants
// illisibles refusés près du champ ; réseau coupé. Les calculs sont vérifiés en base (tests/unit/cloture-jour-sql.test.ts).
test.describe.configure({ mode: "serial" });

let gestion: Page;

test.beforeAll(async ({ browser }, info) => {
  gestion = await (await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL })).newPage();
  const email = `cloture-${info.project.name}@laferme.test`;
  // Connexion commune (tests/e2e/site.ts) : codeDuPersonnel attend le délai d'un code quand la CI réessaie.
  await adresseDuCompte(gestion, email);
  await gestion.goto("/gestion/cloture");
  await gestion.getByLabel("E-mail", { exact: true }).fill(email);
  await gestion.getByLabel("Code à 8 chiffres").fill(await codeDuPersonnel(gestion));
  await gestion.getByRole("button", { name: "Me connecter" }).click();
  await expect(gestion.getByRole("heading", { level: 1, name: "Clôture du jour" })).toBeVisible();
});

test.afterAll(async () => {
  await gestion.context().close();
});

test("hier se clôture après confirmation, puis se reclôture ; un montant illisible est refusé près du champ", async () => {
  // Attendre que l'écran montre le jour choisi : pendant le chargement le titre disparaît, et une saisie faite
  // trop tôt serait vidée par l'arrivée des données.
  const titre = gestion.getByRole("heading", { level: 2, name: /^Clôture du / });
  const avant = await titre.innerText();
  await gestion.getByRole("button", { name: "Hier", exact: true }).click();
  await expect(gestion.getByLabel("Jour de service")).not.toHaveValue(/^$/);
  await expect(titre).toBeVisible();
  await expect(titre).not.toHaveText(avant);
  const especes = gestion.getByLabel("Espèces comptées (CHF)");

  // Un clic d'abord, comme une personne : le champ peut être recréé pendant le tout premier rendu des données.
  await especes.click();
  await especes.fill("douze");
  await expect(especes).toHaveValue("douze");
  await gestion.locator(".clo-form").getByRole("button", { name: /Clôturer le jour|Reclôturer/ }).click();
  await expect(gestion.getByText("Montant illisible : écrivez par exemple 1250.50.")).toBeVisible();

  await especes.click();
  await especes.fill("0");
  await expect(especes).toHaveValue("0");
  await gestion.getByLabel("Carte au comptoir (CHF)").fill("");
  await gestion.locator(".clo-form").getByRole("button", { name: /Clôturer le jour|Reclôturer/ }).click();
  const boite = gestion.getByRole("dialog");
  await expect(boite).toContainText("Attendu au comptoir");
  await boite.getByRole("button", { name: /^(Clôturer le jour|Reclôturer)$/ }).click();
  await expect(gestion.getByText(/clôturé\.$/).first()).toBeVisible();
  await expect(gestion.getByText(/^Jour de service de 5h à 5h le lendemain\. Clôturé le /)).toBeVisible();
  await expect(gestion.locator(".clo-form").getByRole("button", { name: "Reclôturer" })).toBeVisible();
  await expect(especes).toHaveValue("0.00");

  // La notification entre en fondu : axe lirait un contraste faible pendant l'animation.
  await gestion.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  const axe = await new AxeBuilder({ page: gestion }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  expect(await gestion.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test("le fichier CSV se télécharge, et le réseau coupé se dit avec « Réessayer »", async () => {
  const telechargement = gestion.waitForEvent("download");
  await gestion.getByRole("link", { name: "Télécharger (CSV)" }).click();
  expect((await telechargement).suggestedFilename()).toMatch(/^la-ferme-cloture-\d{4}-\d{2}-\d{2}\.csv$/);

  await gestion.route("**/api/gestion/cloture?**", (route) => route.abort("internetdisconnected"));
  await gestion.getByRole("button", { name: "Aujourd'hui" }).click();
  await expect(gestion.getByText("Pas de connexion. Vérifiez le réseau et réessayez.")).toBeVisible();
  await gestion.unroute("**/api/gestion/cloture?**");
  await gestion.getByRole("button", { name: "Réessayer" }).click();
  await expect(gestion.getByRole("heading", { level: 2, name: /^Clôture du / })).toBeVisible();
});
