import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adresseDuCompte, SITE } from "./site";

// Vague 3, bo-commandes : rubrique Commandes sur le kit du back-office. Liste paginée côté serveur avec
// pastilles de statut et recherche, fiche en panneau (onglets), note interne, modification d'une commande,
// accessibilité de la liste et de la fiche. Une commande au comptoir créée ici, jamais un prix écrit.
test.describe.configure({ mode: "serial" });

let gestion: Page;
let prenom: string;

async function connecter(page: Page, email: string) {
  await adresseDuCompte(page, email);
  await page.goto("/gestion/commandes");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Recevoir un code" }).click();
  const code = page.locator(".note-preversion strong");
  await expect(code).toHaveText(/^\d{8}$/);
  await page.getByLabel("Code à 8 chiffres").fill(await code.innerText());
  await page.getByRole("button", { name: "Me connecter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Commandes" })).toBeVisible();
}

test.beforeAll(async ({ browser }, info) => {
  // Axe demande une page ouverte dans un contexte (browser.newContext()).
  gestion = await (await browser.newContext({ baseURL: SITE })).newPage();
  await connecter(gestion, `commandes-${info.project.name}@laferme.test`);
  prenom = `Bocmd${info.project.name}${Date.now() % 100000}`;
  const rep = await gestion.request.post("/api/commandes", {
    headers: { Origin: SITE },
    data: {
      cle: `bo-cmd-${info.project.name}-${Date.now()}`,
      mode: "retrait",
      moyen: "comptoir",
      quand: { type: "asap" },
      heure: "2026-11-10T19:05",
      client: { prenom, nom: "Essai", telephone: "079 123 45 67", email: `${prenom.toLowerCase()}@laferme.test` },
      lignes: [{ slug: "pizza-margherita", qte: 1, choix: {}, retraits: [], note: "bien cuite" }],
    },
  });
  expect(rep.ok()).toBe(true);
});

test.afterAll(async () => {
  await gestion.context().close();
});

test("la liste se filtre par statut et se cherche par nom, sans erreur d'accessibilité", async () => {
  const aAccepter = gestion.getByRole("button", { name: /^À accepter \d+$/ });
  await aAccepter.click();
  await expect(aAccepter).toHaveAttribute("aria-pressed", "true");
  await gestion.getByLabel("Numéro, nom, téléphone ou e-mail").fill(prenom);
  await expect(gestion.getByText("Recherche sur les 90 derniers jours.")).toBeVisible();
  await expect(gestion.getByRole("row", { name: new RegExp(`${prenom} Essai`) })).toHaveCount(1);
  const r = await new AxeBuilder({ page: gestion }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
});

test("la fiche montre la commande, garde une note et enregistre un changement de téléphone", async () => {
  await gestion.getByRole("row", { name: new RegExp(`${prenom} Essai`) }).getByRole("button").first().click();
  const fiche = gestion.getByRole("dialog");
  await expect(fiche.getByText("À accepter", { exact: true })).toBeVisible();
  await expect(fiche.getByText("Note : bien cuite")).toBeVisible();

  await fiche.getByRole("tab", { name: "Notes" }).click();
  await fiche.getByLabel("Nouvelle note").fill("Client rappelé, il passe à 20h.");
  await fiche.getByRole("button", { name: "Ajouter la note" }).click();
  await expect(gestion.getByText("Note ajoutée.")).toBeVisible();
  await expect(fiche.getByText("Client rappelé, il passe à 20h.")).toBeVisible();
  await expect(fiche.getByLabel("Nouvelle note")).toHaveValue("");

  await fiche.getByRole("tab", { name: "Gestes" }).click();
  await fiche.getByLabel("Téléphone").fill("079 765 43 21");
  await fiche.getByRole("button", { name: "Enregistrer les changements" }).click();
  await expect(gestion.getByText(/Commande modifiée/)).toBeVisible();

  // « Il manque le tiramisù » : la réclamation se note depuis la commande.
  await fiche.getByRole("tab", { name: "Réclamations" }).click();
  await fiche.getByLabel("Ce que dit le client").fill("Il manque la boisson.");
  await fiche.getByRole("button", { name: "Noter la réclamation" }).click();
  await expect(gestion.getByText("Réclamation notée.")).toBeVisible();
  await expect(fiche.getByText("Il manque la boisson.")).toBeVisible();

  await fiche.getByRole("tab", { name: "Historique" }).click();
  await expect(fiche.getByText("Commande modifiée")).toBeVisible();
  await expect(fiche.getByText("Client rappelé, il passe à 20h.")).toBeVisible();

  const r = await new AxeBuilder({ page: gestion }).include("dialog").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
  await gestion.keyboard.press("Escape");
  await expect(fiche).toHaveCount(0);
});
