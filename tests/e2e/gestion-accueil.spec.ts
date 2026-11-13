import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adresseDuCompte, codeDuPersonnel, SITE } from "./site";

// Accueil du back-office (vague 3, bo-socle) : ce qui attend, les commandes du moment, le service contre
// la semaine passée, l'état du restaurant. Les chiffres viennent de /api/gestion/accueil, réservée au gérant.
test.describe.configure({ mode: "serial" });

const ORIGINE = { Origin: SITE };
let page: Page;

async function connecter(p: Page, email: string) {
  await adresseDuCompte(p, email);
  await p.goto("/gestion");
  await p.getByLabel("E-mail", { exact: true }).fill(email);
  await p.getByLabel("Code à 8 chiffres").fill(await codeDuPersonnel(p));
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

test("les alertes se voient sur toutes les pages ; une commande citée ouvre sa fiche", async ({}, info) => {
  // Une alerte connue, posée sur la vraie réponse : la base de test n'a pas forcément de remboursement en échec.
  const liste = await page.request.post("/api/gestion/commandes", { headers: ORIGINE, data: { action: "liste_page", recherche: `Accueil${info.project.name}` } });
  expect(liste.ok()).toBe(true);
  const c = ((await liste.json()) as { lignes: { id: string; numero: number; jour_service: string }[] }).lignes[0];
  expect(c).toBeTruthy();
  const vraie = await (await page.request.get("/api/gestion/accueil")).json();
  const alerte = {
    cle: "remboursements",
    type: "remboursements",
    niveau: "bloquant",
    titre: "1 remboursement a échoué",
    detail: "Le client n'a pas été remboursé.",
    commandes: [{ id: c.id, numero: c.numero, jour: c.jour_service }],
    liste: { href: `/gestion/commandes?remboursement=echec&du=${c.jour_service}&au=${c.jour_service}`, texte: "Voir la liste" },
  };
  await page.route("**/api/gestion/accueil", (r) => r.fulfill({ json: { ...vraie, alertes: [alerte] } }));

  // Ailleurs que sur l'accueil : le nombre dans le titre de l'onglet et sur Accueil (ou sur Menu au téléphone).
  await page.goto("/gestion/horaires");
  await expect(page).toHaveTitle(/^\(1\) /);
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  if (await menu.isVisible()) await expect(menu).toHaveAccessibleDescription("1 alerte à régler");
  else
    await expect(page.getByRole("navigation", { name: "Rubriques" }).getByRole("link", { name: "Accueil", exact: true })).toHaveAccessibleDescription(
      "1 alerte à régler, dont au moins une bloque le service",
    );

  // Sur l'accueil : la commande avec son jour, qui ouvre sa fiche dans Commandes ; aucune donnée de client dans l'adresse.
  await page.goto("/gestion");
  await expect(page.getByRole("link", { name: "Voir la liste" })).toHaveAttribute("href", alerte.liste.href);
  await page.getByRole("button", { name: new RegExp(`^N° ${c.numero}, \\p{L}+ \\d+ \\p{L}+$`, "u") }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Commandes" })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("tab", { name: "Historique" })).toBeVisible();
  expect(page.url()).not.toContain(c.id);
  await page.keyboard.press("Escape");

  // Réglages de l'appareil : un type par ligne, coupés tant que les notifications ne sont pas demandées.
  await page.goto("/gestion");
  await page.getByRole("button", { name: "Régler les alertes" }).click();
  const panneau = page.getByRole("dialog", { name: "Alertes sur cet appareil" });
  await expect(panneau.getByRole("group", { name: "Me prévenir pour" }).getByRole("checkbox")).toHaveCount(9);
  const r = await new AxeBuilder({ page }).include(".bo-panneau").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(panneau).toHaveCount(0);
  await page.unroute("**/api/gestion/accueil");
  await page.goto("/gestion");
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
