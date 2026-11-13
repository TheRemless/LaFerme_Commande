import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adresseDuCompte, codeDuPersonnel } from "./site";

// Mise en route (vague 3, bo-socle) : les étapes du lancement, cochées d'après l'état réel, en tête du menu tant
// qu'il en reste. Captures pour Jérémy seulement avec CAPTURES=1 (sinon chaque passage les réécrirait).
test.describe.configure({ mode: "serial" });

let page: Page;

test.beforeAll(async ({ browser }, info) => {
  page = await (await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL })).newPage();
  const email = `mise-en-route-${info.project.name}@laferme.test`;
  await adresseDuCompte(page, email);
  await page.goto("/gestion/mise-en-route");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Code à 8 chiffres").fill(await codeDuPersonnel(page));
  await page.getByRole("button", { name: "Me connecter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Mise en route" })).toBeVisible();
});

test.afterAll(async () => {
  await page.context().close();
});

test("douze étapes dans l'ordre, la première à faire ouverte, chacune avec son état", async ({}, info) => {
  await expect(page.getByText(/^\d+ étapes? faites? sur 9\.$|^Tout est prêt pour le premier service\.$/)).toBeVisible();
  const etapes = page.locator(".bo-mer-etape");
  await expect(etapes).toHaveCount(12);
  await expect(etapes.locator("summary strong")).toHaveText([
    "Brancher l'envoi des e-mails",
    "Ajouter l'équipe de la tablette",
    "Connecter la tablette et démarrer le service",
    "Brancher l'imprimante pizzaConseillée",
    "Brancher l'imprimante cuisineConseillée",
    "Valider les horaires et les zones",
    "Carte sans plat bloquant",
    "Ajouter les livreurs",
    "Connexion des livreurs par un code de la tabletteConseillée",
    "Choisir l'adresse des alertes",
    "Brancher le paiement en ligne",
    "Passer une commande d'essai et la rembourser",
  ]);
  // Une seule étape ouverte au départ : la première qui reste à faire.
  const ouvertes = page.locator(".bo-mer-etape details[open]");
  await expect(ouvertes).toHaveCount(1);
  await expect(ouvertes.locator("xpath=..")).not.toHaveAttribute("data-faite", "true");
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  if (process.env.CAPTURES) await page.screenshot({ path: `docs/rendus/vague-3/bo-socle/mise-en-route-${info.project.name}.png`, fullPage: true });
});

test("l'étape des imprimantes donne les réglages à faire sur l'imprimante et mène à Imprimantes", async ({}, info) => {
  const pizza = page.locator(".bo-mer-etape", { hasText: "Brancher l'imprimante pizza" });
  await pizza.locator("summary").click();
  await expect(pizza.getByText(/Activez CloudPRNT en HTTP \(pas MQTT\), collez l'adresse dans «\u00a0Server URL\u00a0»/)).toBeVisible();
  if (process.env.CAPTURES) await pizza.screenshot({ path: `docs/rendus/vague-3/bo-socle/mise-en-route-imprimante-${info.project.name}.png` });
  await pizza.getByRole("link", { name: "Ouvrir Imprimantes" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Imprimantes" })).toBeVisible();
});

test("tant qu'il reste une étape, elle est en tête du menu avec le nombre d'étapes à faire", async () => {
  const bouton = page.getByRole("button", { name: "Menu", exact: true });
  if (await bouton.isVisible()) await bouton.click();
  const nav = page.getByRole("navigation", { name: "Rubriques" });
  const lien = nav.getByRole("link", { name: "Mise en route", exact: true });
  await expect(nav.getByRole("link").first()).toHaveText(/^Mise en route/);
  await expect(lien).toHaveAccessibleDescription(/^\d+ étapes? à faire avant le premier service$/);
});

test("la route est réservée au gérant", async ({ request }) => {
  expect((await request.get("/api/gestion/mise-en-route")).status()).toBe(401);
  const r = await page.request.get("/api/gestion/mise-en-route");
  expect(r.status()).toBe(200);
  const corps = (await r.json()) as { total: number; etapes: { cle: string }[] };
  expect(corps.total).toBe(9);
  // Aucune valeur de variable secrète ni donnée de client dans la réponse.
  expect(JSON.stringify(corps)).not.toMatch(/sk_|whsec_|@exemple|@laferme\.test/);
});
