import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adresseDuCompte, codeDuPersonnel, passage, SITE } from "./site";

// Vague 3, bo-commandes : rubrique Clients (invités compris) et réclamations suivies comme des dossiers.
test.describe.configure({ mode: "serial" });

let gestion: Page;
let email: string;
let prenom: string;
let commande: string;

async function connecter(page: Page, adresse: string) {
  await adresseDuCompte(page, adresse);
  await page.goto("/gestion/clients");
  await page.getByLabel("E-mail", { exact: true }).fill(adresse);
  await page.getByLabel("Code à 8 chiffres").fill(await codeDuPersonnel(page));
  await page.getByRole("button", { name: "Me connecter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Clients" })).toBeVisible();
}

test.beforeAll(async ({ browser }, info) => {
  gestion = await (await browser.newContext({ baseURL: SITE })).newPage();
  await connecter(gestion, `clients-${info.project.name}@laferme.test`);
  prenom = `Bocli${info.project.name}${passage()}`;
  email = `${prenom.toLowerCase()}@laferme.test`;
  const rep = await gestion.request.post("/api/commandes", {
    headers: { Origin: SITE },
    data: {
      cle: `bo-cli-${info.project.name}-${passage()}`,
      mode: "retrait",
      moyen: "comptoir",
      quand: { type: "asap" },
      heure: "2026-11-10T19:05",
      client: { prenom, nom: "Fidele", telephone: "079 222 33 44", email },
      lignes: [{ slug: "pizza-margherita", qte: 1, choix: {}, retraits: [], note: "" }],
    },
  });
  expect(rep.ok()).toBe(true);
  const liste = await gestion.request.post("/api/gestion/commandes", { headers: { Origin: SITE }, data: { action: "liste_page", recherche: email } });
  commande = ((await liste.json()) as { lignes: { id: string }[] }).lignes[0].id;
  // Une réclamation notée au téléphone, pour l'onglet Réclamations.
  const r = await gestion.request.post("/api/gestion/reclamations", {
    headers: { Origin: SITE },
    data: { action: "ouvrir", commande_id: commande, type: "froid", source: "telephone", description: "Pizza froide à l'arrivée." },
  });
  expect(r.ok()).toBe(true);
});

test.afterAll(async () => {
  await gestion.context().close();
});

test("un invité se retrouve par e-mail, sa fiche garde une note, la marque attend une décision", async () => {
  await gestion.getByLabel("Nom, téléphone ou e-mail").fill(email);
  const ligne = gestion.getByRole("row", { name: new RegExp(prenom) });
  await expect(ligne).toHaveCount(1);
  await expect(ligne).toContainText("Invité");
  const r = await new AxeBuilder({ page: gestion }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);

  await ligne.getByRole("button").first().click();
  const fiche = gestion.getByRole("dialog");
  await expect(fiche.getByText("Sans compte : commandes en invité")).toBeVisible();
  await fiche.getByRole("tab", { name: "Notes" }).click();
  await fiche.getByLabel("Nouvelle note sur ce client").fill("Préfère être appelé.");
  await fiche.getByRole("button", { name: "Ajouter la note" }).click();
  await expect(gestion.getByText("Note ajoutée.")).toBeVisible();
  await expect(fiche.getByText("Préfère être appelé.")).toBeVisible();
  await fiche.getByRole("tab", { name: "Marque" }).click();
  await expect(fiche.getByText(/pas encore activé/)).toBeVisible();
  // Une commande s'ouvre depuis la fiche du client, puis retour au client.
  await fiche.getByRole("tab", { name: "Commandes" }).click();
  await fiche.getByRole("button", { name: /^N° \d+/ }).first().click();
  await expect(fiche.getByRole("tab", { name: "Historique" })).toBeVisible();
  await fiche.getByRole("button", { name: /^Retour à / }).click();
  await gestion.keyboard.press("Escape");
  await expect(fiche).toHaveCount(0);
});

test("une réclamation se suit jusqu'à sa clôture", async () => {
  await gestion.getByRole("tab", { name: "Réclamations" }).click();
  const ligne = gestion.getByRole("row", { name: new RegExp(prenom) });
  await expect(ligne).toHaveCount(1);
  await ligne.getByRole("button").first().click();
  const fiche = gestion.getByRole("dialog");
  await expect(fiche.getByText("Pizza froide à l'arrivée.")).toBeVisible();
  // Gestes pour la prochaine fois d'abord (éteints par défaut), le remboursement en dernier.
  await expect(fiche.getByLabel("Geste pour le client").locator("option")).toHaveText(["Choisir…", "Pas de geste", "Un remboursement déjà fait"]);
  await expect(fiche.getByText(/« Offert » et « Réduction » sur la prochaine commande ne sont pas encore activés/)).toBeVisible();
  await fiche.getByLabel("Geste pour le client").selectOption("aucun");
  await fiche.getByLabel("Pourquoi").fill("Client satisfait des excuses");
  await fiche.getByRole("button", { name: "Noter le geste" }).click();
  await expect(gestion.getByText("Geste noté.")).toBeVisible();
  await expect(fiche.getByLabel("Geste pour le client")).toHaveCount(0);
  await fiche.getByLabel("Nouvel état").selectOption("close");
  await fiche.getByLabel("Comment elle s'est réglée").fill("Excuses au téléphone.");
  await fiche.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(fiche.getByText("Close", { exact: true })).toBeVisible();
  const r = await new AxeBuilder({ page: gestion }).include("dialog").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
});

test("la recherche globale ouvre directement la fiche d'un client, sans e-mail dans l'adresse", async () => {
  await gestion.evaluate((e) => sessionStorage.setItem("laferme.gestion.ouvrir", JSON.stringify({ type: "client", cle: e, le: Date.now() })), email);
  await gestion.goto("/gestion/clients");
  const fiche = gestion.getByRole("dialog");
  await expect(fiche.getByText(email).first()).toBeVisible();
  expect(gestion.url()).not.toContain("@");
  await gestion.keyboard.press("Escape");
});
