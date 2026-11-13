import { expect, test, type Page } from "@playwright/test";

// Menus et formules au back-office (vague 3), construits désactivés : un menu d'essai se crée inactif, reçoit
// une étape, s'active, puis s'archive. L'interrupteur général n'est jamais touché (il reste faux).
// Prix d'essai, pas un prix de La Ferme. Captures dans docs/rendus/vague-3/bo-carte avec RENDUS=1.
test.describe.configure({ mode: "serial" });

let gestion: Page;
let nom: string;
const RENDUS = process.env.RENDUS === "1" ? "docs/rendus/vague-3/bo-carte" : null;

test.beforeAll(async ({ browser }, info) => {
  nom = `Formule essai ${info.project.name}`;
  gestion = await browser.newPage({ baseURL: info.project.use.baseURL });
  await gestion.goto("/gestion");
  await gestion.getByLabel("E-mail", { exact: true }).fill(`menus-${info.project.name}@laferme.test`);
  await gestion.getByRole("button", { name: "Recevoir un code" }).click();
  const c = gestion.locator(".note-preversion strong");
  await expect(c).toHaveText(/^\d{8}$/);
  await gestion.getByLabel("Code à 8 chiffres").fill(await c.innerText());
  await gestion.getByRole("button", { name: "Me connecter" }).click();
  await expect(gestion.getByRole("heading", { level: 1, name: "Accueil" })).toBeVisible();
});

test.afterAll(async () => {
  await gestion.close();
});

test("désactivés : un menu naît inactif et dit ce qui lui manque", async () => {
  await gestion.goto("/gestion/menus");
  await expect(gestion.getByText("Menus pas proposés aux clients.")).toBeVisible();
  await gestion.getByRole("button", { name: "Nouveau menu" }).click();
  const panneau = gestion.getByRole("dialog", { name: "Nouveau menu" });
  await panneau.getByLabel("Nom du menu").fill(nom);
  await panneau.getByLabel("Prix (CHF)").fill("25");
  await panneau.getByRole("button", { name: "Créer le menu" }).click();
  const fiche = gestion.getByRole("dialog", { name: nom });
  await expect(fiche).toContainText("Pour l'activer, il manque : prix à valider, aucune étape.");
});

test("une étape, le prix validé, puis il s'active et s'archive", async ({}, info) => {
  let fiche = gestion.getByRole("dialog", { name: nom });
  await fiche.getByRole("button", { name: "Ajouter une étape" }).click();
  await fiche.getByLabel("Nom vu par le client").fill("Une pizza au choix");
  await fiche.getByLabel("Toute une catégorie").selectOption({ label: "Pizzas" });
  await fiche.getByRole("button", { name: "Enregistrer les étapes" }).click();
  await expect(gestion.getByText("Étapes enregistrées.")).toBeVisible();
  fiche = gestion.getByRole("dialog", { name: nom });
  await fiche.getByLabel("Prix validé").check();
  await fiche.getByRole("button", { name: "Enregistrer le menu" }).click();
  await expect(fiche).toContainText("Rien ne manque, il peut être activé.");
  await fiche.getByRole("button", { name: "Activer ce menu" }).click();
  await expect(gestion.getByRole("dialog", { name: nom })).toContainText("Rendre inactif");
  if (RENDUS) await gestion.screenshot({ path: `${RENDUS}/${info.project.name === "mobile" ? "m" : "b"}-menus.png` });
  await gestion.getByRole("dialog", { name: nom }).getByRole("button", { name: "Archiver ce menu" }).click();
  await gestion.getByRole("button", { name: `Archiver ${nom}` }).click();
  await expect(gestion.getByRole("dialog", { name: nom })).toContainText("Archivé, hors de la vente.");
  await gestion.keyboard.press("Escape");
  await expect(gestion.getByText("Menus pas proposés aux clients.")).toBeVisible();
});

test("un visiteur ne lit pas les menus", async ({ request }) => {
  expect((await request.get("/api/gestion/menus")).status()).toBe(401);
});
