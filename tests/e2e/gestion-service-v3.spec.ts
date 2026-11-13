import AxeBuilder from "@axe-core/playwright";
import { adresseDuCompte, codeDuPersonnel, SITE } from "./site";
import { expect, test, type Page } from "@playwright/test";

// Rubrique Livraison et horaires, parties de la vague 3 (bo-operations) : tester une adresse, coup de feu, services d'une zone,
// zone fermée jusqu'à une heure. Coup de feu d'une minute de retard, fini aussitôt ; zones sur la zone 3
// (fermée dans la base de départ) : les autres fichiers de tests ne sont pas gênés.
test.describe.configure({ mode: "serial", timeout: 90_000 });

const ORIGINE = { Origin: SITE };
const CAPTURES = "docs/rendus/vague-3/bo-operations";

async function connecter(page: Page, email: string) {
  await adresseDuCompte(page, email);
  await page.goto("/gestion/horaires");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Code à 8 chiffres").fill(await codeDuPersonnel(page));
  await page.getByRole("button", { name: "Me connecter" }).click();
  await expect(page.getByLabel("Code à 8 chiffres")).toHaveCount(0);
}

test("coup de feu, services d'une zone, zone fermée", async ({ page }, info) => {
  test.skip(info.project.name !== "bureau", "réglages communs à la base : projet bureau");
  await page.setViewportSize({ width: 1024, height: 900 });
  await connecter(page, "ecran-service@laferme.test");
  const cdf = page.locator(".bo-cdf");
  const zone3 = page.locator(".ges-zone").filter({ hasText: "Zone 3" });
  try {
    // Retard sur les commandes en cours : aperçu seulement. Le geste décalerait les commandes des autres fichiers
    // de tests (base commune) ; il est vérifié en base (decaler-commandes-sql) et côté serveur (decalage.test).
    const decaler = page.locator(".bo-decaler");
    await expect(decaler.getByRole("heading", { name: "Retard sur les commandes en cours" })).toBeVisible();
    await expect(decaler.getByRole("status")).toHaveText(/^(Aucune commande en cours à décaler\.|\d+ commandes? en cours, \d+ clients? prévenus? par e-mail\.)$/);
    await decaler.getByLabel("Four (les commandes avec pizzas)").check();
    await expect(decaler.getByRole("button", { name: /^Décaler de 15 min$/ })).toBeVisible();
    await decaler.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${CAPTURES}/horaires-decaler-1024.png` });

    // Tester une adresse : Onex (zone 1) puis hors zone. Montants lus en base, jamais écrits ici.
    const testeur = page.locator(".bo-test-adresse");
    await testeur.getByLabel("NPA").fill("1213");
    await testeur.getByLabel("Localité").fill("Onex");
    await testeur.getByRole("button", { name: "Tester" }).click();
    await expect(testeur.getByText("Zone 1 : livrée")).toBeVisible();
    await expect(testeur.getByText(/^Frais de livraison \d+\.\d{2} CHF, commande minimum \d+\.\d{2} CHF\.$/)).toBeVisible();
    await expect(testeur.getByText(/^Délai annoncé en ce moment : de \d+ à \d+ minutes\.$/)).toBeVisible();
    await expect(testeur.getByText("Sans rue : seuls le NPA et la localité ont compté.")).toBeVisible();
    await testeur.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${CAPTURES}/horaires-tester-adresse-1024.png` });
    await testeur.getByLabel("NPA").fill("1003");
    await testeur.getByLabel("Localité").fill("Lausanne");
    await testeur.getByRole("button", { name: "Tester" }).click();
    await expect(testeur.getByText("Hors zone")).toBeVisible();

    // Coup de feu : une minute de retard seulement, capacités inchangées.
    await expect(cdf.getByRole("button", { name: "Lancer le coup de feu" })).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/horaires-coup-de-feu-formulaire-1024.png` });
    await cdf.getByLabel("Retard en tout (min)").fill("1");
    await cdf.getByLabel("Livraisons par créneau, au plus").fill("");
    await cdf.getByLabel("Retraits par créneau, au plus").fill("");
    await cdf.getByLabel("Pendant").selectOption("30");
    await cdf.getByRole("button", { name: "Lancer le coup de feu" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Lancer le coup de feu" }).click();
    await expect(cdf.getByText(/En cours jusqu'à/)).toBeVisible();
    await expect(cdf.getByText(/retard en tout/)).toBeVisible();

    // Zone 3 : le soir seulement, puis fermée jusqu'à demain midi.
    await zone3.getByRole("button", { name: "Midi" }).click();
    await expect(zone3.getByRole("button", { name: "Midi" })).toHaveAttribute("aria-pressed", "false");
    await test.step("ouvrir le formulaire de fermeture", async () => {
      await zone3.getByText("Fermer cette zone pour quelques heures").click();
      await expect(zone3.getByLabel("Jusqu'au")).toBeVisible({ timeout: 5_000 });
    });
    const demain = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await test.step("remplir", async () => {
      await zone3.getByLabel("Jusqu'au").fill(demain, { timeout: 5_000 });
      await zone3.getByLabel("à", { exact: true }).fill("12:00", { timeout: 5_000 });
      await zone3.getByLabel("Motif, lu par les clients").fill("Neige", { timeout: 5_000 });
    });
    await zone3.getByRole("button", { name: "Fermer jusqu'à cette heure" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Fermer Zone 3" }).click();
    await expect(zone3.getByText(/Fermée jusqu'à 12h00/)).toBeVisible();

    const axe = await new AxeBuilder({ page }).include(".bo-contenu").analyze();
    expect(axe.violations.map((v) => `${v.id} : ${v.nodes.length}`)).toEqual([]);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${CAPTURES}/horaires-coup-de-feu-1024.png` });
    await zone3.locator(".bo-zone-ops").evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: `${CAPTURES}/horaires-zone-fermee-1024.png` });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload();
    await expect(cdf.getByText(/En cours jusqu'à/)).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${CAPTURES}/horaires-coup-de-feu-375.png` });

    // Fin du coup de feu, réouverture et retour aux deux services.
    await page.setViewportSize({ width: 1024, height: 900 });
    await cdf.getByRole("button", { name: "Finir le coup de feu" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Finir le coup de feu" }).click();
    await expect(cdf.getByRole("button", { name: "Lancer le coup de feu" })).toBeVisible();
    await zone3.getByRole("button", { name: "Rouvrir maintenant" }).click();
    await expect(zone3.getByText("Fermer cette zone pour quelques heures")).toBeVisible();
    await zone3.getByRole("button", { name: "Midi" }).click();
    await expect(zone3.getByRole("button", { name: "Midi" })).toHaveAttribute("aria-pressed", "true");
  } finally {
    const poster = (url: string, data: Record<string, unknown>) => page.request.post(url, { headers: ORIGINE, data });
    await poster("/api/gestion/coup-de-feu", { action: "finir" });
    await poster("/api/gestion/service", { type: "zone-rouvrir", numero: 3 });
    await poster("/api/gestion/service", { type: "zone-services", numero: 3, services: ["midi", "soir"] });
  }
});
