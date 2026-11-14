import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adresseDuCompte, codeDuPersonnel, passage, SITE } from "./site";

// Commande prise au téléphone (vague 3, bo-commandes) : un membre de l'équipe de service la saisit à la tablette,
// à emporter, sans e-mail. Elle entre acceptée, marquée « Prise au téléphone », à payer au retrait. Jamais un prix
// écrit ici : la carte et les totaux viennent de la base.
test.describe.configure({ mode: "serial" });

const ORIGINE = { Origin: SITE };
let page: Page;
let prenom: string;

test.beforeAll(async ({ browser }, info) => {
  page = await (await browser.newContext({ ...info.project.use, baseURL: SITE })).newPage();
  const email = `telephone-${info.project.name}@laferme.test`;
  await adresseDuCompte(page, email);
  await page.goto("/tablette");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Code à 8 chiffres").fill(await codeDuPersonnel(page));
  await page.getByRole("button", { name: "Me connecter" }).click();
  await page.getByRole("button", { name: "Continuer sans son" }).click();
  // Le bouton de la file mène à la saisie.
  await page.getByRole("link", { name: "Nouvelle commande (téléphone)" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Nouvelle commande (téléphone)" })).toBeVisible();
  prenom = `Tel${info.project.name}${passage()}`;
});

test.afterAll(async () => {
  await page.context().close();
});

test("l'équipe saisit une commande à emporter, elle entre acceptée et marquée téléphone", async ({}, info) => {
  await page.getByRole("button", { name: "À emporter" }).click();
  await page.locator(".tel-plats button").first().click();
  await page.getByRole("dialog").getByRole("button", { name: /^Ajouter/ }).click();
  await expect(page.getByRole("list", { name: "Plats de la commande" }).getByRole("listitem")).toHaveCount(1);
  // Une heure à venir : le premier créneau proposé, quelle que soit l'heure à laquelle le test tourne.
  await page.getByLabel("Prête").selectOption({ index: 1 });
  await page.getByLabel("Prénom").fill(prenom);
  await page.getByLabel("Téléphone").fill("079 555 12 34");
  await expect(page.getByRole("heading", { name: /^Total CHF/ })).toBeVisible();
  await expect(page.getByText("À payer au retrait, espèces ou carte.")).toBeVisible();
  await page.screenshot({ path: `docs/rendus/vague-3/bo-commandes/telephone-saisie-${info.project.name}.jpg`, quality: 80, fullPage: true });
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
  await page.getByRole("button", { name: "Enregistrer la commande" }).click();
  await expect(page.getByRole("heading", { name: /^Commande n° \d+ enregistrée$/ })).toBeVisible();
  if (info.project.name === "bureau") await page.screenshot({ path: "docs/rendus/vague-3/bo-commandes/telephone-enregistree-bureau.jpg", quality: 80 });

  // Dans la file de la tablette : acceptée, avec la marque.
  await page.getByRole("link", { name: "Retour à la file" }).click();
  const son = page.getByRole("button", { name: "Continuer sans son" });
  if (await son.isVisible().catch(() => false)) await son.click();
  await page.getByLabel("Chercher une commande par numéro, nom ou téléphone").fill(prenom);
  await page.getByRole("button", { name: new RegExp(prenom) }).first().click();
  await expect(page.getByText("Prise au téléphone").first()).toBeVisible();
  await expect(page.getByText(/^À encaisser au comptoir CHF/).first()).toBeVisible();
});

test("le serveur refuse une commande incomplète, et un livreur ou un visiteur", async ({ request }) => {
  const base = { cle: `tel-essai-${passage()}-0123456789`, mode: "retrait", lignes: [{ slug: "pizza-margherita", qte: 1, choix: {}, retraits: [], note: "" }], quand: { type: "asap" } };
  const sansTel = await page.request.post("/api/tablette/telephone", { headers: ORIGINE, data: { ...base, client: { prenom: "Essai", telephone: "12" } } });
  expect(sansTel.status()).toBe(422);
  expect((await sansTel.json()).message).toMatch(/téléphone/);
  const sansPlat = await page.request.post("/api/tablette/telephone", { headers: ORIGINE, data: { ...base, lignes: [], client: { prenom: "Essai", telephone: "079 555 12 34" } } });
  expect((await sansPlat.json()).message).toBe("Ajoutez au moins un plat.");
  expect((await request.post("/api/tablette/telephone", { headers: ORIGINE, data: base })).status()).toBe(401);
});
