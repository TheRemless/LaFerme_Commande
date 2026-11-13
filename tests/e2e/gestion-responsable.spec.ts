import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adresseDuCompte, codeDuPersonnel, SITE } from "./site";

// Responsable de service (D1, oui de Jérémy le 13.11.2026 ; rôle activé dans la base embarquée) : il fait ce
// que le tableau D1 lui donne au back-office (commandes, clients, recherche, déconnecter un appareil perdu) et
// rien de plus (accueil et ventes, carte, réglages, accès de l'équipe, appareils d'un gérant).
test.describe.configure({ mode: "serial" });

const ORIGINE = { Origin: SITE };
let page: Page;

async function connecter(p: Page, url: string, email: string) {
  await adresseDuCompte(p, email);
  await p.goto(url);
  await p.getByLabel("E-mail", { exact: true }).fill(email);
  await p.getByLabel("Code à 8 chiffres").fill(await codeDuPersonnel(p));
  await p.getByRole("button", { name: "Me connecter" }).click();
}

async function menu(p: Page) {
  const bouton = p.getByRole("button", { name: "Menu", exact: true });
  if (await bouton.isVisible()) await bouton.click();
  return p.getByRole("navigation", { name: "Rubriques" });
}

test.beforeAll(async ({ browser }, info) => {
  page = await (await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL })).newPage();
  await connecter(page, "/gestion", `responsable-socle-${info.project.name}@laferme.test`);
  // Il arrive sur Commandes : l'accueil montre les ventes, réservées au gérant.
  await expect(page.getByRole("heading", { level: 1, name: "Commandes" })).toBeVisible();
});

test.afterAll(async () => {
  await page.context().close();
});

test("son menu : Commandes, Clients et Équipe ; une rubrique fermée tapée à la main dit « Réservé »", async () => {
  const nav = await menu(page);
  await expect(nav.getByRole("link")).toHaveText(["Commandes", "Clients", "Équipe"]);
  await page.goto("/gestion/carte");
  await expect(page.getByText("Réservé : carte.")).toBeVisible();
  await page.goto("/gestion/clients");
  await expect(page.getByRole("heading", { level: 1, name: "Clients" })).toBeVisible();
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
});

test("la recherche trouve commandes et rubriques ouvertes, jamais les plats ni les rubriques du gérant", async () => {
  await page.goto("/gestion/commandes");
  await page.getByRole("button", { name: /^Recherche/ }).click();
  const fenetre = page.getByRole("dialog", { name: "Recherche dans le back-office" });
  await fenetre.getByRole("combobox").fill("imprim");
  await expect(fenetre.getByText(/^Rien ne correspond/)).toBeVisible();
  await fenetre.getByRole("combobox").fill("équipe");
  await expect(fenetre.getByRole("option", { name: /^Équipe/ })).toBeVisible();
  await page.keyboard.press("Escape");
  const rep = await page.request.post("/api/gestion/recherche", { headers: ORIGINE, data: { q: "tonno" } });
  expect(rep.status()).toBe(200);
  expect(((await rep.json()) as { plats: unknown }).plats).toBeNull();
});

test("Équipe : il déconnecte le téléphone d'un employé, sans accès ni ajout ni retrait", async ({ browser }, info) => {
  const cible = `responsable-cible-${info.project.name}@laferme.test`;
  const employe = await (await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL })).newPage();
  await connecter(employe, "/tablette", cible);
  await expect(employe.getByRole("button", { name: "Recevoir un code" })).toHaveCount(0);

  await page.goto("/gestion/equipe");
  await expect(page.getByRole("heading", { level: 1, name: "Équipe" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ajouter quelqu'un" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: /^Accès de/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retirer" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Déconnecter partout" })).toHaveCount(0);

  const ligne = page.locator(".ges-equipe li", { hasText: cible });
  await ligne.getByRole("button", { name: /^Appareils \(\d+\)$/ }).click();
  const panneau = page.getByRole("dialog", { name: /^Appareils de / });
  await panneau.getByRole("button", { name: "Déconnecter" }).first().click();
  await page.getByRole("dialog", { name: /^Déconnecter / }).getByRole("button", { name: "Déconnecter" }).click();
  await expect(page.locator(".bo-notif", { hasText: "Appareil déconnecté." })).toBeVisible();
  await employe.reload();
  await expect(employe.getByRole("button", { name: "Recevoir un code" })).toBeVisible();
  await employe.context().close();
});

test("les routes du gérant lui répondent 403", async () => {
  const get = (url: string) => page.request.get(url);
  expect((await get("/api/gestion/accueil")).status()).toBe(403);
  expect((await get("/api/gestion/pilotage/ventes?periode=jour")).status()).toBe(403);
  const post = (url: string, data: Record<string, unknown>) => page.request.post(url, { headers: ORIGINE, data });
  expect((await post("/api/gestion/personnel", { action: "ajouter", email: "x@laferme.test", nom: "X", role: "gerant" })).status()).toBe(403);
  // Les appareils d'un gérant : refusés, même avec son identifiant.
  const equipe = (await (await get("/api/gestion/personnel")).json()) as { liste: { id: string; role: string }[] };
  const gerant = equipe.liste.find((m) => m.role === "gerant")!;
  expect((await post("/api/gestion/personnel", { action: "appareils", id: gerant.id })).status()).toBe(403);
  expect((await post("/api/gestion/personnel", { action: "couper", id: gerant.id })).status()).toBe(403);
});
