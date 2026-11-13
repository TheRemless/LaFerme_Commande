import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Coque du back-office (vague 3) : une adresse par rubrique, retour arrière, connexion qui garde la page
// demandée, menu latéral repliable, tiroir sur téléphone. Gérant de test à part (un code par 30 s et par e-mail).
test.describe.configure({ mode: "serial" });

let gestion: Page;

async function connecter(page: Page, email: string) {
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Recevoir un code" }).click();
  const code = page.locator(".note-preversion strong");
  await expect(code).toHaveText(/^\d{8}$/);
  await page.getByLabel("Code à 8 chiffres").fill(await code.innerText());
  await page.getByRole("button", { name: "Me connecter" }).click();
}

const menu = (page: Page) => page.getByRole("navigation", { name: "Rubriques" });
const titre = (page: Page, t: string) => expect(page.getByRole("heading", { level: 1, name: t })).toBeVisible();

async function ouvrirMenuSiTelephone(page: Page) {
  const bouton = page.getByRole("button", { name: "Menu", exact: true });
  if (await bouton.isVisible()) await bouton.click();
}

test.beforeAll(async ({ browser }, info) => {
  // Un contexte à soi : axe-core le demande pour analyser la page.
  gestion = await (await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL })).newPage();
  // Adresse profonde sans session : la connexion s'affiche, puis on reste sur la rubrique demandée.
  await gestion.goto("/gestion/equipe");
  await expect(gestion.getByRole("heading", { name: "Back-office du restaurant" })).toBeVisible();
  await connecter(gestion, `coque-${info.project.name}@laferme.test`);
  await titre(gestion, "Équipe");
  await expect(gestion).toHaveURL(/\/gestion\/equipe$/);
});

test.afterAll(async () => {
  await gestion.context().close();
});

test("chaque rubrique a son adresse, son titre et sa place marquée dans le menu", async () => {
  await gestion.goto("/gestion/journal");
  await titre(gestion, "Journal");
  await expect(gestion).toHaveTitle("Journal, back-office La Ferme");
  await ouvrirMenuSiTelephone(gestion);
  await expect(menu(gestion).getByRole("link", { name: "Journal", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(menu(gestion).locator('[aria-current="page"]')).toHaveCount(1);
  await expect(gestion.getByText("Chiffres", { exact: true }).first()).toBeVisible();

  await gestion.goto("/gestion");
  await titre(gestion, "Accueil");
  await expect(gestion).toHaveTitle("Back-office, La Ferme");
  // Le plan de l'accueil mène aux rubriques.
  await gestion.locator(".bo-plan").getByRole("link", { name: /^Imprimantes/ }).click();
  await titre(gestion, "Imprimantes");
});

test("le retour arrière du navigateur ramène à la rubrique précédente", async () => {
  await gestion.goto("/gestion/carte");
  await titre(gestion, "Carte");
  await ouvrirMenuSiTelephone(gestion);
  await menu(gestion).getByRole("link", { name: "Export comptable", exact: true }).click();
  await titre(gestion, "Export comptable");
  await expect(gestion).toHaveURL(/\/gestion\/export$/);
  await gestion.goBack();
  await titre(gestion, "Carte");
  await expect(gestion).toHaveURL(/\/gestion\/carte$/);
});

test("la carte dit dans le menu combien de plats bloquent la mise en ligne", async () => {
  await gestion.goto("/gestion/carte");
  await ouvrirMenuSiTelephone(gestion);
  const lien = menu(gestion).getByRole("link", { name: "Carte", exact: true });
  await expect(lien).toHaveAccessibleDescription(/^\d+ plats? bloquen?t? la mise en ligne$/);
});

test("une adresse inconnue du back-office donne la page introuvable", async () => {
  const rep = await gestion.goto("/gestion/inconnue");
  expect(rep?.status()).toBe(404);
});

test("sur téléphone, le menu s'ouvre en tiroir et se ferme avec Échap ou en changeant de rubrique", async ({}, info) => {
  test.skip(info.project.name !== "mobile", "Tiroir seulement sur téléphone");
  await gestion.goto("/gestion");
  const bouton = gestion.getByRole("button", { name: "Menu", exact: true });
  await expect(menu(gestion)).toBeHidden();
  await bouton.click();
  await expect(bouton).toHaveAttribute("aria-expanded", "true");
  await expect(menu(gestion)).toBeVisible();
  await expect(gestion.getByRole("button", { name: "Fermer le menu" })).toBeFocused();
  const r = await new AxeBuilder({ page: gestion }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
  await gestion.keyboard.press("Escape");
  await expect(menu(gestion)).toBeHidden();
  await expect(bouton).toBeFocused();
  await bouton.click();
  await menu(gestion).getByRole("link", { name: "Commandes", exact: true }).click();
  await titre(gestion, "Commandes");
  await expect(menu(gestion)).toBeHidden();
});

test("sur ordinateur, le menu se réduit aux icônes et garde ce choix", async ({}, info) => {
  test.skip(info.project.name !== "bureau", "Menu repliable sur ordinateur et tablette");
  await gestion.goto("/gestion/commandes");
  await gestion.getByRole("button", { name: "Réduire le menu" }).click();
  const lien = menu(gestion).getByRole("link", { name: "Carte", exact: true });
  // Le nom reste lu, seule l'icône se voit : le lien se rétrécit.
  await expect.poll(async () => (await lien.boundingBox())?.width ?? 999).toBeLessThan(80);
  await gestion.reload();
  await expect(gestion.getByRole("button", { name: "Agrandir le menu" })).toBeVisible();
  const r = await new AxeBuilder({ page: gestion }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
  await gestion.getByRole("button", { name: "Agrandir le menu" }).click();
  await expect.poll(async () => (await lien.boundingBox())?.width ?? 0).toBeGreaterThan(150);
});

test("le personnel de service voit « Réservé au gérant » sur toutes les rubriques", async ({ browser }, info) => {
  const page = await browser.newPage({ baseURL: info.project.use.baseURL });
  await page.goto("/gestion/carte");
  await connecter(page, `coque-service-${info.project.name}@laferme.test`);
  await expect(page.getByText("Réservé au gérant.")).toBeVisible();
  for (const chemin of ["/gestion/equipe", "/gestion/journal", "/gestion/commandes"]) {
    await page.goto(chemin);
    await expect(page.getByText("Réservé au gérant.")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Rubriques" })).toHaveCount(0);
  }
  await page.close();
});

test("se déconnecter ramène à l'écran de connexion sur la même adresse", async () => {
  await gestion.goto("/gestion/horaires");
  await ouvrirMenuSiTelephone(gestion);
  await gestion.getByRole("button", { name: /^Se déconnecter/ }).click();
  await expect(gestion.getByRole("button", { name: "Recevoir un code" })).toBeVisible();
  await expect(gestion).toHaveURL(/\/gestion\/horaires$/);
});
