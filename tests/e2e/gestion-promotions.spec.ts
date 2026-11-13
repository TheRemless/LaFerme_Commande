import { expect, test, type Page } from "@playwright/test";
import { adresseDuCompte, codeDuPersonnel, passage } from "./site";

// Promotions au back-office (vague 3) : construites désactivées. Un code d'essai se crée inactif, s'active,
// se rend inactif ; l'interrupteur général n'est jamais touché ici (il reste faux pour les autres tests).
// Les valeurs sont des valeurs d'essai, pas une offre de La Ferme.
test.describe.configure({ mode: "serial" });

let gestion: Page;
let code: string;
const RENDUS = process.env.RENDUS === "1" ? "docs/rendus/vague-3/bo-carte" : null;

test.beforeAll(async ({ browser }, info) => {
  // Suffixe de passage : un réessai de la CI dans la même base crée un code neuf.
  code = `ESSAI-${info.project.name.toUpperCase()}-${passage().toUpperCase()}`;
  gestion = await browser.newPage({ baseURL: info.project.use.baseURL });
  await adresseDuCompte(gestion, `promos-${info.project.name}@laferme.test`);
  await gestion.goto("/gestion");
  await gestion.getByLabel("E-mail", { exact: true }).fill(`promos-${info.project.name}@laferme.test`);
  await gestion.getByLabel("Code à 8 chiffres").fill(await codeDuPersonnel(gestion));
  await gestion.getByRole("button", { name: "Me connecter" }).click();
  await expect(gestion.getByRole("heading", { level: 1, name: "Accueil" })).toBeVisible();
});

test.afterAll(async () => {
  await gestion.close();
});

test("désactivées par défaut : l'interrupteur le dit, un code naît inactif", async ({}, info) => {
  await gestion.goto("/gestion/promotions");
  await expect(gestion.getByText("Codes promo désactivés.")).toBeVisible();
  await gestion.getByRole("button", { name: "Nouveau code" }).click();
  const panneau = gestion.getByRole("dialog", { name: "Nouveau code" });
  await panneau.getByLabel("Code", { exact: true }).fill(code.toLowerCase());
  await panneau.getByLabel("Support").fill("Essai e2e");
  await panneau.getByLabel("Pourcentage (1 à 100)").fill("10");
  await panneau.getByRole("button", { name: "Créer le code" }).click();
  const fiche = gestion.getByRole("dialog", { name: code });
  await expect(fiche).toContainText("Essai e2e, inactif");
  await expect(fiche).toContainText("0 commande");
  if (RENDUS) await gestion.screenshot({ path: `${RENDUS}/${info.project.name === "mobile" ? "m" : "b"}-promotions.png` });
});

test("un code s'active après confirmation, puis se rend inactif ; l'interrupteur reste faux", async () => {
  const fiche = gestion.getByRole("dialog", { name: code });
  await fiche.getByRole("button", { name: "Activer ce code" }).click();
  await gestion.getByRole("button", { name: `Activer ${code}` }).click();
  await expect(gestion.getByRole("dialog", { name: code })).toContainText("Essai e2e, actif");
  await gestion.getByRole("dialog", { name: code }).getByRole("button", { name: "Rendre inactif" }).click();
  await expect(gestion.getByRole("dialog", { name: code })).toContainText("Essai e2e, inactif");
  await gestion.keyboard.press("Escape");
  await expect(gestion.getByRole("table").getByRole("button", { name: code })).toBeVisible();
  await expect(gestion.getByText("Codes promo désactivés.")).toBeVisible();
});

test("un visiteur ne lit pas les codes", async ({ request }) => {
  expect((await request.get("/api/gestion/promotions")).status()).toBe(401);
});
