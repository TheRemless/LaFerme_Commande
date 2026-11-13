import AxeBuilder from "@axe-core/playwright";
import { SITE, adresseDuCompte } from "./site";
import { expect, test, type Page } from "@playwright/test";

// Rubrique Réglages généraux du back-office (vague 3, bo-operations). Seul l'e-mail des alertes est enregistré :
// créneau, jours à l'avance et plafond des codes changeraient le site pour les autres fichiers de tests.
test.describe.configure({ mode: "serial", timeout: 90_000 });

const CAPTURES = "docs/rendus/vague-3/bo-operations";

async function connecter(page: Page, email: string) {
  await adresseDuCompte(page, email);
  await page.goto("/gestion/reglages");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Recevoir un code" }).click();
  const code = page.locator(".note-preversion strong");
  // Premier appel après le démarrage du serveur : la page compile, d'où un délai plus large.
  await expect(code).toHaveText(/^\d{8}$/, { timeout: 20_000 });
  await page.getByLabel("Code à 8 chiffres").fill(await code.innerText());
  await page.getByRole("button", { name: "Me connecter" }).click();
  await expect(page.getByLabel("Code à 8 chiffres")).toHaveCount(0);
}

test("réglages généraux : e-mail des alertes, erreur de saisie, accessibilité", async ({ page }, info) => {
  test.skip(info.project.name !== "bureau", "réglages communs à la base : projet bureau");
  await page.setViewportSize({ width: 1024, height: 900 });
  await connecter(page, "ecran-reglages@laferme.test");
  const email = page.getByLabel("E-mail qui reçoit les alertes");
  try {
    await expect(page.getByLabel("Longueur d'un créneau")).toHaveValue("15");
    await expect(page.getByLabel("Le client peut annuler sa commande depuis son suivi")).not.toBeChecked();
    // Interrupteurs de client-commande : présents et éteints (les allumer changerait la carte des autres tests).
    await expect(page.getByLabel("« Les plus commandés » en tête de la carte")).not.toBeChecked();
    await expect(page.getByLabel("Proposer une boisson ou un dessert au panier")).not.toBeChecked();
    // Rythme de la cuisine : débits à 0 au départ, la file n'est pas comptée.
    await expect(page.getByLabel("Pizzas que le four sort en 15 minutes")).toHaveValue("0");
    await expect(page.getByText("En ce moment : la file n'est pas comptée (débits à 0).")).toBeVisible();

    // Erreur de saisie : le champ est signalé, rien ne part.
    await page.getByLabel("Commande à l'avance, jours au plus").fill("30");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Un nombre de jours de 0 à 14.")).toBeVisible();
    await expect(page.getByLabel("Commande à l'avance, jours au plus")).toBeFocused();
    await page.getByRole("button", { name: "Annuler les changements" }).click();

    await email.fill("alertes-ecran@laferme.test");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Réglages enregistrés.")).toBeVisible();
    await page.reload();
    await expect(email).toHaveValue("alertes-ecran@laferme.test");

    const axe = await new AxeBuilder({ page }).include(".bo-contenu").analyze();
    expect(axe.violations.map((v) => `${v.id} : ${v.nodes.length}`)).toEqual([]);
    await page.screenshot({ path: `${CAPTURES}/reglages-1024.png`, fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    // Rechargée à cette largeur : le menu latéral devient un tiroir fermé (pas d'animation en cours).
    await page.reload();
    await expect(email).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/reglages-375.png`, fullPage: true });
  } finally {
    await page.request.post("/api/gestion/service", { headers: { Origin: SITE }, data: { type: "reglage-general", cle: "alerte_email", valeur: null } });
  }
});
