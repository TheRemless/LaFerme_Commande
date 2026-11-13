import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { codeDuPersonnel } from "./site";

// Carte du back-office en liste (vague 3) : filtres de qualité, fiche dans le panneau, rupture jusqu'à une
// date, prix en lot (aperçu seulement : aucun prix de la carte n'est changé pour les autres tests).
// Captures dans docs/rendus/vague-3/bo-carte seulement avec RENDUS=1.
test.describe.configure({ mode: "serial" });

let gestion: Page;
const RENDUS = process.env.RENDUS === "1" ? "docs/rendus/vague-3/bo-carte" : null;

async function capture(nom: string, info: { project: { name: string } }) {
  if (RENDUS) await gestion.screenshot({ path: `${RENDUS}/${info.project.name === "mobile" ? "m" : "b"}-${nom}.png`, fullPage: false });
}

test.beforeAll(async ({ browser }, info) => {
  gestion = await browser.newPage({ baseURL: info.project.use.baseURL });
  await gestion.goto("/gestion");
  await gestion.getByLabel("E-mail", { exact: true }).fill(`liste-${info.project.name}@laferme.test`);
  await gestion.getByLabel("Code à 8 chiffres").fill(await codeDuPersonnel(gestion));
  await gestion.getByRole("button", { name: "Me connecter" }).click();
  // Connexion faite (l'accueil du back-office s'affiche) avant d'ouvrir une rubrique.
  await expect(gestion.getByRole("heading", { level: 1, name: "Accueil" })).toBeVisible();
});

test.afterAll(async () => {
  await gestion.close();
});

test("la carte en liste : filtres de qualité, recherche, catégorie", async ({}, info) => {
  await gestion.goto("/gestion/carte");
  await expect(gestion.getByRole("tab", { name: "Liste" })).toHaveAttribute("aria-selected", "true");
  const tableau = gestion.getByRole("table");
  await expect(tableau.getByRole("button", { name: "Pizza Margherita" })).toBeVisible();
  await capture("carte-liste", info);
  await gestion.getByRole("button", { name: /^Sans allergènes/ }).click();
  await expect(gestion.getByRole("button", { name: /^Sans allergènes/ })).toHaveAttribute("aria-pressed", "true");
  await gestion.getByRole("button", { name: /^Bloquent la mise en ligne/ }).click();
  await expect(gestion.getByRole("button", { name: /^Bloquent la mise en ligne/ })).toHaveAttribute("aria-pressed", "true");
  await expect(tableau.getByRole("button", { name: "Pizza Margherita" })).toBeVisible();
  await gestion.getByRole("button", { name: /^Tous/ }).click();
  await gestion.getByRole("combobox", { name: "Catégorie" }).selectOption({ label: "Desserts" });
  await expect(tableau.getByRole("button", { name: "Pizza Margherita" })).toHaveCount(0);
  await gestion.getByRole("combobox", { name: "Catégorie" }).selectOption({ label: "Toutes" });
  await gestion.getByRole("searchbox").or(gestion.getByPlaceholder("Nom ou description")).first().fill("Tonno");
  await expect(tableau.getByRole("button", { name: "Pizza Tonno" })).toBeVisible();
  await expect(tableau.getByRole("button", { name: "Pizza Margherita" })).toHaveCount(0);
});

