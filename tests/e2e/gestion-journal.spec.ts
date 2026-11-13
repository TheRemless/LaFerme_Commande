import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adresseDuCompte } from "./site";

// Journal du back-office (vague 3, bo-pilotage) : chercher, filtrer, afficher la suite. Gérant de test à part.
test.describe.configure({ mode: "serial" });

let gestion: Page;
// Un plat par projet, qu'aucun autre test ne touche : la ligne du journal d'un projet garde en « avant » la
// description écrite par l'autre, et la recherche la trouverait aussi.
const PLATS: Record<string, { slug: string; origine: string }> = {
  bureau: { slug: "pizza-melanzana", origine: "Sauce tomate, Mozzarella et aubergines." },
  mobile: { slug: "pizza-rucola", origine: "Sauce tomate, Mozzarella, rucola, tomates cerises et Parmesan." },
};

test.beforeAll(async ({ browser }, info) => {
  gestion = await (await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL })).newPage();
  const email = `pilotage-${info.project.name}@laferme.test`;
  await gestion.goto("/gestion/journal");
  await adresseDuCompte(gestion, email);
  await gestion.getByLabel("E-mail", { exact: true }).fill(email);
  await gestion.getByRole("button", { name: "Recevoir un code" }).click();
  const code = gestion.locator(".note-preversion strong");
  await expect(code).toHaveText(/^\d{8}$/);
  await gestion.getByLabel("Code à 8 chiffres").fill(await code.innerText());
  await gestion.getByRole("button", { name: "Me connecter" }).click();
  await expect(gestion.getByRole("heading", { level: 1, name: "Journal" })).toBeVisible();
});

test.afterAll(async () => {
  await gestion.context().close();
});

test("une modification se retrouve par la recherche, par son objet et par son auteur", async ({}, info) => {
  // Une modification propre à ce passage : la description d'un plat, remise ensuite.
  const marque = `journal-${info.project.name}-${Date.now()}`;
  const plat = PLATS[info.project.name];
  const ecrire = (description: string) =>
    gestion.evaluate(
      async ([slug, d]) => {
        const r = await fetch("/api/gestion/carte", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "plat", slug, champs: { description: d } }) });
        return r.status;
      },
      [plat.slug, description],
    );
  expect(await ecrire(`Essai ${marque}`)).toBe(200);
  await gestion.reload();
  await expect(gestion.locator(".ges-journal-liste")).toBeVisible();

  const recherche = gestion.getByRole("search", { name: "Filtrer le journal" });
  await recherche.getByLabel("Chercher").fill(marque);
  await recherche.getByRole("button", { name: "Filtrer" }).click();
  const lignes = gestion.locator(".ges-journal-liste > li");
  await expect(lignes).toHaveCount(1);
  await expect(lignes.first()).toContainText(marque);
  // CAPTURES=1 : rendus pour la revue (docs/rendus/vague-3/bo-pilotage/).
  if (process.env.CAPTURES) await gestion.screenshot({ path: `docs/rendus/vague-3/bo-pilotage/journal-recherche-${info.project.name}.png` });
  await expect(lignes.first()).toContainText(`Pilotage ${info.project.name}`);

  // Le filtre « Quoi » garde la ligne (c'est un plat), une recherche sans réponse vide la liste.
  await recherche.getByLabel("Quoi").selectOption("plat");
  await recherche.getByRole("button", { name: "Filtrer" }).click();
  await expect(lignes).toHaveCount(1);
  await recherche.getByLabel("Chercher").fill(`${marque}-rien`);
  await recherche.getByRole("button", { name: "Filtrer" }).click();
  await expect(gestion.getByText("Aucune modification ne correspond à ces filtres.")).toBeVisible();

  await recherche.getByRole("button", { name: "Tout afficher" }).click();
  await expect(lignes.first()).toBeVisible();
  if (process.env.CAPTURES) await gestion.screenshot({ path: `docs/rendus/vague-3/bo-pilotage/journal-${info.project.name}.png` });
  await expect(recherche.getByLabel("Chercher")).toHaveValue("");

  const axe = await new AxeBuilder({ page: gestion }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  expect(await ecrire(plat.origine)).toBe(200);
});

test("le réseau coupé se dit, et « Réessayer » relance la recherche", async () => {
  await gestion.route("/api/gestion/journal", (route) => route.abort("internetdisconnected"));
  await gestion.getByRole("search", { name: "Filtrer le journal" }).getByRole("button", { name: "Filtrer" }).click();
  const alerte = gestion.locator(".ges-bloc").getByRole("alert");
  await expect(alerte).toContainText("Pas de connexion");
  await gestion.unroute("/api/gestion/journal");
  await gestion.getByRole("button", { name: "Réessayer" }).click();
  await expect(alerte).toHaveCount(0);
  await expect(gestion.locator(".ges-journal-liste > li").first()).toBeVisible();
});
