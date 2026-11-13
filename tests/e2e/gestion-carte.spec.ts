import { expect, test, type Page } from "@playwright/test";
import { adresseDuCompte } from "./site";
import sharp from "sharp";

// Carte gérée sans développeur (back-office, gérant de test par projet). Les plats créés ici portent le
// nom du projet pour que bureau et mobile ne se gênent pas. Ils restent hors de la vente, puis sont
// archivés : la carte des autres tests ne change pas. Le plat du jour est prévu pour demain.
test.describe.configure({ mode: "serial" });

let gestion: Page;
let nom: string;

async function connecter(page: Page, email: string) {
  await adresseDuCompte(page, email);
  await page.goto("/gestion");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Recevoir un code" }).click();
  const code = page.locator(".note-preversion strong");
  await expect(code).toHaveText(/^\d{8}$/);
  await page.getByLabel("Code à 8 chiffres").fill(await code.innerText());
  await page.getByRole("button", { name: "Me connecter" }).click();
}

test.beforeAll(async ({ browser }, info) => {
  nom = `Risotto essai ${info.project.name}`;
  gestion = await browser.newPage({ baseURL: info.project.use.baseURL });
  await connecter(gestion, `carte-${info.project.name}@laferme.test`);
  await expect(gestion.getByRole("heading", { name: "Back-office" })).toBeVisible();
});

test.afterAll(async () => {
  await gestion.close();
});

test("un plat neuf naît hors de la vente et dit ce qui lui manque", async () => {
  await gestion.getByRole("button", { name: "Carte", exact: true }).click();
  await gestion.getByRole("button", { name: "Ajouter un plat" }).click();
  const form = gestion.locator("form", { has: gestion.getByRole("heading", { name: "Nouveau plat" }) });
  await form.getByLabel("Catégorie").selectOption({ label: "Pâtes et risottos" });
  await form.getByLabel("Poste (imprimante)").selectOption("cuisine");
  await form.getByLabel("Nom affiché").fill(nom);
  await form.getByLabel("Prix (CHF)").fill("12.30");
  await form.getByLabel("Retraits gratuits").fill("parmesan");
  await form.getByLabel("Mettre en vente tout de suite si rien ne manque").check();
  await form.getByRole("button", { name: "Créer le plat" }).click();

  const fiche = gestion.locator(".ges-fiche");
  await expect(fiche.getByLabel("Nom affiché")).toHaveValue(nom);
  await expect(fiche).toContainText("Pour le mettre en vente, il manque : prix à valider, allergènes manquants.");
  await expect(fiche.getByLabel("Commandable sur le site")).not.toBeChecked();
  // Le cocher sans compléter est refusé par le serveur.
  await fiche.getByLabel("Commandable sur le site").check();
  await fiche.getByRole("button", { name: "Enregistrer le plat" }).click();
  await expect(fiche.getByRole("status")).toContainText("Pas en vente tant qu'il reste : prix à valider, allergènes manquants.");
});

test("une photo s'envoie, s'affiche en aperçu, puis se retire", async () => {
  const fiche = gestion.locator(".ges-fiche");
  const photo = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: { r: 140, g: 120, b: 90 } } }).jpeg().toBuffer();
  await fiche.getByLabel("Envoyer une photo").setInputFiles({ name: "plat.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(fiche.locator(".ges-photo").getByRole("status")).toHaveText("Photo en ligne.");
  const apercu = fiche.locator(".ges-photo-apercu img");
  await expect(apercu).toBeVisible();
  const src = await apercu.getAttribute("src");
  expect(decodeURIComponent(src ?? "")).toMatch(/\/photos\/[0-9a-f-]{36}\.jpg/);
  const fichier = decodeURIComponent(src ?? "").match(/\/photos\/[0-9a-f-]{36}\.jpg/)![0];
  const rep = await gestion.request.get(fichier);
  expect(rep.status()).toBe(200);
  expect(rep.headers()["content-type"]).toBe("image/jpeg");
  expect(rep.headers()["cache-control"]).toContain("immutable");

  // Un fichier qui n'est pas une image est refusé.
  await fiche.getByLabel("Remplacer la photo").setInputFiles({ name: "faux.jpg", mimeType: "image/jpeg", buffer: Buffer.from("<html>pas une image</html>") });
  await expect(fiche.locator(".ges-photo").getByRole("status")).toContainText("Format non reconnu");

  await fiche.getByRole("button", { name: "Retirer la photo" }).click();
  await fiche.getByRole("button", { name: "Oui, retirer la photo" }).click();
  await expect(fiche.locator(".ges-photo").getByRole("status")).toHaveText("Photo retirée.");
  expect((await gestion.request.get(fichier)).status()).toBe(404);
});

test("l'envoi d'une photo est refusé sans session de gérant", async ({ request }) => {
  const rep = await request.post("/api/gestion/photo", { multipart: { slug: "tiramisu", fichier: { name: "x.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff]) } } });
  expect([401, 403]).toContain(rep.status());
});

test("le plat s'archive, quitte la liste, puis se remet", async () => {
  const fiche = gestion.locator(".ges-fiche");
  await fiche.getByRole("button", { name: "Archiver ce plat" }).click();
  await fiche.getByRole("button", { name: `Oui, archiver ${nom}` }).click();
  const archives = gestion.locator(".ges-categorie", { has: gestion.getByRole("heading", { name: "Plats archivés" }) });
  await expect(archives).toContainText(nom);
  await archives.locator("li", { hasText: nom }).getByRole("button", { name: "Remettre à la carte" }).click();
  await expect(gestion.getByRole("button", { name: new RegExp(`^${nom}`) })).toBeVisible();
  // Remis à la carte, il revient avec sa fiche encore ouverte. Rangé de nouveau, pour ne rien laisser
  // dans la carte des autres tests.
  await expect(gestion.locator(".ges-fiche").getByLabel("Nom affiché")).toHaveValue(nom);
  await gestion.locator(".ges-fiche").getByRole("button", { name: "Archiver ce plat" }).click();
  await gestion.locator(".ges-fiche").getByRole("button", { name: `Oui, archiver ${nom}` }).click();
  await expect(archives).toContainText(nom);
});

test("le plat du jour de demain s'enregistre et se liste à part", async ({}, info) => {
  await gestion.getByRole("button", { name: "Plat du jour" }).click();
  const form = gestion.locator("form", { has: gestion.getByRole("heading", { name: "Nouveau plat du jour" }) });
  const demain = await form.getByLabel("Jour").evaluate((el: HTMLInputElement) => {
    const d = new Date(`${el.min}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  await form.getByLabel("Jour").fill(demain);
  await form.getByLabel("Service").selectOption("midi");
  await form.getByLabel("Nom affiché").fill(`Osso buco essai ${info.project.name}`);
  await form.getByLabel("Prix (CHF)").fill("25");
  await expect(form.getByLabel("Prix validé")).toHaveCount(0);
  await form.getByLabel("Allergènes").fill("céleri (essai)");
  await form.getByRole("button", { name: "Publier le plat du jour" }).click();
  await expect(form.getByRole("status")).toContainText("il sera en tête de la carte le");
  await expect(gestion.getByRole("button", { name: new RegExp(`^Osso buco essai ${info.project.name}`) })).toContainText("midi");
});