test("la fiche s'ouvre dans le panneau ; un plat s'épuise jusqu'à demain puis revient", async ({}, info) => {
  const tableau = gestion.getByRole("table");
  await tableau.getByRole("button", { name: "Pizza Tonno" }).click();
  const panneau = gestion.getByRole("dialog", { name: "Pizza Tonno" });
  await expect(panneau.getByLabel("Nom affiché")).toHaveValue("Pizza Tonno");
  const champ = panneau.getByLabel("Épuisé jusqu'au (compris)");
  const demain = await champ.evaluate((el: HTMLInputElement) => {
    const d = new Date(`${el.min}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  await champ.fill(demain);
  await panneau.getByRole("button", { name: "Épuiser", exact: true }).click();
  await expect(panneau.getByText(/^Épuisé jusqu'au .* compris\./)).toBeVisible();
  await capture("carte-fiche-rupture", info);
  await panneau.getByRole("button", { name: "Remettre en vente" }).click();
  await expect(panneau.getByText("En vente. La tablette épuise un plat pour le jour", { exact: false })).toBeVisible();
  await gestion.keyboard.press("Escape");
  await expect(panneau).toHaveCount(0);
});

test("prix en lot : l'aperçu donne avant et après, sans rien écrire", async ({}, info) => {
  const tableau = gestion.getByRole("table");
  const prixAvant = await tableau.getByLabel("Prix de Pizza Tonno (CHF)").inputValue();
  await tableau.getByRole("checkbox", { name: "Sélectionner Pizza Tonno" }).check();
  await gestion.getByRole("button", { name: "Changer les prix" }).click();
  const panneau = gestion.getByRole("dialog", { name: "Changer les prix" });
  await panneau.getByLabel("Pourcentage").fill("10");
  await panneau.getByRole("button", { name: "Voir l'aperçu" }).click();
  const ligne = panneau.getByRole("row", { name: /Pizza Tonno/ });
  await expect(ligne).toContainText(prixAvant);
  const attendu = (Math.round((Number(prixAvant) * 110) / 10) / 10).toFixed(2);
  await expect(ligne).toContainText(attendu);
  await expect(panneau.getByRole("button", { name: "Appliquer à 1 plat" })).toBeVisible();
  await capture("carte-prix-lot", info);
  await gestion.keyboard.press("Escape");
  await expect(tableau.getByLabel("Prix de Pizza Tonno (CHF)")).toHaveValue(prixAvant);
});

test("la recherche globale ouvre la fiche d'un plat en arrivant sur la carte", async () => {
  await gestion.evaluate(() => sessionStorage.setItem("laferme.gestion.ouvrir", JSON.stringify({ type: "plat", cle: "pizza-tonno", le: Date.now() })));
  await gestion.goto("/gestion/carte");
  await expect(gestion.getByRole("dialog", { name: "Pizza Tonno" }).getByLabel("Nom affiché")).toHaveValue("Pizza Tonno");
  await gestion.keyboard.press("Escape");
});

test("les étiquettes se posent sur la fiche ; végane coche aussi végétarien", async () => {
  await gestion.goto("/gestion/carte");
  await gestion.getByRole("table").getByRole("button", { name: "Pizza Tonno" }).click();
  const panneau = gestion.getByRole("dialog", { name: "Pizza Tonno" });
  await panneau.getByRole("checkbox", { name: "Végane" }).check();
  await panneau.getByRole("button", { name: "Enregistrer les étiquettes" }).click();
  await expect(panneau.getByRole("checkbox", { name: "Végétarien" })).toBeChecked();
  // Rangées de nouveau, pour ne rien laisser dans la carte des autres tests.
  await panneau.getByRole("checkbox", { name: "Végane" }).uncheck();
  await panneau.getByRole("checkbox", { name: "Végétarien" }).uncheck();
  await panneau.getByRole("button", { name: "Enregistrer les étiquettes" }).click();
  await expect(gestion.getByText("Étiquettes enregistrées.").last()).toBeVisible();
  await expect(panneau.getByRole("checkbox", { name: "Végétarien" })).not.toBeChecked();
  await gestion.keyboard.press("Escape");
});

test("en lot : retirer de la vente puis remettre en vente", async () => {
  await gestion.goto("/gestion/carte");
  const tableau = gestion.getByRole("table");
  const ligne = tableau.getByRole("row", { name: /Pizza Tonno/ }).first();
  await tableau.getByRole("checkbox", { name: "Sélectionner Pizza Tonno" }).check();
  await gestion.getByRole("button", { name: "Retirer de la vente" }).click();
  await expect(gestion.getByText("1 plat retiré de la vente.")).toBeVisible();
  await expect(ligne).toContainText("Hors vente");
  await tableau.getByRole("checkbox", { name: "Sélectionner Pizza Tonno" }).check();
  await gestion.getByRole("button", { name: "Mettre en vente" }).click();
  await expect(gestion.getByText("1 plat en vente.")).toBeVisible();
  await expect(ligne).toContainText("En vente");
});

test("plusieurs photos d'un coup : le plat se trouve d'après le nom du fichier", async ({}, info) => {
  const photo = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: { r: 150, g: 110, b: 80 } } }).jpeg().toBuffer();
  await gestion.goto("/gestion/carte");
  await gestion.getByRole("button", { name: "Envoyer des photos" }).click();
  const panneau = gestion.getByRole("dialog", { name: "Envoyer des photos" });
  await panneau.getByLabel("Photos").setInputFiles([
    { name: "tiramisu.jpg", mimeType: "image/jpeg", buffer: photo },
    { name: "IMG_0001.jpg", mimeType: "image/jpeg", buffer: photo },
  ]);
  await expect(panneau.getByLabel("Plat pour tiramisu.jpg")).toHaveValue("tiramisu");
  await expect(panneau.getByRole("row", { name: /IMG_0001\.jpg/ })).toContainText("Pas de plat trouvé");
  await panneau.getByLabel("Cadrage pour tiramisu.jpg").selectOption("haut");
  await panneau.getByRole("button", { name: "Envoyer 1 photo" }).click();
  await expect(panneau.getByRole("row", { name: /tiramisu\.jpg/ })).toContainText("En ligne.");
  // La photo du shooting revient : la carte des autres tests ne change pas.
  const origine = new URL(info.project.use.baseURL!).origin;
  const r = await gestion.request.post("/api/gestion/carte", { headers: { Origin: origine }, data: { type: "plat", slug: "tiramisu", champs: { photo: "tiramisu.jpg" } } });
  expect(r.ok()).toBe(true);
  await gestion.keyboard.press("Escape");
});

