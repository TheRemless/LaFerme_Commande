import { expect, test, type Page } from "@playwright/test";
import { adresseDuCompte, codeDuPersonnel, passage, SITE } from "./site";

// Le client appelle pour changer sa commande (vague 3, bo-commandes) : au back-office, « Changer les plats ».
// À encaisser au comptoir : le total change. Payée en ligne et plus chère : un lien de paiement (doublure de Stripe),
// la modification s'applique au paiement. Jamais un prix écrit ici : les plats viennent de la carte.
test.describe.configure({ mode: "serial" });

const ORIGINE = { Origin: SITE };
let page: Page;

async function commander(prenom: string, moyen: "comptoir" | "en_ligne") {
  const rep = await page.request.post("/api/commandes", {
    headers: ORIGINE,
    data: {
      cle: `diff-${prenom}-${passage()}-0123456789`,
      mode: "retrait",
      moyen,
      quand: { type: "asap" },
      heure: "2026-11-10T19:05",
      client: { prenom, nom: "Essai", telephone: "079 123 45 67", email: `${prenom.toLowerCase()}@laferme.test` },
      lignes: [{ slug: "pizza-margherita", qte: 1, choix: {}, retraits: [], note: "" }],
    },
  });
  expect(rep.ok()).toBe(true);
  const { redirection } = (await rep.json()) as { redirection: string };
  if (moyen === "en_ligne") {
    const id = redirection.match(/paiement-test\/([0-9a-f-]+)/)![1];
    expect((await page.request.post("/api/paiement-test", { data: { commande: id, issue: "paye" } })).ok()).toBe(true);
  }
}

async function ouvrirFiche(prenom: string) {
  await page.goto("/gestion/commandes");
  await page.getByLabel("Numéro, nom, téléphone ou e-mail").fill(prenom);
  await page.getByRole("row", { name: new RegExp(prenom) }).getByRole("button").first().click();
  const fiche = page.getByRole("dialog");
  await fiche.getByRole("tab", { name: "Gestes" }).click();
  return fiche;
}

async function ajouterUnPlat(fiche: ReturnType<Page["getByRole"]>) {
  await fiche.getByRole("button", { name: "Changer les plats" }).click();
  await fiche.getByRole("group", { name: "Ajouter un plat" }).getByRole("button").first().click();
  await fiche.locator(".bo-plats-choix button").first().click();
  await page.locator(".fiche").getByRole("button", { name: /^Ajouter/ }).click();
}

test.beforeAll(async ({ browser }, info) => {
  page = await (await browser.newContext({ ...info.project.use, baseURL: SITE })).newPage();
  const email = `difference-${info.project.name}@laferme.test`;
  await adresseDuCompte(page, email);
  await page.goto("/gestion/commandes");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Code à 8 chiffres").fill(await codeDuPersonnel(page));
  await page.getByRole("button", { name: "Me connecter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Commandes" })).toBeVisible();
});

test.afterAll(async () => {
  await page.context().close();
});

test("à encaisser au comptoir : un plat de plus, le nouveau total à encaisser", async ({}, info) => {
  const prenom = `Diffcpt${info.project.name}${passage()}`;
  await commander(prenom, "comptoir");
  const fiche = await ouvrirFiche(prenom);
  await ajouterUnPlat(fiche);
  await expect(fiche.getByText(/^Nouveau total à encaisser au retrait : CHF/)).toBeVisible();
  await fiche.getByRole("button", { name: "Enregistrer la modification" }).click();
  await page.getByRole("button", { name: "Enregistrer la modification" }).last().click();
  await expect(page.getByText(/^Commande modifiée\. Nouveau total à encaisser : CHF/)).toBeVisible();
  await page.keyboard.press("Escape");
});

test("payée en ligne, plus chère : lien de paiement ; rien ne change avant le paiement, puis le complément est payé", async ({}, info) => {
  const prenom = `Difflien${info.project.name}${passage()}`;
  await commander(prenom, "en_ligne");
  let fiche = await ouvrirFiche(prenom);
  await ajouterUnPlat(fiche);
  await expect(fiche.getByRole("radio", { name: /lien de paiement/ })).toBeChecked();
  await fiche.getByRole("button", { name: "Enregistrer la modification" }).click();
  await page.getByRole("button", { name: "Enregistrer la modification" }).last().click();
  const lien = await fiche.getByLabel("Lien de paiement à envoyer au client").inputValue();
  expect(lien).toMatch(/\/paiement-test\/complement\/[0-9a-f-]{36}$/);
  await expect(fiche.getByText(/^Lien de paiement envoyé/)).toBeVisible();
  if (info.project.name === "bureau") await page.screenshot({ path: "docs/rendus/vague-3/bo-commandes/difference-lien-bureau.jpg", quality: 80 });
  // Le client paie (doublure de Stripe, même chemin que le webhook).
  const modification = lien.split("/").pop()!;
  expect((await page.request.post("/api/paiement-test", { data: { complement: modification, issue: "paye" } })).ok()).toBe(true);
  await page.keyboard.press("Escape");
  fiche = await ouvrirFiche(prenom);
  await expect(fiche.getByText(/^Complément CHF .+ payé par le lien, encaissé/)).toBeVisible();
  await expect(fiche.getByText(/^Lien de paiement envoyé/)).toHaveCount(0);
  await page.keyboard.press("Escape");
});
