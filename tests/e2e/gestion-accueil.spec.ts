import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adresseDuCompte, SITE } from "./site";

// Accueil du back-office (vague 3, bo-socle) : ce qui attend, les commandes du moment, le service contre
// la semaine passée, l'état du restaurant. Les chiffres viennent de /api/gestion/accueil, réservée au gérant.
test.describe.configure({ mode: "serial" });

const ORIGINE = { Origin: SITE };
let page: Page;

async function connecter(p: Page, email: string) {
  await adresseDuCompte(p, email);
  await p.goto("/gestion");
  await p.getByLabel("E-mail", { exact: true }).fill(email);
  await p.getByRole("button", { name: "Recevoir un code" }).click();
  const code = p.locator(".note-preversion strong");
  await expect(code).toHaveText(/^\d{8}$/);
  await p.getByLabel("Code à 8 chiffres").fill(await code.innerText());
  await p.getByRole("button", { name: "Me connecter" }).click();
}

test.beforeAll(async ({ browser }, info) => {
  page = await (await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL })).newPage();
  await connecter(page, `accueil-${info.project.name}@laferme.test`);
  await expect(page.getByRole("heading", { level: 1, name: "Accueil" })).toBeVisible();
});

test.afterAll(async () => {
  await page.context().close();
});

test("l'accueil montre les commandes, le service et le restaurant, et passe axe", async () => {
  for (const titre of ["Commandes", "Restaurant", "Rubriques"]) await expect(page.getByRole("heading", { level: 2, name: titre, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /^Ce (midi|soir)$/ })).toBeVisible();
  await expect(page.getByText(/^Service (de midi|du soir), mis à jour à \d{2}h\d{2}\.$/)).toBeVisible();
  // Soit des alertes (« À régler »), soit la phrase calme : jamais rien.
  await expect(page.getByRole("heading", { name: /^À régler \(\d+\)$/ }).or(page.getByText("Rien ne demande votre attention."))).toBeVisible();
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
});

test("une commande qui arrive compte dans « À accepter »", async ({ request }, info) => {
  const avant = (await (await page.request.get("/api/gestion/accueil")).json()).commandes.a_accepter as number;
  const rep = await request.post("/api/commandes", {
    headers: ORIGINE,
    data: {
      cle: `accueil-${info.project.name}-${Date.now()}`,
      mode: "retrait",
      moyen: "comptoir",
      quand: { type: "asap" },
      heure: "2026-11-10T19:05",
      client: { prenom: `Accueil${info.project.name}`, nom: "Test", telephone: "079 000 00 00", email: `accueil-client-${info.project.name}@laferme.test` },
      lignes: [{ slug: "pizza-margherita", qte: 1, choix: {}, retraits: [], note: "" }],
    },
  });
  expect(rep.ok()).toBe(true);
  // Les autres tests créent aussi des commandes : on attend au moins une de plus, à l'écran comme dans la route.
  await expect.poll(async () => (await (await page.request.get("/api/gestion/accueil")).json()).commandes.a_accepter as number).toBeGreaterThan(avant);
  await page.reload();
  const carte = page.locator(".bo-chiffre", { hasText: "À accepter" });
  await expect(carte.locator(".bo-chiffre-valeur")).toHaveText(/^\d+$/);
  // Au moins la nôtre (d'autres tests en acceptent pendant ce temps : on ne compare pas au chiffre d'avant).
  expect(Number(await carte.locator(".bo-chiffre-valeur").innerText())).toBeGreaterThanOrEqual(1);
  await expect(carte.getByRole("link", { name: "Ouvrir la tablette" })).toHaveAttribute("href", "/tablette");
});

test("la route de l'accueil est réservée au gérant", async ({ request, browser }, info) => {
  expect((await request.get("/api/gestion/accueil")).status()).toBe(401);
  const service = await browser.newPage({ baseURL: info.project.use.baseURL });
  await connecter(service, `accueil-service-${info.project.name}@laferme.test`);
  await expect(service.getByText("Réservé au gérant.")).toBeVisible();
  expect((await service.request.get("/api/gestion/accueil")).status()).toBe(403);
  await service.close();
});

test("une coupure dit que les chiffres n'ont pas pu être chargés", async () => {
  await page.route("**/api/gestion/accueil", (r) => r.abort());
  await page.reload();
  const alerte = page.getByRole("alert").filter({ hasText: "Les chiffres du jour n'ont pas pu être chargés." });
  await expect(alerte).toBeVisible();
  await page.unroute("**/api/gestion/accueil");
  await alerte.getByRole("button", { name: "Réessayer" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Commandes", exact: true })).toBeVisible();
});
