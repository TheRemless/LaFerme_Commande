import { expect, test, type Page } from "@playwright/test";
import { codeDuPersonnel } from "./site";

// Groupes d'options au back-office (vague 3) : créer un groupe facultatif d'essai, lui ajouter une option,
// la cocher d'avance, l'épuiser jusqu'à demain, poser le groupe sur un plat puis l'en retirer (la carte des
// autres tests ne change pas). Captures dans docs/rendus/vague-3/bo-carte seulement avec RENDUS=1.
test.describe.configure({ mode: "serial" });

let gestion: Page;
let nom: string;
const RENDUS = process.env.RENDUS === "1" ? "docs/rendus/vague-3/bo-carte" : null;

test.beforeAll(async ({ browser }, info) => {
  nom = `Sauce essai ${info.project.name}`;
  gestion = await browser.newPage({ baseURL: info.project.use.baseURL });
  await gestion.goto("/gestion");
  await gestion.getByLabel("E-mail", { exact: true }).fill(`groupes-${info.project.name}@laferme.test`);
  await gestion.getByLabel("Code à 8 chiffres").fill(await codeDuPersonnel(gestion));
  await gestion.getByRole("button", { name: "Me connecter" }).click();
  await expect(gestion.getByRole("heading", { level: 1, name: "Accueil" })).toBeVisible();
});

test.afterAll(async () => {
  await gestion.close();
});

test("un groupe neuf se crée et s'ouvre dans son panneau de réglage", async () => {
  await gestion.goto("/gestion/supplements");
  await gestion.getByRole("button", { name: "Nouveau groupe" }).click();
  const panneau = gestion.getByRole("dialog", { name: "Nouveau groupe d'options" });
  await panneau.getByLabel("Nom du groupe").fill(nom);
  await panneau.getByLabel("Minimum à choisir").fill("0");
  await panneau.getByLabel("Maximum").fill("1");
  await panneau.getByRole("button", { name: "Créer le groupe" }).click();
  const reglage = gestion.getByRole("dialog", { name: nom });
  await expect(reglage.getByLabel("Nom affiché aux clients")).toHaveValue(nom);
  await expect(reglage).toContainText("Aucune option proposée.");
  await gestion.keyboard.press("Escape");
  await expect(reglage).toHaveCount(0);
});

test("une option s'ajoute, se coche d'avance, s'épuise jusqu'à demain puis revient", async ({}, info) => {
  const bloc = gestion.locator(".ges-categorie", { has: gestion.getByRole("heading", { name: nom }) });
  await bloc.getByLabel(`Ajouter : ${nom.toLowerCase()}`).fill("Poivre essai");
  await bloc.getByLabel("Prix (CHF)").fill("0");
  await bloc.getByLabel("Prix validé").check();
  await bloc.getByRole("button", { name: "Ajouter" }).click();
  await expect(bloc).toContainText("Poivre essai");

  await bloc.getByRole("button", { name: `Régler le groupe ${nom}` }).click();
  const reglage = gestion.getByRole("dialog", { name: nom });
  await reglage.getByRole("checkbox", { name: "Poivre essai" }).first().check();
  await reglage.getByRole("button", { name: "Enregistrer les options cochées" }).click();
  await expect(gestion.getByText("Options cochées d'avance enregistrées.")).toBeVisible();

  const date = reglage.getByLabel("Épuisé jusqu'au (compris)");
  const demain = await date.evaluate((el: HTMLInputElement) => {
    const d = new Date(`${el.min}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  await date.fill(demain);
  await reglage.getByRole("button", { name: "Épuiser", exact: true }).click();
  await expect(reglage.getByText(/^Poivre essai, épuisé jusqu'au /)).toBeVisible();
  if (RENDUS) await gestion.screenshot({ path: `${RENDUS}/${info.project.name === "mobile" ? "m" : "b"}-groupe-reglage.png` });
  await reglage.getByRole("button", { name: "Remettre" }).click();
  await expect(reglage.getByText(/^Poivre essai, épuisé jusqu'au /)).toHaveCount(0);
});

test("le groupe se pose sur un plat, puis s'en retire après confirmation", async () => {
  const reglage = gestion.getByRole("dialog", { name: nom });
  await reglage.getByRole("checkbox", { name: "Tiramisu", exact: true }).check();
  await reglage.getByRole("button", { name: "Enregistrer les plats" }).click();
  await expect(gestion.getByText(`« ${nom} » est proposé sur 1 plat.`)).toBeVisible();
  await expect(reglage.getByRole("checkbox", { name: "Tiramisu", exact: true })).toBeChecked();

  await reglage.getByRole("checkbox", { name: "Tiramisu", exact: true }).uncheck();
  await reglage.getByRole("button", { name: "Enregistrer les plats" }).click();
  await gestion.getByRole("button", { name: "Retirer de 1 plat" }).click();
  await expect(gestion.getByText(`« ${nom} » est proposé sur 0 plat.`)).toBeVisible();
});
