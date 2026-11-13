import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adresseDuCompte, codeDuPersonnel } from "./site";

// Kit du back-office (vague 3) sur sa page de démonstration /gestion/kit (base embarquée seulement) :
// tableau (tri, recherche, pages, colonnes, sélection, lot, CSV), confirmation, notification « Annuler »,
// panneau de fiche, formulaire, garde des modifications, raccourcis, onglets, période.
test.describe.configure({ mode: "serial" });

let page: Page;
const axe = async (p: Page) =>
  (await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
const lignes = () => page.locator(".bo-tableau tbody tr");

test.beforeAll(async ({ browser }, info) => {
  page = await (await browser.newContext({ ...info.project.use, baseURL: info.project.use.baseURL })).newPage();
  const email = `kit-${info.project.name}@laferme.test`;
  await adresseDuCompte(page, email);
  await page.goto("/gestion/kit");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Code à 8 chiffres").fill(await codeDuPersonnel(page));
  await page.getByRole("button", { name: "Me connecter" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Kit du back-office" })).toBeVisible();
});

test.afterAll(async () => {
  await page.context().close();
});

test("la page de démonstration passe le contrôle axe", async () => {
  expect(await axe(page)).toEqual([]);
});

test("le tableau trie, cherche et pagine", async () => {
  await expect(page.getByText("1 à 25 sur 237")).toBeVisible();
  await expect(lignes().first()).toContainText("1236");
  await page.getByRole("button", { name: /^N°/ }).click();
  await expect(page.locator('th[aria-sort="ascending"]')).toContainText("N°");
  await expect(lignes().first()).toContainText("1000");
  await page.getByRole("button", { name: "Suivante" }).click();
  await expect(page.getByText("26 à 50 sur 237")).toBeVisible();
  await page.getByPlaceholder("Numéro ou client").fill("Client essai 12");
  await expect(page.getByText(/^1 à 11 sur 11$/)).toBeVisible();
  await page.getByPlaceholder("Numéro ou client").press("Escape");
  await expect(page.getByText("1 à 25 sur 237")).toBeVisible();
});

test("les colonnes choisies et la densité restent après rechargement", async () => {
  await expect(page.getByRole("columnheader", { name: "Statut" })).toHaveCount(0);
  await page.getByText("Colonnes", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Statut" }).check();
  await page.getByRole("button", { name: "Compact" }).click();
  await page.reload();
  await expect(page.getByRole("columnheader", { name: "Statut" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Compact" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Compact" }).click();
});

test("l'export CSV prend toutes les lignes du filtre, au format Excel suisse", async () => {
  const fichier = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter en CSV" }).click();
  const f = await fichier;
  expect(f.suggestedFilename()).toMatch(/^la-ferme-commandes-de-demonstration-\d{4}-\d{2}-\d{2}\.csv$/);
  const morceaux: Buffer[] = [];
  for await (const m of await f.createReadStream()) morceaux.push(m as Buffer);
  const texte = Buffer.concat(morceaux).toString("utf8");
  expect(texte.startsWith("﻿N°;Client;Mode;Statut;Total CHF\r\n")).toBe(true);
  expect(texte.trim().split("\r\n")).toHaveLength(238);
});

test("une action en lot se confirme, puis se défait par « Annuler »", async () => {
  const premiere = await lignes().nth(0).locator("td").nth(1).innerText();
  await lignes().nth(0).getByRole("checkbox").check();
  await lignes().nth(1).getByRole("checkbox").check();
  await expect(page.getByRole("region", { name: "Actions sur la sélection" })).toContainText("2 sélectionnées");
  await page.getByRole("button", { name: "Archiver", exact: true }).click();
  const boite = page.getByRole("dialog", { name: "Archiver 2 commandes ?" });
  await expect(boite).toBeVisible();
  // Action qui ne se défait pas d'elle-même : le focus part sur « non ».
  await expect(boite.getByRole("button", { name: "Annuler" })).toBeFocused();
  await boite.getByRole("button", { name: "Archiver 2" }).click();
  await expect(lignes().nth(0)).not.toContainText(premiere);
  const notif = page.locator(".bo-notif", { hasText: "2 archivées." });
  await expect(notif).toBeVisible();
  await notif.getByRole("button", { name: "Annuler" }).click();
  await expect(lignes().nth(0)).toContainText(premiere);
});

test("la fiche s'ouvre en panneau, demande avant de perdre une saisie, rend le focus", async () => {
  const bouton = lignes().nth(0).locator(".bo-ouvrir");
  const numero = (await bouton.innerText()).trim();
  await bouton.click();
  const panneau = page.getByRole("dialog", { name: `Commande ${numero}` });
  await expect(panneau).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await panneau.getByLabel("Nom affiché").fill("Nom changé");
  await page.keyboard.press("Escape");
  const garde = page.getByRole("dialog", { name: "Quitter sans enregistrer ?" });
  await garde.getByRole("button", { name: "Rester sur la page" }).click();
  await expect(panneau).toBeVisible();
  await expect(panneau.getByLabel("Nom affiché")).toHaveValue("Nom changé");
  await page.keyboard.press("Escape");
  await garde.getByRole("button", { name: "Quitter sans enregistrer" }).click();
  await expect(panneau).toBeHidden();
  await expect(bouton).toBeFocused();
});

test("le formulaire dit ce qui est faux, puis « Enregistré »", async () => {
  await page.getByRole("tab", { name: "Formulaire" }).click();
  const prix = page.getByLabel("Prix (CHF)");
  await prix.fill("abc");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(prix).toHaveAttribute("aria-invalid", "true");
  await expect(prix).toHaveAccessibleDescription(/Le prix de la salle\. Un prix comme 18\.50/);
  await expect(prix).toBeFocused();
  await prix.fill("21.50");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator(".bo-barre-etat")).toHaveText("Enregistré.");
  await expect(page.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
});

test("une saisie non enregistrée retient le changement de rubrique", async ({}, info) => {
  await page.getByLabel("Nom affiché").fill("Pas enregistré");
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  if (info.project.name === "mobile") await menu.click();
  await page.getByRole("navigation", { name: "Rubriques" }).getByRole("link", { name: "Journal", exact: true }).click();
  const garde = page.getByRole("dialog", { name: "Quitter sans enregistrer ?" });
  await garde.getByRole("button", { name: "Rester sur la page" }).click();
  await expect(page).toHaveURL(/\/gestion\/kit$/);
  await expect(page.getByLabel("Nom affiché")).toHaveValue("Pas enregistré");
  if (info.project.name === "mobile" && (await page.getByRole("button", { name: "Fermer le menu" }).isVisible())) await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Annuler les changements" }).click();
  await expect(page.getByLabel("Nom affiché")).toHaveValue("Pizza essai");
});

test("les onglets se parcourent aux flèches", async () => {
  const formulaire = page.getByRole("tab", { name: "Formulaire" });
  await formulaire.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "États" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "États" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.getByRole("tab", { name: /^Tableau/ })).toHaveAttribute("aria-selected", "true");
});

test("« ? » liste les raccourcis de la page, « / » va à la recherche", async ({}, info) => {
  test.skip(info.project.name !== "bureau", "Clavier physique");
  await page.locator("body").click({ position: { x: 600, y: 120 } });
  await page.keyboard.press("?");
  const liste = page.getByRole("dialog", { name: "Raccourcis clavier" });
  await expect(liste).toContainText("Nouvelle commande (démonstration)");
  await expect(liste).toContainText("Chercher dans commandes de démonstration");
  await page.keyboard.press("Escape");
  await expect(liste).toBeHidden();
  await page.keyboard.press("/");
  await expect(page.getByPlaceholder("Numéro ou client")).toBeFocused();
});

test("la relecture en direct garde la dernière demande, la chronologie se lit par jour", async () => {
  await page.getByRole("tab", { name: "Direct" }).click();
  const etat = page.locator(".bo-demo-lecture");
  await expect(etat).toContainText(/Lecture n° \d+/);
  // Deux demandes coup sur coup : la première (lente) revient après la seconde et doit être jetée.
  const avant = Number((await etat.innerText()).match(/n° (\d+)/)![1]);
  await page.getByRole("button", { name: "Relire maintenant" }).click();
  await page.getByRole("button", { name: "Relire maintenant" }).click();
  await expect(etat).toContainText(`n° ${avant + 2}`);
  await page.waitForTimeout(1800);
  await expect(etat).toContainText(`n° ${avant + 2}`);
  // Deux jours, le plus récent en haut.
  await expect(page.locator(".bo-chrono-jour")).toHaveText(["samedi 14 novembre", "vendredi 13 novembre"]);
  await expect(page.locator(".bo-chrono li[data-important]")).toContainText("Remboursée CHF 5.00");
  await page.getByRole("tab", { name: /^Tableau/ }).click();
});

test("la période se choisit par raccourci ou par dates, et refuse un début après la fin", async () => {
  const periode = page.getByRole("group", { name: "Période" });
  await periode.getByRole("button", { name: "Hier" }).click();
  await expect(periode.getByRole("button", { name: "Hier" })).toHaveAttribute("aria-pressed", "true");
  await periode.getByLabel("Du").fill("2026-11-12");
  await periode.getByLabel("au").fill("2026-11-01");
  await expect(periode.getByRole("alert")).toHaveText("La date de début est après la date de fin.");
});
