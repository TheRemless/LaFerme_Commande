import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { adresseDuCompte, codeDuPersonnel } from "./site";

// Lot 8d : contrôle automatique d'accessibilité (axe-core, règles WCAG 2.1 A et AA) sur chaque écran,
// en bureau et en mobile. Ce que l'outil ne voit pas (clavier, focus, annonces) est testé à la main
// plus bas et dans docs/accessibilite.md.

async function preparerRetrait(page: Page) {
  await page.addInitScript(() => {
    if (localStorage.getItem("laferme.choix.v1")) return;
    localStorage.setItem("laferme.choix.v1", JSON.stringify({ mode: "retrait", quand: { type: "asap" }, heureSimulee: "2026-11-10T19:05", enregistreLe: Date.now() }));
    localStorage.setItem(
      "laferme.panier.v1",
      JSON.stringify({ le: Date.now(), lignes: [{ slug: "pizza-margherita", qte: 2, choix: {}, retraits: [], note: "" }] }),
    );
  });
}

async function controler(page: Page, nom: string) {
  // La fiche et la barre du panier apparaissent en fondu : on mesure les contrastes une fois l'animation finie.
  // Une animation annulée (élément retiré) rejette « finished » : on l'ignore, et on n'attend jamais plus d'une seconde.
  await page.evaluate(() =>
    Promise.race([
      Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
      new Promise((fin) => setTimeout(fin, 1000)),
    ]),
  );
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const resume = r.violations.map((v) => `${nom} ${v.id} (${v.impact}) : ${v.nodes.map((n) => n.target.join(" ")).slice(0, 4).join(" | ")}`);
  expect.soft(resume, resume.join("\n")).toEqual([]);
}

const PAGES_SIMPLES = [
  ["accueil", "/?heure=2026-11-10T19:05"],
  ["compte", "/compte"],
  ["tablette", "/tablette"],
  ["gestion", "/gestion"],
  ["livreur", "/livreur"],
  ["mentions", "/mentions-legales"],
  ["cgv", "/cgv"],
  ["confidentialite", "/confidentialite"],
  ["introuvable", "/suivi/jeton-inexistant-0000000000"],
] as const;

for (const [nom, chemin] of PAGES_SIMPLES) {
  test(`axe : ${nom}`, async ({ page }) => {
    await page.goto(chemin);
    await expect(page.locator("h1").first()).toBeVisible();
    await controler(page, nom);
  });
}

test("axe : accueil, à emporter choisi", async ({ page }) => {
  await page.goto("/?heure=2026-11-10T19:05");
  await page.getByRole("button", { name: /À emporter/ }).click();
  await expect(page.getByText(/Dès que possible, entre/)).toBeVisible();
  await controler(page, "accueil-retrait");
});

test("axe : carte, fiche d'un plat, panier et commande", async ({ page }) => {
  await preparerRetrait(page);
  await page.goto("/carte");
  await expect(page.locator("li.plat").first()).toBeVisible();
  await controler(page, "carte");
  await page.locator('li[data-slug="pizza-margherita"] button').click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await controler(page, "fiche");
  await page.keyboard.press("Escape");
  await page.goto("/panier");
  await expect(page.locator("main")).toBeVisible();
  await controler(page, "panier");
  await page.goto("/commande");
  await expect(page.getByLabel("Prénom")).toBeVisible();
  await controler(page, "commande");
});

test("axe : suivi d'une commande", async ({ page }) => {
  await preparerRetrait(page);
  await page.goto("/commande");
  await page.getByLabel("Prénom").fill("Test");
  await page.getByLabel("Nom", { exact: true }).fill("Essai");
  await page.getByLabel("Téléphone").fill("079 000 00 00");
  await page.getByLabel("E-mail", { exact: true }).fill("a11y@exemple.ch");
  await page.getByText("Au comptoir").click();
  await page.getByRole("button", { name: "Commander, je paie au comptoir" }).click();
  await expect(page).toHaveURL(/\/suivi\//);
  await expect(page.locator("h1").first()).toBeVisible();
  await controler(page, "suivi");
});

test("clavier : lien d'évitement, fiche plat fermée par Échap, ajout annoncé", async ({ page }) => {
  await preparerRetrait(page);
  await page.goto("/carte");
  await expect(page.locator("li.plat").first()).toBeVisible();
  await page.keyboard.press("Tab");
  const evitement = page.getByRole("link", { name: "Aller au contenu" });
  await expect(evitement).toBeFocused();
  await expect(evitement).toBeInViewport();

  const bouton = page.locator('li[data-slug="pizza-margherita"] button');
  await bouton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(bouton).toBeFocused();

  await page.keyboard.press("Enter");
  await page.getByRole("dialog").getByRole("button", { name: /^Ajouter/ }).click();
  await expect(page.locator(".sr-only[role=status]")).toHaveText("Dans le panier : Margherita. 3 articles en tout.");

  await page.goto("/panier");
  const ligne = page.getByRole("group", { name: /^Quantité de .*Margherita/ });
  await ligne.getByRole("button", { name: "Un de plus" }).click();
  await expect(ligne.locator("[aria-live=polite]")).toHaveText("Quantité : 4");
});

test("page introuvable en français, avec le chemin du retour", async ({ page }) => {
  const rep = await page.goto("/page-qui-n-existe-pas");
  expect(rep?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page introuvable");
  await expect(page.getByRole("link", { name: "Revenir à l'accueil" })).toBeVisible();
});

test("lien de suivi inconnu : commande introuvable, avec l'endroit où trouver le bon lien", async ({ page }) => {
  const rep = await page.goto("/suivi/jeton-inexistant-0000000000");
  expect(rep?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Commande introuvable");
  await expect(page.getByText("e-mail de confirmation")).toBeVisible();
  await expect(page.getByRole("link", { name: "Revenir à l'accueil" })).toBeVisible();
});

async function connecterPersonnel(page: Page, email: string) {
  await adresseDuCompte(page, email);
  await page.goto("/tablette");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Code à 8 chiffres").fill(await codeDuPersonnel(page));
  await page.getByRole("button", { name: "Me connecter" }).click();
}

test("axe : tablette et back-office connectés", async ({ page }, info) => {
  // Comptes à part (supabase/local/donnees-test.sql) : pas de conflit de code avec gestion.spec.ts.
  await connecterPersonnel(page, `a11y-${info.project.name}@laferme.test`);
  await page.getByRole("button", { name: "Continuer sans son" }).click();
  await expect(page.getByRole("button", { name: /^À accepter/ })).toBeVisible();
  // Après la connexion (router.refresh), la page doit garder son titre. Avec les métadonnées en flux, Next le
  // retirait parfois sans le remettre (next.config.ts, htmlLimitedBots).
  await expect(page).toHaveTitle("Tablette, La Ferme");
  await controler(page, "tablette-file");
  await page.getByRole("button", { name: "Pause, délai, ruptures" }).click();
  await controler(page, "tablette-reglages");
  await page.getByRole("button", { name: /^Livraisons/ }).click();
  await controler(page, "tablette-livraisons");
  // Vue par poste (vague 3, D12 à l'essai, derrière un lien).
  await page.goto("/tablette/poste/pizza");
  await expect(page.locator(".poste-tete p")).not.toHaveText("Chargement…");
  await controler(page, "tablette-poste");
  await page.goto("/gestion");
  await expect(page.locator("h1").first()).toBeVisible();
  await controler(page, "gestion");
});
