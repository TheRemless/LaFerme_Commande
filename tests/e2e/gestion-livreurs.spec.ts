import AxeBuilder from "@axe-core/playwright";
import { adresseDuCompte, codeDuPersonnel, SITE } from "./site";
import { expect, test, type Page } from "@playwright/test";

// Rubrique Livreurs du back-office (vague 3, bo-operations) : semaine type, absence et renfort du jour,
// statistiques. Un seul projet : le planning est commun à la base. Captures à 1024 px (tablette) et 375 px.
test.describe.configure({ mode: "serial", timeout: 90_000 });

const ORIGINE = { Origin: SITE };
const CAPTURES = "docs/rendus/vague-3/bo-operations";

async function connecter(page: Page, email: string) {
  await adresseDuCompte(page, email);
  await page.goto("/gestion/livreurs");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Code à 8 chiffres").fill(await codeDuPersonnel(page));
  await page.getByRole("button", { name: "Me connecter" }).click();
  await expect(page.getByLabel("Code à 8 chiffres")).toHaveCount(0);
}

test("semaine type, absence, renfort, statistiques", async ({ page }, info) => {
  test.skip(info.project.name !== "bureau", "planning commun à la base : projet bureau");
  await page.setViewportSize({ width: 1024, height: 900 });
  await connecter(page, "ecran-livreurs@laferme.test");
  const livreurs = (await (await page.request.get("/api/gestion/livreurs")).json()).semaines as { id: string; nom: string }[];
  const sami = livreurs.find((l) => l.nom === "Sami")!;
  const nora = livreurs.find((l) => l.nom === "Nora")!;
  // Premier jour des sept où le restaurant sert à midi (le dimanche et le lundi, il est fermé).
  const premierJourOuvert = page.locator(".bo-liv-jour").filter({ has: page.locator(".bo-liv-service:first-child:not(.bo-liv-ferme)") }).first();
  let jourTest = "";

  try {
    await expect(page.getByRole("navigation").getByRole("link", { name: "Livreurs" })).toBeVisible();
    // Semaine type : Sami tous les soirs.
    await page.getByRole("tab", { name: "Semaine type" }).click();
    for (const jour of ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]) {
      await page.getByRole("button", { name: `Sami, ${jour} soir` }).click();
    }
    await expect(page.getByRole("button", { name: "Sami, vendredi soir" })).toHaveAttribute("aria-pressed", "true");
    // Prénom exact : le jeu de rush a aussi « Samir ».
    const ligneSami = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Sami", exact: true }) });
    await ligneSami.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Semaine de Sami enregistrée.")).toBeVisible();
    await expect(ligneSami.getByRole("button", { name: "Enregistrer" })).toBeDisabled();

    // Les 7 prochains jours : le soir du premier jour ouvert, Sami prévu ; absent puis comme d'habitude.
    await page.getByRole("tab", { name: "Les 7 prochains jours" }).click();
    const jour = premierJourOuvert;
    jourTest = ((await jour.locator("h2").getAttribute("id")) ?? "").replace("liv-", "");
    expect(jourTest).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const soir = jour.locator(".bo-liv-service").nth(1);
    await expect(soir.getByText("Sami", { exact: true })).toBeVisible();
    await soir.locator(".bo-liv-ligne").filter({ has: page.getByText("Sami", { exact: true }) }).getByRole("button", { name: "Absent" }).click();
    await page.getByLabel("Motif").fill("Malade");
    await page.getByRole("button", { name: "Noter l'absence" }).click();
    await expect(soir.getByText("absence : Malade")).toBeVisible();

    // Renfort : Nora ce midi-là.
    const midi = jour.locator(".bo-liv-service").first();
    await midi.getByRole("combobox").selectOption({ label: "Nora" });
    await midi.getByRole("button", { name: "Ajouter" }).click();
    await expect(midi.getByText("en renfort")).toBeVisible();

    const axe = await new AxeBuilder({ page }).include(".bo-contenu").analyze();
    expect(axe.violations.map((v) => `${v.id} : ${v.nodes.length}`)).toEqual([]);
    await page.screenshot({ path: `${CAPTURES}/livreurs-jours-1024.png`, fullPage: true });
    await page.getByRole("tab", { name: "Semaine type" }).click();
    await page.screenshot({ path: `${CAPTURES}/livreurs-semaine-1024.png`, fullPage: true });
    await page.getByRole("tab", { name: "Livraisons par livreur" }).click();
    await expect(page.getByRole("table", { name: /Livraisons par livreur/ }).or(page.getByText("Aucune livraison sur cette période."))).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/livreurs-stats-1024.png`, fullPage: true });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole("tab", { name: "Les 7 prochains jours" }).click();
    await page.screenshot({ path: `${CAPTURES}/livreurs-jours-375.png`, fullPage: true });

    // Retour à la semaine type.
    await page.setViewportSize({ width: 1024, height: 900 });
    await soir.locator(".bo-liv-ligne").filter({ has: page.getByText("Sami", { exact: true }) }).getByRole("button", { name: "Comme d'habitude" }).click();
    await expect(soir.getByText("semaine type")).toBeVisible();
  } finally {
    const poster = (data: Record<string, unknown>) => page.request.post("/api/gestion/livreurs", { headers: ORIGINE, data });
    if (jourTest) {
      await poster({ type: "jour", livreur: sami.id, jour: jourTest, service: "soir", present: null });
      await poster({ type: "jour", livreur: nora.id, jour: jourTest, service: "midi", present: null });
    }
    await poster({ type: "semaine", livreur: sami.id, creneaux: [] });
  }
});
