import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adresseDuCompte, SITE } from "./site";

// Recherche globale du back-office (⌘K, vague 3, bo-socle) : commande par numéro ou nom, plat, rubrique.
// Le texte cherché part en POST, jamais dans l'adresse.
test.describe.configure({ mode: "serial" });

const ORIGINE = { Origin: SITE };
let page: Page;
const fenetre = () => page.getByRole("dialog", { name: "Recherche dans le back-office" });
const champ = () => fenetre().getByRole("combobox");
// Le bouton « Recherche » de l'en-tête (la page Commandes a son propre bouton « Chercher »).
const bouton = () => page.getByRole("banner").getByRole("button", { name: "Recherche", exact: true });

async function ouvrir() {
  await bouton().click();
  await expect(fenetre()).toBeVisible();
  await expect(champ()).toBeFocused();
}

test.beforeAll(async ({ browser }, info) => {
  page = await (await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL })).newPage();
  const email = `recherche-${info.project.name}@laferme.test`;
  await adresseDuCompte(page, email);
  await page.goto("/gestion");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Recevoir un code" }).click();
  const code = page.locator(".note-preversion strong");
  await expect(code).toHaveText(/^\d{8}$/);
  await page.getByLabel("Code à 8 chiffres").fill(await code.innerText());
  await page.getByRole("button", { name: "Me connecter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Accueil" })).toBeVisible();
});

test.afterAll(async () => {
  await page.context().close();
});

test("un plat se trouve et s'ouvre au clavier, la fenêtre passe axe", async () => {
  await ouvrir();
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
  await champ().fill("tonno");
  const option = fenetre().getByRole("option", { name: /Pizza Tonno/ });
  await expect(option).toBeVisible();
  await expect(option).toHaveAttribute("aria-selected", "true");
  await champ().press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Carte" })).toBeVisible();
  await expect(fenetre()).toBeHidden();
});

test("une rubrique se trouve par son nom ou ce qu'on y fait", async () => {
  await ouvrir();
  await champ().fill("imprim");
  await fenetre().getByRole("option", { name: /^Imprimantes/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Imprimantes" })).toBeVisible();
});

test("une commande se trouve par le nom du client, sans que le nom passe dans l'adresse", async ({ request }, info) => {
  const prenom = `Cherche${info.project.name}`;
  const rep = await request.post("/api/commandes", {
    headers: ORIGINE,
    data: {
      cle: `recherche-${info.project.name}-${Date.now()}`,
      mode: "retrait",
      moyen: "comptoir",
      quand: { type: "asap" },
      heure: "2026-11-10T19:05",
      client: { prenom, nom: "Test", telephone: "079 000 00 00", email: `${prenom.toLowerCase()}@laferme.test` },
      lignes: [{ slug: "pizza-margherita", qte: 1, choix: {}, retraits: [], note: "" }],
    },
  });
  expect(rep.ok()).toBe(true);
  const demandes: string[] = [];
  page.on("request", (r) => demandes.push(r.url()));
  await ouvrir();
  await champ().fill(prenom);
  const option = fenetre().getByRole("option", { name: new RegExp(`^N° \\d+, ${prenom} Test`) });
  await expect(option).toBeVisible();
  await champ().press("ArrowDown");
  await champ().press("ArrowUp");
  await champ().press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Commandes" })).toBeVisible();
  expect(demandes.some((u) => u.includes(prenom))).toBe(false);
});

test("rien ne correspond : la fenêtre le dit ; Échap la ferme", async () => {
  await ouvrir();
  await champ().fill("zzzzqqq");
  await expect(fenetre().getByText("Rien ne correspond à « zzzzqqq ».")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(fenetre()).toBeHidden();
  await expect(bouton()).toBeFocused();
});

test("⌘K ou Ctrl+K ouvre la recherche", async ({}, info) => {
  test.skip(info.project.name !== "bureau", "Clavier physique");
  await page.locator("main").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("ControlOrMeta+k");
  await expect(fenetre()).toBeVisible();
  await page.keyboard.press("Escape");
});

test("la route de recherche est réservée au gérant et au site", async ({ request }) => {
  expect((await request.post("/api/gestion/recherche", { headers: ORIGINE, data: { q: "tonno" } })).status()).toBe(401);
  const cookie = (await page.context().cookies()).find((c) => c.name === "laferme-personnel")!;
  const pirate = await request.post("/api/gestion/recherche", { headers: { Origin: "https://pirate.example", Cookie: `laferme-personnel=${cookie.value}` }, data: { q: "tonno" } });
  expect(pirate.status()).toBe(403);
  const court = await page.request.post("/api/gestion/recherche", { headers: ORIGINE, data: { q: "a" } });
  expect(court.status()).toBe(422);
});
