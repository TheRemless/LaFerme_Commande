import { expect, test, type Page } from "@playwright/test";
import { adresseDuCompte, codeDuPersonnel, passage, SITE } from "./site";

// Responsable de service (D1, part de bo-commandes ; rôle activé dans la base embarquée) : il voit les
// commandes, les clients et les réclamations, modifie et annule une commande ; il ne voit pas les gestes du
// gérant (note, heure, réimpression, recréer, réclamation, marque) et le serveur les lui refuse.
test.describe.configure({ mode: "serial" });

const ORIGINE = { Origin: SITE };
let page: Page;
let prenom: string;
let commande: string;

test.beforeAll(async ({ browser }, info) => {
  page = await (await browser.newContext({ ...info.project.use, baseURL: SITE })).newPage();
  const email = `responsable-commandes-${info.project.name}@laferme.test`;
  await adresseDuCompte(page, email);
  await page.goto("/gestion/commandes");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Code à 8 chiffres").fill(await codeDuPersonnel(page));
  await page.getByRole("button", { name: "Me connecter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Commandes" })).toBeVisible();
  prenom = `Bresp${info.project.name}${passage()}`;
  const rep = await page.request.post("/api/commandes", {
    headers: ORIGINE,
    data: {
      cle: `bo-resp-${info.project.name}-${passage()}`,
      mode: "retrait",
      moyen: "comptoir",
      quand: { type: "asap" },
      heure: "2026-11-10T19:05",
      client: { prenom, nom: "Essai", telephone: "079 123 45 67", email: `${prenom.toLowerCase()}@laferme.test` },
      lignes: [{ slug: "pizza-margherita", qte: 1, choix: {}, retraits: [], note: "" }],
    },
  });
  expect(rep.ok()).toBe(true);
  // La liste lui est ouverte (voir_commandes) : la commande s'y retrouve par le prénom, en POST.
  const liste = await page.request.post("/api/gestion/commandes", { headers: ORIGINE, data: { action: "liste_page", recherche: prenom } });
  expect(liste.status()).toBe(200);
  commande = (await liste.json()).lignes[0].id;
});

test.afterAll(async () => {
  await page.context().close();
});

test("la fiche d'une commande : modifier et annuler, sans les gestes du gérant", async () => {
  await page.getByLabel("Numéro, nom, téléphone ou e-mail").fill(prenom);
  const ligne = page.getByRole("row", { name: new RegExp(prenom) });
  await expect(ligne).toHaveCount(1);
  await ligne.getByRole("button").first().click();
  const fiche = page.getByRole("dialog");
  await fiche.getByRole("tab", { name: "Gestes" }).click();
  await expect(fiche.getByRole("heading", { name: "Modifier à la demande du client" })).toBeVisible();
  await expect(fiche.getByRole("heading", { name: "Annuler la commande" })).toBeVisible();
  await expect(fiche.getByRole("heading", { name: "Le client veut la même" })).toHaveCount(0);
  await expect(fiche.getByRole("heading", { name: "Réimprimer" })).toHaveCount(0);
  await fiche.getByRole("tab", { name: "Notes" }).click();
  await expect(fiche.getByRole("button", { name: "Ajouter la note" })).toHaveCount(0);
  await fiche.getByRole("tab", { name: "Réclamations" }).click();
  await expect(fiche.getByRole("button", { name: "Noter la réclamation" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(fiche).toHaveCount(0);
});

test("le serveur lui ouvre la lecture et lui refuse les gestes du gérant", async () => {
  const poster = (url: string, data: Record<string, unknown>) => page.request.post(url, { headers: ORIGINE, data });
  expect((await poster("/api/gestion/commandes", { action: "fiche_complete", id: commande })).status()).toBe(200);
  expect((await poster("/api/gestion/clients", { action: "liste", page: 1 })).status()).toBe(200);
  expect((await poster("/api/gestion/reclamations", { action: "liste" })).status()).toBe(200);
  expect((await poster("/api/gestion/commandes", { action: "noter", id: commande, texte: "Essai" })).status()).toBe(403);
  expect((await poster("/api/gestion/commandes", { action: "recreer", id: commande, quand: { type: "asap" }, cle: `r-${passage()}` })).status()).toBe(403);
  expect((await poster("/api/gestion/commandes", { action: "reimprimer", id: commande })).status()).toBe(403);
  expect((await poster("/api/gestion/reclamations", { action: "ouvrir", commande_id: commande, type: "autre", source: "telephone", description: "Essai" })).status()).toBe(403);
  expect((await poster("/api/gestion/clients", { action: "noter", email: `${prenom.toLowerCase()}@laferme.test`, texte: "Essai" })).status()).toBe(403);
  // Une clé héritée d'objet n'ouvre rien.
  expect((await poster("/api/gestion/commandes", { action: "constructor", id: commande })).status()).toBe(403);
});

test("il annule une commande, avec un motif", async () => {
  await page.getByLabel("Numéro, nom, téléphone ou e-mail").fill(prenom);
  await page.getByRole("row", { name: new RegExp(prenom) }).getByRole("button").first().click();
  const fiche = page.getByRole("dialog");
  await fiche.getByRole("tab", { name: "Gestes" }).click();
  await fiche.getByLabel("Motif d'annulation").fill("Le client a appelé pour annuler");
  await fiche.getByRole("button", { name: "Annuler la commande" }).click();
  await page.getByRole("button", { name: "Annuler la commande" }).last().click();
  await expect(page.getByText(/^Commande (refusée|annulée)/).first()).toBeVisible();
});
