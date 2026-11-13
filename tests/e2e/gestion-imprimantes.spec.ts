import AxeBuilder from "@axe-core/playwright";
import { SITE, adresseDuCompte } from "./site";
import { expect, test, type Page } from "@playwright/test";

// Rubrique Imprimantes, parties de la vague 3 (bo-operations) : ce que chaque imprimante a fait, et la conduite
// en cas de panne. Ajoute une imprimante de cuisine (ses tickets iraient vers elle), puis la désactive.
test.describe.configure({ mode: "serial", timeout: 90_000 });

const ORIGINE = { Origin: SITE };
const CAPTURES = "docs/rendus/vague-3/bo-operations";
const NOM = "Essai écran imprimantes";

async function connecter(page: Page, email: string) {
  await adresseDuCompte(page, email);
  await page.goto("/gestion/imprimantes");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Recevoir un code" }).click();
  const code = page.locator(".note-preversion strong");
  // Premier appel après le démarrage du serveur : la page compile, d'où un délai plus large.
  await expect(code).toHaveText(/^\d{8}$/, { timeout: 20_000 });
  await page.getByLabel("Code à 8 chiffres").fill(await code.innerText());
  await page.getByRole("button", { name: "Me connecter" }).click();
  await expect(page.getByLabel("Code à 8 chiffres")).toHaveCount(0);
}

test("imprimantes : dernier ticket, conduite en cas de panne, axe", async ({ page }, info) => {
  test.skip(info.project.name !== "bureau", "imprimantes communes à la base : projet bureau");
  await page.setViewportSize({ width: 1024, height: 900 });
  await connecter(page, "ecran-imprimantes@laferme.test");
  let id: number | null = null;
  try {
    // Une imprimante désactivée ne reçoit pas de ticket : on l'ajoute puis on la désactive aussitôt.
    await page.getByLabel("Nom").fill(NOM);
    await page.getByLabel("Poste").selectOption("cuisine");
    await page.getByRole("button", { name: "Ajouter l'imprimante" }).click();
    await expect(page.getByText("Adresse CloudPRNT, à copier maintenant :")).toBeVisible();
    const liste = (await (await page.request.get("/api/gestion/imprimantes")).json()).imprimantes as { id: number; nom: string }[];
    id = liste.find((i) => i.nom === NOM)!.id;
    await page.request.post("/api/gestion/imprimantes", { headers: ORIGINE, data: { type: "actif", id, actif: false } });
    await page.reload();
    const ligne = page.locator("li", { hasText: NOM });
    await expect(ligne.getByText("Aucun ticket sorti pour l'instant.")).toBeVisible();
    await expect(ligne.getByText("Aujourd'hui : 0 imprimé.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "En cas de panne" })).toBeVisible();

    const axe = await new AxeBuilder({ page }).include(".bo-contenu").analyze();
    expect(axe.violations.map((v) => `${v.id} : ${v.nodes.length}`)).toEqual([]);
    await page.screenshot({ path: `${CAPTURES}/imprimantes-1024.png`, fullPage: true });
  } finally {
    if (id !== null) await page.request.post("/api/gestion/imprimantes", { headers: ORIGINE, data: { type: "actif", id, actif: false } });
  }
});
